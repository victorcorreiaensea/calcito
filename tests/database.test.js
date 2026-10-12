import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const admin = "11111111-1111-4111-8111-111111111111",
  visitor = "22222222-2222-4222-8222-222222222222";
test("PostgreSQL migration enforces private ownership, published-only reads, atomic saves, constraints and audit integrity", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); grant usage on schema auth to anon,authenticated; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; insert into auth.users values('${admin}'),('${visitor}');`,
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
    await db.exec(`insert into public.admin_users(user_id) values('${admin}')`);
    async function role(name, user = "") {
      await db.exec(
        `reset role; set role ${name}; select set_config('request.jwt.claim.sub','${user}',false);`,
      );
    }
    await role("authenticated", admin);
    const competition = (
      await db.query("select id from competitions where slug='ligue-1'")
    ).rows[0].id;
    const season = (
      await db.query(
        "insert into seasons(competition_id,label,start_year,end_year,is_published) values($1,'2026–2027',2026,2027,true) returning id",
        [competition],
      )
    ).rows[0].id;
    const teams = (
      await db.query(
        "insert into teams(slug,name,short,country,is_published) values('test-a','A','A','Test',true),('test-b','B','B','Test',true),('test-c','C','C','Test',true) returning id",
      )
    ).rows.map((t) => t.id);
    for (const id of teams)
      await db.query(
        "insert into season_teams(season_id,team_id) values($1,$2)",
        [season, id],
      );
    const payload = {
      season_id: season,
      round: "J1",
      kickoff: "2026-10-12T18:30:00Z",
      home_team_id: teams[0],
      away_team_id: teams[1],
      status: "finished",
      goals_home: 0,
      goals_away: 1,
      source: "Source de test",
      verified_at: "2026-10-12T21:00:00Z",
      is_published: false,
      home_stats: { shots: 0, shots_on_target: 0 },
      away_stats: { shots: 4, shots_on_target: 2 },
    };
    const id = (
      await db.query("select save_match($1::jsonb) as id", [
        JSON.stringify(payload),
      ])
    ).rows[0].id;
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from match_team_stats where match_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from match_team_stats"))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into teams(slug,name,short,country) values('attack','Attack','ATT','Test')",
      ),
    );
    await assert.rejects(db.query("select * from admin_audit_log"));
    await assert.rejects(db.exec("truncate public.matches"));
    await assert.rejects(db.exec("truncate public.teams"));
    await role("authenticated", visitor);
    assert.equal(
      (await db.query("select is_calcito_admin() as allowed")).rows[0].allowed,
      false,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [JSON.stringify(payload)]),
    );
    await assert.rejects(
      db.query("insert into admin_users(user_id) values($1)", [visitor]),
    );
    await role("authenticated", admin);
    const timestamp = (
      await db.query(
        "select updated_at::text as stamp from matches where id=$1",
        [id],
      )
    ).rows[0].stamp;
    await db.query("select save_match($1::jsonb)", [
      JSON.stringify({
        ...payload,
        id,
        expected_updated_at: timestamp,
        is_published: true,
      }),
    ]);
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from match_team_stats"))
        .rows[0].n,
      2,
    );
    await role("authenticated", admin);
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({
          ...payload,
          id,
          expected_updated_at: "2000-01-01T00:00:00Z",
        }),
      ]),
      /changé/,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({ ...payload, id: null }),
      ]),
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({
          ...payload,
          kickoff: "2026-10-13T18:30:00Z",
          is_published: true,
          source: null,
        }),
      ]),
    );
    await assert.rejects(
      db.query(
        "update match_team_stats set team_id=$1 where match_id=$2 and team_id=$3",
        [teams[2], id, teams[0]],
      ),
    );
    await assert.rejects(
      db.query(
        "update match_team_stats set shots_on_target=99 where match_id=$1",
        [id],
      ),
    );
    await assert.rejects(
      db.query(
        "update season_teams set point_adjustment=-3,adjustment_reason=null where season_id=$1",
        [season],
      ),
    );
    await assert.rejects(
      db.query("update matches set home_team_id=$1 where id=$2", [
        teams[2],
        id,
      ]),
      /statistiques/,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({ ...payload, kickoff: "2024-10-12T18:30:00Z" }),
      ]),
      /saison/,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({
          ...payload,
          kickoff: "2026-10-14T18:30:00Z",
          home_stats: { shots: 1, shots_on_target: 2 },
        }),
      ]),
    );
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from match_team_stats where match_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    assert.ok(
      (await db.query("select count(*)::int as n from admin_audit_log")).rows[0]
        .n > 0,
    );
    await assert.rejects(db.exec("delete from admin_audit_log"));
    await db.query("update seasons set is_published=false where id=$1", [
      season,
    ]);
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from matches")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from match_team_stats"))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
