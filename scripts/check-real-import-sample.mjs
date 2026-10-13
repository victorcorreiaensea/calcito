// Read-only sample from the owner's existing public backend. No production writes.
const url='https://calcito.onrender.com/matches?competition=94&season=2024&view=results';
try {
 const response=await fetch(url,{headers:{Origin:'https://victorcorreiaensea.github.io',Accept:'application/json'},signal:AbortSignal.timeout(45000)});
 if(!response.ok) throw new Error(`HTTP ${response.status}`);
 const result=await response.json();
 const matches=(result.data || []).filter(m=>m.status==='finished' && Number.isInteger(m.goalsHome) && Number.isInteger(m.goalsAway)).slice(0,3);
 if(!matches.length) throw new Error('No finished matches returned');
 const sample=matches.map(m=>({fixture_id:m.id,date:m.kickoff,competition:m.competition?.name,season:2024,home_team:m.home.name,away_team:m.away.name,home_goals:m.goalsHome,away_goals:m.goalsAway,source_url:url,provider:result.source?.name}));
 const summary=JSON.stringify(sample).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D');
 console.log(`::notice title=Verified historical import sample::${summary}`);
} catch(error) {
 console.log(`::notice title=Historical sample unavailable::Read-only provider check failed: ${error.message}. No fixtures were invented or imported.`);
}
