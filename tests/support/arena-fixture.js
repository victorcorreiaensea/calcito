import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
export async function setup() {
  const db = new PGlite();
  const admin = randomUUID(),
    player = randomUUID(),
    other = randomUUID();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to anon,authenticated;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${admin}'),('${player}'),('${other}');`,
  );
  for (const f of [
    "001_manual_platform.sql",
    "002_simplified_results.sql",
    "003_arena.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into admin_users(user_id)values('${admin}');update competitions set is_published=true;`,
  );
  const comp = (
    await db.query("select id from competitions where slug='ligue-1'")
  ).rows[0].id;
  const season = (
    await db.query(
      "insert into seasons(competition_id,label,start_year,end_year,is_published)values($1,'2026–2027',2026,2027,true)returning id",
      [comp],
    )
  ).rows[0].id;
  const teams = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    teams.push(id);
    await db.query(
      "insert into teams(id,name,short,slug,country,is_published)values($1,$2,'T',$3,'France',true)",
      [id, "Club " + i, "club-" + i],
    );
    await db.query("insert into season_teams(season_id,team_id)values($1,$2)", [
      season,
      id,
    ]);
  }
  const match = (
    await db.query(
      "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,is_published,source,verified_at)values($1,'J1',now()+interval '3 days',$2,$3,'scheduled',true,'Source vérifiée',now())returning *",
      [season, teams[0], teams[1]],
    )
  ).rows[0];
  const stamp = (
    await db.query(
      "update arena_model set enabled=true,trained_at=now()-interval '1 minute' returning trained_at",
    )
  ).rows[0].trained_at;
  const quote = (
    await db.query(
      "insert into arena_quotes(creator,match_id,market,forecast,probability,odds,model_version,model_at,match_revision,kickoff,expires_at)values($1,$2,'home','{\"home\":0.5,\"draw\":0.25,\"away\":0.25}',.5,2,'poisson-goals-v1',$3,$4,$5,now()+interval '10 minutes')returning id",
      [player, match.id, stamp, match.updated_at, match.kickoff],
    )
  ).rows[0].id;
  const as = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  return { db, admin, player, other, match, quote, as, teams, season, stamp };
}
export const rpc = async (db, name, args = []) =>
  (
    await db.query(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
