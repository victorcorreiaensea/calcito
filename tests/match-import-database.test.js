import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  readMatchCSV,
  planMatchImport,
  executeMatchImport,
} from "../src/domain/matchImport.js";
import { buildStandings } from "../src/domain/standings.js";
test("real historical CSV fixtures save through the existing owner RPC, preserve null stats, feed both team histories and league points without production writes", async () => {
  const db = new PGlite();
  const admin = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${admin}');`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/001_manual_platform.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/002_simplified_results.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `insert into admin_users(user_id) values('${admin}');set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);`,
    );
    const comp = (
      await db.query("select id from competitions where slug='liga-portugal'")
    ).rows[0];
    const season = (
      await db.query(
        "insert into seasons(competition_id,label,start_year,end_year,is_published) values($1,'2024–2025',2024,2025,true) returning *",
        [comp.id],
      )
    ).rows[0];
    const teams = (
      await db.query(
        "insert into teams(slug,name,short,country,is_published) values('fc-porto','FC Porto','FCP','Portugal',true),('braga','Braga','BRA','Portugal',true),('benfica','Benfica','BEN','Portugal',true) returning *",
      )
    ).rows;
    for (const team of teams)
      await db.query(
        "insert into season_teams(season_id,team_id) values($1,$2)",
        [season.id, team.id],
      );
    async function dataset() {
      const query = async (table) =>
        (
          await db.query(`select to_jsonb(t) as record from public.${table} t`)
        ).rows.map((r) => r.record);
      return {
        competitions: await query("competitions"),
        seasons: await query("seasons"),
        teams: await query("teams"),
        members: await query("season_teams"),
        matches: await query("matches"),
        stats: await query("match_team_stats"),
        simplified: await query("simplified_results"),
      };
    }
    const rows = readMatchCSV(
      await readFile(
        new URL("./fixtures/liga-portugal-real-reference.csv", import.meta.url),
        "utf8",
      ),
    );
    const before = await dataset();
    const plan = planMatchImport(rows, before, {
      verified: true,
      published: true,
    });
    assert.ok(plan.every((r) => !r.errors.length));
    const save = async (payload) => {
      try {
        return (
          await db.query("select save_match($1::jsonb) as id", [
            JSON.stringify(payload),
          ])
        ).rows[0].id;
      } catch (e) {
        throw e;
      }
    };
    const result = await executeMatchImport(plan, { save });
    assert.equal(result.imported, 2, JSON.stringify(result));
    assert.equal(result.rejected, 0);
    const after = await dataset();
    assert.equal(after.matches.length, 2);
    assert.equal(after.stats.length, 4);
    assert.ok(
      after.stats.every((s) => s.shots === null && s.team_rating === null),
    );
    const porto = teams.find((t) => t.name === "FC Porto");
    assert.equal(
      after.matches.filter((m) =>
        [m.home_team_id, m.away_team_id].includes(porto.id),
      ).length,
      2,
    );
    const table = buildStandings({
      season,
      teams: after.teams,
      members: after.members,
      matches: after.matches,
    });
    assert.equal(table.recordedMatches, 2);
    assert.equal(table.partial, true);
    assert.equal(table.rows.find((r) => r.id === porto.id).points, 3);
    const duplicate = await executeMatchImport(
      planMatchImport(rows, after, { verified: true, published: true }),
      { save },
    );
    assert.equal(duplicate.ignored, 2);
    assert.equal(duplicate.imported, 0);
    const update = planMatchImport([{ ...rows[0], home_shots: "15" }], after, {
      duplicates: "update",
      verified: true,
      published: true,
    });
    const updated = await executeMatchImport(update, {
      save,
      duplicates: "update",
    });
    assert.equal(updated.updated, 1);
    assert.equal((await dataset()).matches.length, 2);
    assert.equal(
      (
        await db.query(
          "select shots from match_team_stats where match_id=$1 and team_id=$2",
          [update[0].payload.id, porto.id],
        )
      ).rows[0].shots,
      15,
    );
    // This synthetic statistic exists only in the isolated test, never in the real reference CSV.
    await db.exec(
      "reset role;set role anon;select set_config('request.jwt.claim.sub','',false);",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      2,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify(plan[0].payload),
      ]),
    );
  } finally {
    await db.close();
  }
});
