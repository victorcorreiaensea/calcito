import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("incremental migration preserves V3 records and enforces quick-result RLS, duplicates, atomic conversion, archive and invalidation", async () => {
  const db = new PGlite();
  const admin = "11111111-1111-4111-8111-111111111111",
    visitor = "22222222-2222-4222-8222-222222222222";
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
    await db.exec(`insert into admin_users(user_id) values('${admin}');`);
    const role = async (name, user = "") =>
      db.exec(
        `reset role;set role ${name};select set_config('request.jwt.claim.sub','${user}',false);`,
      );
    await role("authenticated", admin);
    const comp = (
      await db.query("select id from competitions where slug='ligue-1'")
    ).rows[0].id;
    const season = (
      await db.query(
        "insert into seasons(competition_id,label,start_year,end_year,is_published) values($1,'2026–2027',2026,2027,true) returning id",
        [comp],
      )
    ).rows[0].id;
    const teams = (
      await db.query(
        "insert into teams(slug,name,short,country,is_published) values('a','Slavia Prague','SLA','Tchéquie',true),('b','Viktoria Plzeň','VPL','Tchéquie',true),('c','Other','OTH','Test',true) returning id",
      )
    ).rows.map((r) => r.id);
    for (const id of teams)
      await db.query(
        "insert into season_teams(season_id,team_id) values($1,$2)",
        [season, id],
      );
    const full = {
      season_id: season,
      round: "J1",
      kickoff: "2026-09-01T18:00:00Z",
      status: "finished",
      home_team_id: teams[0],
      away_team_id: teams[1],
      goals_home: 1,
      goals_away: 0,
      source: "test-only",
      verified_at: "2026-09-02T18:00:00Z",
      is_published: true,
      home_stats: { shots: 3 },
      away_stats: {},
    };
    const fullId = (
      await db.query("select save_match($1::jsonb) as id", [
        JSON.stringify(full),
      ])
    ).rows[0].id;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/002_simplified_results.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await role("authenticated", admin);
    assert.equal((await db.query("select id from matches")).rows[0].id, fullId);
    assert.equal(
      (
        await db.query("select shots from match_team_stats where team_id=$1", [
          teams[0],
        ])
      ).rows[0].shots,
      3,
    );
    const quick = {
      team_id: teams[0],
      opponent_name: "Viktoria Plzeň",
      kickoff: "2026-09-03T12:00:00Z",
      season_start_year: 2026,
      season_end_year: 2027,
      competition_name: "Championnat tchèque",
      venue: "home",
      goals_for: 2,
      goals_against: 1,
      is_published: false,
    };
    const save = async (p) =>
      (
        await db.query("select save_simplified_result($1::jsonb) as id", [
          JSON.stringify(p),
        ])
      ).rows[0].id;
    const qid = await save(quick);
    await db.exec("begin");
    const firstRevision = (
      await db.query(
        "update simplified_results set competition_name=competition_name where id=$1 returning updated_at::text as stamp",
        [qid],
      )
    ).rows[0].stamp;
    const secondRevision = (
      await db.query(
        "update simplified_results set competition_name=competition_name where id=$1 returning updated_at::text as stamp",
        [qid],
      )
    ).rows[0].stamp;
    assert.notEqual(
      firstRevision,
      secondRevision,
      "rapid writes must have distinct revisions",
    );
    await db.exec("rollback");
    assert.equal(
      (await db.query("select count(*)::int as n from teams")).rows[0].n,
      3,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from match_team_stats"))
        .rows[0].n,
      2,
    );
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from simplified_results"))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select save_simplified_result($1::jsonb)", [
        JSON.stringify(quick),
      ]),
    );
    await assert.rejects(db.exec("truncate simplified_results"));
    await role("authenticated", visitor);
    await assert.rejects(save(quick));
    assert.equal(
      (await db.query("delete from simplified_results returning id")).rows
        .length,
      0,
    );
    await role("authenticated", admin);
    await assert.rejects(save({ ...quick, kickoff: full.kickoff }), /existe/);
    await assert.rejects(save(quick), /existe/);
    await assert.rejects(
      save({ ...quick, opponent_name: "Viktoria Plzen" }),
      /existe/,
    );
    await assert.rejects(
      save({
        ...quick,
        team_id: teams[1],
        opponent_name: "Slavia Prague",
        venue: "away",
        goals_for: 1,
        goals_against: 2,
      }),
      /existe/,
    );
    await assert.rejects(
      save({ ...quick, id: fullId, kickoff: "2026-09-08T12:00:00Z" }),
      /Identifiant/,
    );
    await assert.rejects(
      save({ ...quick, goals_for: null, kickoff: "2026-09-04T12:00:00Z" }),
    );
    await assert.rejects(save({ ...quick, kickoff: "2999-09-03T12:00:00Z" }));
    await assert.rejects(
      save({
        ...quick,
        kickoff: "2026-09-04T12:00:00Z",
        season_start_year: 2024,
        season_end_year: 2025,
      }),
    );
    await assert.rejects(
      save({
        ...quick,
        opponent_team_id: teams[0],
        kickoff: "2026-09-04T12:00:00Z",
      }),
    );
    await db.query(
      "insert into form_snapshots(team_id,season_start_year,score,model_version,trace,is_valid,is_published) values($1,2026,80,'test-only','{}',true,true)",
      [teams[0]],
    );
    const stamp = (
      await db.query(
        "select updated_at::text as stamp from simplified_results where id=$1",
        [qid],
      )
    ).rows[0].stamp;
    await save({
      ...quick,
      id: qid,
      expected_updated_at: stamp,
      is_published: true,
    });
    assert.equal(
      (await db.query("select is_valid from form_snapshots")).rows[0].is_valid,
      false,
    );
    await assert.rejects(
      save({ ...quick, id: qid, expected_updated_at: stamp }),
      /changé/,
    );
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from simplified_results"))
        .rows[0].n,
      1,
    );
    await role("authenticated", admin);
    await db.query("update teams set is_published=false where id=$1", [
      teams[0],
    ]);
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from simplified_results"))
        .rows[0].n,
      0,
    );
    await role("authenticated", admin);
    await db.query("update teams set is_published=true where id=$1", [
      teams[0],
    ]);
    const conversion = {
      ...full,
      id: qid,
      kickoff: quick.kickoff,
      goals_home: 2,
      goals_away: 1,
    };
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({ ...conversion, id: undefined }),
      ]),
      /résultat rapide/,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({ ...conversion, goals_home: 9 }),
      ]),
      /conversion/,
    );
    await assert.rejects(
      db.query("select save_match($1::jsonb)", [
        JSON.stringify({
          ...conversion,
          home_stats: { shots: 1, shots_on_target: 3 },
        }),
      ]),
    );
    assert.equal(
      (
        await db.query(
          "select converted_at from simplified_results where id=$1",
          [qid],
        )
      ).rows[0].converted_at,
      null,
    );
    assert.equal(
      (
        await db.query("select count(*)::int as n from matches where id=$1", [
          qid,
        ])
      ).rows[0].n,
      0,
    );
    await db.query("select save_match($1::jsonb)", [
      JSON.stringify(conversion),
    ]);
    const archived = (
      await db.query("select * from simplified_results where id=$1", [qid])
    ).rows[0];
    assert.equal(archived.converted_match_id, qid);
    assert.ok(archived.converted_at);
    assert.equal(archived.goals_for, 2);
    await assert.rejects(
      save({ ...quick, id: qid, expected_updated_at: archived.updated_at }),
      /converti/,
    );
    await role("anon");
    assert.equal(
      (await db.query("select count(*)::int as n from simplified_results"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("select count(*)::int as n from matches where id=$1", [
          qid,
        ])
      ).rows[0].n,
      1,
    );
    await role("authenticated", admin);
    await db.query("delete from matches where id=$1", [qid]);
    assert.ok(
      (
        await db.query(
          "select converted_at from simplified_results where id=$1",
          [qid],
        )
      ).rows[0].converted_at,
    );
    assert.ok(
      (
        await db.query(
          "select count(*)::int as n from admin_audit_log where entity='simplified_results'",
        )
      ).rows[0].n >= 3,
    );
  } finally {
    await db.close();
  }
});
