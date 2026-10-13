"""Build an explicitly partial, CC0 results bundle from already fetched public sources.
Usage: python3 scripts/prepare-six-leagues.py /tmp/calcito-six-sources
The source folder must contain six OpenFootball JSON files, four GitHub logo
catalog listings, commit.txt and a public-dataset.json read-only snapshot.
Never writes Supabase, never guesses scores, external IDs or image filenames.
"""
import sys,json,csv,re,pathlib,unicodedata,collections,datetime
root=pathlib.Path(__file__).resolve().parents[1];cache=pathlib.Path(sys.argv[1]);out=root/'public/downloads';out.mkdir(exist_ok=True)
leagues=[('fr','ligue-1','Ligue 1','France',18),('pt','liga-portugal','Liga Portugal','Portugal',18),('en','premier-league','Premier League','Angleterre',20),('es','laliga','LaLiga','Espagne',20),('it','serie-a','Serie A','Italie',20),('de','bundesliga','Bundesliga','Allemagne',18)]
known=json.loads((cache/'public-dataset.json').read_text());commit=(cache/'commit.txt').read_text().strip();today='2026-10-13'
# Explicit club identities checked against the current published catalog; no fuzzy matching.
aliases={'Sport Lisboa e Benfica':'SL Benfica','Sporting Clube de Portugal':'Sporting CP','Sporting Clube de Braga':'SC Braga','Vitória Guimarães':'Vitoria SC','CD Nacional':'CD National','CD Santa Clara':'Santa Clara','CS Marítimo':'Maritimo','CF Estrela da Amadora':'Estrela','Académico de Viseu FC':'Academico Viseu','GD Estoril Praia':'Estoril','FC Famalicão':'Famalicao','FC Arouca':'Arouca','FC Alverca':'Alverca','Casa Pia AC':'Casa Pia','Gil Vicente FC':'Gil Vicente','Moreirense FC':'Moreirense','Rio Ave FC':'Rio Ave','Paris Saint-Germain FC':'Paris Saint Germain','AS Monaco FC':'Monaco','Angers SCO':'Angers','Lille OSC':'Lille','Olympique Lyonnais':'Lyon','OGC Nice':'Nice','Stade Rennais FC 1901':'Rennes','RC Strasbourg Alsace':'Strasbourg','Toulouse FC':'Toulouse','FC Lorient':'Lorient','AJ Auxerre':'Auxerre','ES Troyes AC':'ESTAC Troyes','Le Havre AC':'Le Havre','Racing Club de Lens':'Lens','Le Mans FC':'Le Mans'}
logo_aliases={'Aston Villa FC':'Aston Villa','Brighton & Hove Albion FC':'Brighton & Hove Albion','Coventry City FC':'Coventry City','Crystal Palace FC':'Crystal Palace','Hull City AFC':'Hull City','Ipswich Town FC':'Ipswich Town','Leeds United FC':'Leeds United','Manchester City FC':'Manchester City','Manchester United FC':'Manchester United','Newcastle United FC':'Newcastle United','Nottingham Forest FC':'Nottingham Forest','Tottenham Hotspur FC':'Tottenham Hotspur','Athletic Club':'Athletic Bilbao','Club Atlético de Madrid':'Atlético de Madrid','RC Celta de Vigo':'Celta de Vigo','RC Deportivo La Coruña':'Deportivo A Coruña','RCD Espanyol de Barcelona':'RCD Espanyol Barcelona','Real Racing Club de Santander':'Racing Santander','Rayo Vallecano de Madrid':'Rayo Vallecano','Real Madrid CF':'Real Madrid','Real Sociedad de Fútbol':'Real Sociedad','FC Internazionale Milano':'Inter Milan','US Sassuolo Calcio':'US Sassuolo','1. FC Köln':'1.FC Köln','1. FC Union Berlin':'1.FC Union Berlin','1. FSV Mainz 05':'1.FSV Mainz 05','FC Bayern München':'Bayern Munich'}
headers='date,competition,season,home_team,away_team,home_goals,away_goals,home_shots,away_shots,home_shots_on_target,away_shots_on_target,home_big_chances,away_big_chances,home_rating,away_rating,source_url'.split(',')
def write(name,rows,keys):
 with (out/name).open('w',encoding='utf-8-sig',newline='')as f:w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows(rows)
def slug(name):return re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFD',name).encode('ascii','ignore').decode().lower()).strip('-')
rows=[];clubs=[];reports=[];missing=[];mapping=[];seen=set()
for key,league,label,country,count in leagues:
 data=json.loads((cache/(key+'.json')).read_text());names=sorted({t for m in data['matches'] for t in (m['team1'],m['team2'])});assert len(names)==count
 source=f'https://github.com/openfootball/football.json/blob/{commit}/2026-27/{key}.1.json'
 logos=json.loads((cache/(key+'-logos.json')).read_text())if key not in ('fr','pt')else[]
 for name in names:
  display=aliases.get(name,name);matches=[t for t in known['teams']if t['name']==display and t['country']==country];assert len(matches)<=1
  existing=matches[0]if matches else None
  logo=next((item for item in logos if item['name']==logo_aliases.get(name,name)+'.png'),None)
  if key not in ('fr','pt'):assert logo and logo['size']>0 and logo['download_url'].startswith('https://raw.githubusercontent.com/')
  club={'sourceName':name,'name':display,'officialName':name,'slug':slug(display),'short':''.join(word[0]for word in display.split()if word[0].isalnum())[:8]or'CLUB','country':country,'league':league,'leagueName':label,'logo_url':existing.get('logo_url')if existing else logo['download_url']if logo else None,'logoSource':logo['html_url']if logo else None,'logoBlob':logo['sha']if logo else None,'source':source,'existingId':existing['id']if existing else None,'allowCreate':key not in ('fr','pt')}
  clubs.append(club);mapping.append({'source_name':name,'calcito_name':display,'internal_id':club['existingId']or'','competition':label,'country':country,'logo_url':club['logo_url']or'','logo_source':club['logoSource']or'','source_url':source})
 before=len(rows)
 for m in data['matches']:
  if m['date']>today:continue
  datetime.date.fromisoformat(m['date']);score=m.get('score');score=score.get('ft')if isinstance(score,dict)else score
  if score is None:
   missing.append({'date':m['date'],'competition':label,'home_team':aliases.get(m['team1'],m['team1']),'away_team':aliases.get(m['team2'],m['team2']),'status':'reporté dans la source'if m.get('status')=='postponed'else'score non renseigné','source_url':source});continue
  assert len(score)==2 and all(type(n)is int and n>=0 for n in score)
  identity=(league,m['date'],m['team1'],m['team2']);assert identity not in seen;seen.add(identity)
  row=dict.fromkeys(headers,'');row.update(date=m['date'],competition=label,season='2026-2027',home_team=aliases.get(m['team1'],m['team1']),away_team=aliases.get(m['team2'],m['team2']),home_goals=score[0],away_goals=score[1],source_url=source);rows.append(row)
 reports.append({'slug':league,'name':label,'country':country,'teams':len(names),'newTeams':sum(c['league']==league and not c['existingId']for c in clubs),'results':len(rows)-before,'latestResult':max(r['date']for r in rows if r['competition']==label),'source':source,'missingScores':sum(m['competition']==label for m in missing)})
rows.sort(key=lambda r:(r['date'],r['competition'],r['home_team']))
write('calcito_resultats_2026_2027.csv',rows,headers)
write('calcito_correspondance_equipes_2026_2027.csv',mapping,list(mapping[0]))
write('calcito_matchs_non_renseignes_2026_2027.csv',missing,list(missing[0]))
(root/'public/data/season-2026-2027.json').write_text(json.dumps({'season':2026,'preparedAt':today,'partial':True,'license':'CC0 1.0 (match results only)','sourceCommit':commit,'clubs':clubs,'rows':rows,'report':reports},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'results':len(rows),'teams':len(clubs),'report':reports},ensure_ascii=False))
