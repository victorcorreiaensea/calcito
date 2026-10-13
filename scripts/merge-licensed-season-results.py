"""Add only dated domestic league scores from linked licensed club pages.
Never infer dates from a results matrix; never overwrite an existing result.
Usage: python3 scripts/merge-licensed-season-results.py /tmp/calcito-six-sources
"""
import json,pathlib,sys,re,unicodedata,csv,collections,datetime,ast,subprocess
root=pathlib.Path(__file__).resolve().parents[1];cache=pathlib.Path(sys.argv[1]);subprocess.run([sys.executable,str(root/'scripts/prepare-six-leagues.py'),str(cache)],check=True,stdout=subprocess.DEVNULL);target=root/'public/data/season-2026-2027.json';b=json.loads(target.read_text())
script=ast.parse((root/'scripts/prepare-six-leagues.py').read_text()).body
logo_aliases=next(ast.literal_eval(n.value)for n in script if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='logo_aliases'for x in n.targets))
def normalized(s):
 s=unicodedata.normalize('NFD',re.sub(r'\[\d+\]','',s)).encode('ascii','ignore').decode().lower().replace('.','')
 return ''.join(w for w in re.findall('[a-z0-9]+',s)if w not in {'fc','afc','cf','rc','rcd','ca','cd','ud','sc','cs','cp','sl','ac','bc','us','ss','ssc','cfc','fsv','tsg','de','club','clube','07','04','1899'})
explicit_aliases={
 'Olympique de Marseille':['Marseille'],'Stade Brestois 29':['Brest'],'ES Troyes AC':['Troyes'],
 '1. FC Union Berlin':['Union Berlin'],'1. FSV Mainz 05':['Mainz 05'],'SV Werder Bremen':['Werder Bremen'],
 'Deportivo Alavés':['Alavés'],'RCD Espanyol de Barcelona':['Espanyol'],'Real Betis Balompié':['Real Betis'],
 'Atalanta BC':['Atalanta'],'Bologna FC 1909':['Bologna'],'Cagliari Calcio':['Cagliari'],'Como 1907':['Como'],
 'Parma Calcio 1913':['Parma'],'AS Roma':['Roma'],'ACF Fiorentina':['Fiorentina'],'FC Internazionale Milano':['Internazionale','Inter Milan'],
 'US Lecce':['Lecce'],'Udinese Calcio':['Udinese'],'Frosinone Calcio':['Frosinone']}
def resolve(name,league):
 key=normalized(name)
 matches=[c for c in b['clubs']if c['league']==league and key in {normalized(c['sourceName']),normalized(c['name']),normalized(logo_aliases.get(c['sourceName'],'')),*[normalized(a)for a in explicit_aliases.get(c['sourceName'],[])]}]
 return matches[0]if len(matches)==1 else None
eligibility={'ligue-1':'Ligue 1','liga-portugal':'Primeira Liga','premier-league':'Premier League','laliga':'La Liga','serie-a':'Serie A','bundesliga':'Bundesliga'}
known={(r['competition'],r['home_team'],r['away_team']):r for r in b['rows']};added=[];conflicts=[];unmatched=[];corroborated=set()
for league,competition in eligibility.items():
 data=json.loads((cache/('licensed-'+league+'.json')).read_text())
 for r in data['records']:
  if competition.lower()not in r.get('competition_context','').lower():continue
  home,away=resolve(r['home'],league),resolve(r['away'],league)
  if not home or not away or home['name']==away['name']:
   unmatched.append(r);continue
  date=r['date'];datetime.date.fromisoformat(date)
  assert date<='2026-10-13'and date>='2026-07-01'
  assert all(type(r[k])is int and r[k]>=0 for k in ['home_goals','away_goals'])
  key=(home['leagueName'],home['name'],away['name']);old=known.get(key)
  if old:
   if (old['date'],old['home_goals'],old['away_goals'])!=(r['date'],r['home_goals'],r['away_goals']):conflicts.append({'existing':old,'reference':r})
   else:corroborated.add(key)
   continue
  row=dict.fromkeys(b['rows'][0],'');row.update(date=date,competition=home['leagueName'],season='2026-2027',home_team=home['name'],away_team=away['name'],home_goals=r['home_goals'],away_goals=r['away_goals'],source_url=r['source_url'])
  assert row['source_url'].startswith('https://en.wikipedia.org/wiki/')
  b['rows'].append(row);known[key]=row;added.append(row)
conflicting_keys={(c['existing']['competition'],c['existing']['home_team'],c['existing']['away_team'])for c in conflicts}
# Withhold disputed dates rather than silently prefer one community source.
b['rows']=[r for r in b['rows']if (r['competition'],r['home_team'],r['away_team'])not in conflicting_keys]
b['conflicts']=[{'competition':c['existing']['competition'],'home_team':c['existing']['home_team'],'away_team':c['existing']['away_team'],'openfootball_date':c['existing']['date'],'wikipedia_date':c['reference']['date'],'openfootball_source':c['existing']['source_url'],'wikipedia_source':c['reference']['source_url']}for c in conflicts]
write_conflicts=root/'public/downloads/calcito_dates_a_verifier.csv'
with write_conflicts.open('w',encoding='utf-8-sig',newline='')as f:
 keys=['competition','home_team','away_team','openfootball_date','wikipedia_date','openfootball_source','wikipedia_source'];w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows(b['conflicts'])
b['rows'].sort(key=lambda r:(r['date'],r['competition'],r['home_team']));b['license']='CC0 for OpenFootball results; CC BY-SA 4.0 for Wikipedia adaptations'
for report in b['report']:
 rows=[r for r in b['rows']if r['competition']==report['name']]
 report['results']=len(rows);report['latestResult']=max(r['date']for r in rows);report['licensedAdditions']=sum(r['competition']==report['name']for r in added)
missing_path=root/'public/downloads/calcito_matchs_non_renseignes_2026_2027.csv'
with missing_path.open(encoding='utf-8-sig',newline='')as f:remaining=[r for r in csv.DictReader(f)if (r['competition'],r['home_team'],r['away_team'])not in known]
for report in b['report']:report['missingScores']=sum(r['competition']==report['name']for r in remaining)
b['verification']={'licensedAdditions':len(added),'corroboratedMatchups':len(corroborated),'conflictingReferences':len(conflicts),'unmatchedReferences':len(unmatched),'remainingScheduledMatchups':len(remaining)}
def write(path,rows,headers):
 with path.open('w',encoding='utf-8-sig',newline='')as f:w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(rows)
write(root/'public/downloads/calcito_resultats_2026_2027.csv',b['rows'],list(b['rows'][0]))
write(missing_path,remaining,['date','competition','home_team','away_team','status','source_url'])
target.write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n')
(cache/'licensed-merging-report.json').write_text(json.dumps({'added':added,'conflicts':conflicts,'unmatched':unmatched},ensure_ascii=False))
print(json.dumps({'results':len(b['rows']),'verification':b['verification'],'report':[{k:r[k]for k in ['name','results','latestResult','licensedAdditions','missingScores']}for r in b['report']]},ensure_ascii=False))
