"""Read-only feasibility inspection; does not collect scores or call private feeds."""
import html
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

ROOT = 'https://www.flashscore.fr/'
RESULTS = urljoin(ROOT, 'football/portugal/liga-portugal/resultats/')
AGENT = 'CalcitoSourceInspection/1.0'
notes = []

def get(url):
    try:
        request = urllib.request.Request(url, headers={'User-Agent': AGENT})
        with urllib.request.urlopen(request, timeout=15) as response:
            content = response.read(1_000_001)
            if len(content) > 1_000_000:
                notes.append('Page trop grande pour cette inspection limitée.'); return None
            notes.append(f'{url}: HTTP {response.status}, {response.headers.get("Content-Type", "unknown")}')
            text = content.decode('utf-8', errors='replace')
            title = re.search(r'<title[^>]*>(.*?)</title>', text, re.I | re.S)
            visible = re.sub(r'<script.*?</script>|<style.*?</style>', '', text, flags=re.I | re.S)
            visible = re.sub(r'<[^>]+>', ' ', visible)
            challenge = r'access denied|verify you are human|just a moment|vérifiez que vous êtes humain|complete the captcha|résoudre le captcha'
            if re.search(challenge, title.group(1) if title else '', re.I) or (len(visible) < 5000 and re.search(challenge, visible, re.I)):
                notes.append('Protection détectée : inspection arrêtée, aucun contournement.'); return None
            return text
    except (urllib.error.URLError, TimeoutError) as error:
        notes.append(f'{url}: accès indisponible ({getattr(error, "code", type(error).__name__)}). Aucun nouvel essai automatisé.')
        return None

def inspect():
    robots = get(urljoin(ROOT, 'robots.txt'))
    if robots is None: return
    rules = RobotFileParser(); rules.parse(robots.splitlines())
    notes.append(f'robots.txt autorise la page résultats pour cet agent : {rules.can_fetch(AGENT, RESULTS)}')
    if not rules.can_fetch(AGENT, ROOT):
        notes.append('La lecture automatisée de la page d’accueil est interdite par robots.txt.'); return
    delay = rules.crawl_delay(AGENT) or rules.crawl_delay('*') or 1
    if delay > 10:
        notes.append('Délai de crawl supérieur au budget de cette inspection : arrêt.'); return
    time.sleep(delay)
    home = get(ROOT)
    if home is None: return
    links = re.findall(r'href=[\"\']([^\"\']+)[\"\']', home, re.I)
    legal = [urljoin(ROOT, html.unescape(link)) for link in links if re.search(r'conditions|terms|legal', link, re.I)]
    legal = list(dict.fromkeys(link for link in legal if link.startswith('https://www.flashscore.fr/') or link.startswith('https://www.livesport.eu/')))
    notes.append('Liens de conditions trouvés : ' + (', '.join(legal[:3]) or 'aucun dans le HTML reçu'))
    if legal and legal[0].startswith(ROOT) and rules.can_fetch(AGENT, legal[0]):
        time.sleep(delay)
        content = get(legal[0])
        if content:
            readable = html.unescape(re.sub(r'<[^>]+>', ' ', content))
            readable = re.sub(r'\s+', ' ', readable)
            for match in list(re.finditer(r'automat|scrap|robot|extract|extraction|personnel|commercial|reproduction', readable, re.I))[:8]:
                notes.append('Extrait des conditions : ' + readable[max(0, match.start()-100):match.end()+250])
    notes.append('Aucune récupération de rencontres ni de statistiques lancée. Une page publique ou robots.txt ne constitue pas une autorisation de collecte. Le site CALCITO utilise le relevé humain et les fichiers autorisés.')

inspect()
summary = '\n'.join(notes)
print(summary)
escaped = summary.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
print(f'::notice title=Flashscore feasibility::{escaped}')
