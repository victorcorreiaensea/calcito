"""Read ordinary, linked Wikipedia season pages; collect dated score boxes only.
No login, internal feed, CAPTCHA bypass or production write. CC BY-SA attribution
is retained per record. Stop on access/rate restrictions rather than retrying.
"""
import os,json,re,urllib.request,urllib.parse,urllib.error,time,datetime,gzip,base64
from pathlib import Path
from bs4 import BeautifulSoup
league=os.environ['LEAGUE'];records=[];coverage=[]
refs=json.loads(Path('scripts/season-club-references.json').read_text())
for ref in [r for r in refs if r['league']==league]:
 url=ref['url']; parsed=urllib.parse.urlparse(url)
 if parsed.hostname!='en.wikipedia.org' or parsed.query:raise ValueError('Unexpected source URL')
 request=urllib.request.Request(urllib.parse.quote(url,safe=':/%'),headers={'User-Agent':'CalcitoSeasonReference/1.0 (read-only licensed results; https://github.com/victorcorreiaensea/calcito)'})
 try:
  with urllib.request.urlopen(request,timeout=20)as response:html=response.read(2_000_000).decode()
 except urllib.error.HTTPError as e:
  coverage.append({'url':url,'status':e.code});
  if e.code in (401,403,429):break
  continue
 except Exception as e:coverage.append({'url':url,'error':type(e).__name__});continue
 soup=BeautifulSoup(html,'html.parser');count=0;contexts={};hierarchy={}
 for node in soup.find_all(['h2','h3','h4','h5','div','table']):
  if node.name.startswith('h'):
   level=int(node.name[1]);hierarchy={k:v for k,v in hierarchy.items()if k<level};hierarchy[level]=node.get_text(' ',strip=True)
  elif 'footballbox' in node.get('class',[]):contexts[id(node)]=' > '.join(hierarchy.values())
 for box in soup.select('.footballbox'):
  fields={name:box.select_one('.'+name)for name in ['fdate','fhome','faway','fscore']}
  if not all(fields.values()):continue
  texts={name:node.get_text(' ',strip=True)for name,node in fields.items()}
  date_match=re.search(r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(202[67])',texts['fdate'])
  score=re.match(r'^\s*(\d+)\s*[–−-]\s*(\d+)(?:\s|$|\()',texts['fscore'])
  if not date_match or not score:continue
  date=datetime.datetime.strptime(date_match.group(0),'%d %B %Y').date().isoformat()
  if date>'2026-10-13':continue
  records.append({'date':date,'home':texts['fhome'],'away':texts['faway'],'home_goals':int(score[1]),'away_goals':int(score[2]),'league':league,'source_url':url,'reference_club':ref['club'],'competition_context':contexts.get(id(box),'')});count+=1
 coverage.append({'url':url,'status':200,'dated_boxes':count,'boxes':len(soup.select('.footballbox'))})
 time.sleep(1)
encoded=base64.b64encode(gzip.compress(json.dumps({'league':league,'records':records,'coverage':coverage},ensure_ascii=False).encode())).decode()
if len(encoded)>30000:raise ValueError('Inspection output exceeds annotation budget')
for start in range(0,len(encoded),3000):print('::notice title=Licensed club results '+str(start)+'::'+encoded[start:start+3000])
