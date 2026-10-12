// Deployment readiness check: inspect public metadata only, never credentials.
const base = process.env.VITE_FOOTBALL_PROXY_URL?.replace(/\/$/, '');
const origin = 'https://victorcorreiaensea.github.io';
if (!base) {
  console.log('Mode démonstration : aucun backend configuré.');
} else {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Adresse publique HTTPS du backend requise, sans clé ni paramètres.');
  async function request(path) {
    const response = await fetch(`${base}/${path}`, { headers: { Origin: origin, Accept: 'application/json' }, signal: AbortSignal.timeout(180000) });
    if (response.status === 403) throw new Error('Backend refuse le site : vérifier FRONTEND_ORIGIN=https://victorcorreiaensea.github.io dans Render.');
    if (!response.ok) throw new Error(`Backend ${path} : HTTP ${response.status}. Vérifier la clé API-Football et les logs Render, sans publier la clé.`);
    if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('Autorisation CORS du site absente. Vérifier FRONTEND_ORIGIN dans Render.');
    return response.json();
  }
  const health = await request('health');
  if (health.status !== 'ok' || health.configured !== true) throw new Error('Backend démarré mais API non configurée : ajouter API_FOOTBALL_KEY dans les secrets Render.');
  console.log('Backend disponible, clé présente côté serveur, CORS du site autorisé.');
  const competitions = await request('competitions');
  if (!Array.isArray(competitions.data) || !competitions.source?.name || !competitions.data.length) throw new Error('Aucune compétition accessible depuis API-Football. Vérifier les droits du compte et son quota.');
  console.log(`API-Football répond : ${competitions.data.length} compétitions disponibles. Aucun secret affiché.`);
}
