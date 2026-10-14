// Prepare licensed fixtures; never writes Supabase. Current database comparison happens inside SQL.
import fs from "node:fs";
const dir = process.argv[2];
if (!dir)
  throw new Error(
    "Usage: node scripts/prepare-upcoming.mjs /tmp/calcito-upcoming",
  );
const plan = JSON.parse(fs.readFileSync(dir + "/plan.json"));
fs.writeFileSync(
  "public/data/upcoming-preview-2026-2027.json",
  JSON.stringify(
    {
      ...plan,
      databaseWritesConfirmed: 0,
      note: "Prepared fixtures only. Existing rows are compared inside Supabase; no addition is asserted until installation.",
    },
    null,
    2,
  ) + "\n",
);
const sql = `\n-- Initial calendar collected ${plan.fetchedAt}, OpenFootball CC0, commit ${plan.sourceCommit}.
-- Only real published club IDs. No guessed hours, no scores, no new clubs.
-- Existing pairings are compared at execution; official results and manual corrections are retained.
DO $seed$
DECLARE e jsonb;mid uuid;n integer:=0;skipped integer:=0;seed_nonce uuid:='1514e7a0-15a4-4b05-a785-e21c97783d92';
BEGIN
 PERFORM public._arena_lock();
 IF EXISTS(SELECT 1 FROM public.arena_calendar_runs WHERE nonce=seed_nonce)THEN RETURN;END IF;
 FOR e IN SELECT *FROM jsonb_array_elements($data$${JSON.stringify(plan.rows)}$data$::jsonb)LOOP
  IF(e->>'kickoff')::timestamptz<=clock_timestamp()OR NOT EXISTS(SELECT 1 FROM public.seasons s JOIN public.competitions c ON c.id=s.competition_id WHERE s.id=(e->>'season_id')::uuid AND s.start_year=2026 AND s.is_published AND c.is_published)OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(e->>'home_team_id')::uuid AND is_published)OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(e->>'away_team_id')::uuid AND is_published)OR NOT EXISTS(SELECT 1 FROM public.season_teams WHERE season_id=(e->>'season_id')::uuid AND team_id=(e->>'home_team_id')::uuid)OR NOT EXISTS(SELECT 1 FROM public.season_teams WHERE season_id=(e->>'season_id')::uuid AND team_id=(e->>'away_team_id')::uuid)THEN skipped:=skipped+1;CONTINUE;END IF;
  -- Never overwrite an existing pairing, even if the owner has corrected its date manually.
  IF EXISTS(SELECT 1 FROM public.arena_calendar_refs WHERE external_key=e->>'external_key')OR EXISTS(SELECT 1 FROM public.matches WHERE season_id=(e->>'season_id')::uuid AND home_team_id=(e->>'home_team_id')::uuid AND away_team_id=(e->>'away_team_id')::uuid)THEN skipped:=skipped+1;CONTINUE;END IF;
  INSERT INTO public.matches(season_id,round,kickoff,home_team_id,away_team_id,status,source,verified_at,comment,is_published)
  VALUES((e->>'season_id')::uuid,e->>'round',(e->>'kickoff')::timestamptz,(e->>'home_team_id')::uuid,(e->>'away_team_id')::uuid,'scheduled',e->>'source',now(),'Calendrier OpenFootball CC0 ; heure locale '||(e->>'timezone')||'.',true)RETURNING id INTO mid;
  INSERT INTO public.arena_calendar_refs VALUES(e->>'external_key',mid,e->>'source',e->>'timezone',now());n:=n+1;
 END LOOP;
 INSERT INTO public.arena_calendar_runs VALUES(seed_nonce,null,jsonb_build_object('added',n,'conservedOrExpired',skipped,'sourceCommit','${plan.sourceCommit}','method','owner-sql-initial-calendar'),now());
END $seed$;
`;
const migration = fs.readFileSync(
  "supabase/migrations/004_calendar_bookmaker.sql",
  "utf8",
);
// One transaction: a failed initialization cannot leave a partially activated backend.
fs.writeFileSync(
  "public/downloads/calcito-calendrier-bookmaker.sql",
  migration.replace(
    /COMMIT;\s*$/i,
    sql + "\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n",
  ),
);
console.log(
  JSON.stringify({
    prepared: plan.rows.length,
    unconfirmed: plan.issues.length,
    actualDatabaseWrites: 0,
  }),
);
