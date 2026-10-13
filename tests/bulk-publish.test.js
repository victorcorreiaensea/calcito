import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  planDraftPublication,
  executeDraftPublication,
} from "../src/domain/bulkPublish.js";

test("publication reports confirmed rows, stale edits and uncertain responses without blind retries", async () => {
  const items = Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    errors: i === 3 ? ["source absente"] : [],
  }));
  let calls = 0;
  const report = await executeDraftPublication(items, {
    publish: async (p) => {
      calls++;
      if (p.id === "0") return ["0"];
      if (p.id === "1") return [];
      throw new Error("Lost response");
    },
  });
  assert.equal(calls, 3);
  assert.equal(report.published, 1);
  assert.equal(report.stale, 1);
  assert.equal(report.uncertain, 1);
  assert.equal(report.blocked, 1);
  const stopped = await executeDraftPublication(items, {
    publish: async () => {
      throw new Error("Network timeout");
    },
  });
  assert.equal(stopped.remaining, 2);
  assert.equal(stopped.published, 0);
});

test("owner publishes full and quick drafts through guarded updates without changing scores, statistics or published matches; anonymous writes are denied", async () => {
  const db = new PGlite();
  const admin = randomUUID();
  const now = new Date("2026-10-14T20:00:00Z");
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${admin}');`,
    );
    for (const name of [
      "001_manual_platform.sql",
      "002_simplified_results.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    await db.exec(
      `insert into admin_users(user_id)values('${admin}');set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);update competitions set is_published=true;`,
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
    const teams = (
      await db.query(
        "insert into teams(slug,name,short,country,is_published)values('test-a','Test A','A','France',true),('test-b','Test B','B','France',true) returning id",
      )
    ).rows;
    for (const t of teams)
      await db.query(
        "insert into season_teams(season_id,team_id)values($1,$2)",
        [season, t.id],
      );
    for (let i = 0; i < 3; i++)
      await db.query(
        "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,goals_home,goals_away,source)values($1,'Test',$2,$3,$4,'finished',0,2,$5)",
        [
          season,
          `2026-10-0${i + 1}T18:00:00Z`,
          teams[0].id,
          teams[1].id,
          i === 2 ? null : "https://example.org/test-only",
        ],
      );
    const ids = (await db.query("select id from matches order by kickoff"))
      .rows;
    await db.query(
      "insert into match_team_stats(match_id,team_id,shots,bonuses)values($1,$2,8,$3::jsonb)",
      [ids[0].id, teams[0].id, "[]"],
    );
    await db.query(
      "insert into simplified_results(team_id,opponent_name,kickoff,season_start_year,season_end_year,competition_name,venue,goals_for,goals_against)values($1,'Test opponent','2026-10-10T12:00:00Z',2026,2027,'Other league','away',0,0)",
      [teams[0].id],
    );
    async function dataset() {
      const read = async (table) =>
        (await db.query(`select to_jsonb(t) as r from ${table} t`)).rows.map(
          (r) => r.r,
        );
      return {
        teams: await read("teams"),
        competitions: await read("competitions"),
        seasons: await read("seasons"),
        members: await read("season_teams"),
        matches: await read("matches"),
        simplified: await read("simplified_results"),
      };
    }
    const before = await dataset();
    const stats = (
      await db.query("select to_jsonb(t)as r from match_team_stats t")
    ).rows;
    let plan = planDraftPublication(before, now);
    assert.equal(plan.filter((p) => !p.errors.length).length, 3);
    assert.equal(plan.filter((p) => p.errors.length).length, 1);
    // A concurrent edit must stay private rather than being silently overwritten.
    await db.query("update matches set goals_home=1 where id=$1", [ids[1].id]);
    const publish = async (item) => {
      const query =
        item.table === "matches"
          ? "update matches set is_published=true,verified_at=$3 where id=$1 and not is_published and updated_at=$2::timestamptz returning id"
          : "update simplified_results set is_published=true where id=$1 and not is_published and converted_at is null and updated_at=$2::timestamptz returning id";
      return (
        await db.query(
          query,
          item.table === "matches"
            ? [item.id, item.expectedUpdatedAt, now.toISOString()]
            : [item.id, item.expectedUpdatedAt],
        )
      ).rows.map((r) => r.id);
    };
    const result = await executeDraftPublication(plan, { publish });
    assert.equal(result.published, 2);
    assert.equal(result.stale, 1);
    assert.equal(result.blocked, 1);
    const after = await dataset();
    assert.equal(after.matches.find((m) => m.id === ids[0].id).goals_home, 0);
    assert.ok(after.matches.find((m) => m.id === ids[0].id).verified_at);
    assert.equal(after.matches.find((m) => m.id === ids[1].id).goals_home, 1);
    assert.equal(
      after.matches.find((m) => m.id === ids[1].id).is_published,
      false,
    );
    assert.deepEqual(
      (await db.query("select to_jsonb(t)as r from match_team_stats t")).rows,
      stats,
    );
    plan = planDraftPublication(after, now);
    assert.equal(plan.length, 2);
    assert.equal(
      (await executeDraftPublication(plan, { publish })).published,
      1,
    );
    await db.exec(
      "reset role;set role anon;select set_config('request.jwt.claim.sub','',false);",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      2,
    );
    await assert.rejects(
      db.query("update matches set is_published=true where id=$1", [ids[2].id]),
    );
  } finally {
    await db.close();
  }
});
