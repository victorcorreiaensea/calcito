import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setup, rpc } from "./support/arena-fixture.js";
import {
  planEuropeanPreparation,
  readEuropeanCSV,
} from "../src/domain/europePreparation.js";
const migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/005_europe_preparation.sql",
      import.meta.url,
    ),
    "utf8",
  );
test("European preparation is owner-only, atomic, replay-safe, preserves existing clubs and public forms, finances and model until explicit publication", async () => {
  const f = await setup(),
    { db, as, admin, player, teams } = f;
  try {
    await db.exec(await migration());
    const existing = (
      await db.query("select * from teams where id=$1", [teams[0]])
    ).rows[0];
    await db.query(
      "insert into form_snapshots(team_id,season_start_year,model_version,score,calculated_at,trace,is_published,is_valid)values($1,2026,'test',77,now(),'{}',true,true)",
      [teams[0]],
    );
    const club1 = {
        key: "known",
        name: existing.name,
        existing_id: existing.id,
        country: existing.country,
      },
      club2 = {
        key: "newclub",
        name: "Club de test européen",
        country: "Suisse",
        short: "TEST",
        slug: "club-test-europe",
        identity_source_url: "https://source.test/club",
        domestic_league: "Championnat de test",
        external_provider: "uefa",
        external_id: "fixture-identity",
      };
    const match = {
      competition: "champions-league",
      season: "2026-2027",
      stage: "league-phase",
      round: 1,
      kickoff: "2026-09-15T19:00:00Z",
      home_key: "known",
      away_key: "newclub",
      status: "finished",
      goals_home: 2,
      goals_away: 1,
      source: "https://source.test/match",
      is_published: true,
    };
    const payload = { reviewed: true, clubs: [club1, club2], matches: [match] };
    const snapshot = async () => {
      await db.exec("reset role");
      const value = {
        wallets: (
          await db.query("select * from arena_wallets order by user_id")
        ).rows,
        bank: (await db.query("select * from arena_bank")).rows,
        ledger: (await db.query("select * from arena_ledger order by id")).rows,
        model: (await db.query("select * from arena_model")).rows,
        forms: (await db.query("select * from form_snapshots")).rows,
        tickets: (await db.query("select * from arena_tickets order by id"))
          .rows,
        legs: (
          await db.query("select * from arena_legs order by ticket_id,match_id")
        ).rows,
      };
      await as(admin);
      return value;
    };
    await as(player);
    await rpc(db, "arena_account");
    const openTicket = await rpc(db, "arena_place_ticket", [
      [f.quote],
      500,
      "challenge",
      null,
      randomUUID(),
    ]);
    assert.equal(openTicket.accepted, true);
    const baseline = await snapshot();
    await as(player);
    await assert.rejects(
      rpc(db, "europe_prepare_drafts", [payload, randomUUID()]),
      /Administration/,
    );
    await as(admin);
    const nonce = randomUUID();
    const result = await rpc(db, "europe_prepare_drafts", [payload, nonce]);
    assert.equal(result.drafts, 1);
    assert.equal(result.newClubs, 1);
    assert.equal(result.published, 0);
    assert.deepEqual(await snapshot(), baseline);
    const saved = (
      await db.query(
        "select m.* from matches m join seasons s on s.id=m.season_id join competitions c on c.id=s.competition_id where c.slug='champions-league'",
      )
    ).rows[0];
    assert.equal(saved.is_published, false);
    const stats = (
      await db.query("select * from match_team_stats where match_id=$1", [
        saved.id,
      ])
    ).rows;
    assert.equal(stats.length, 2);
    for (const row of stats)
      for (const key of [
        "shots",
        "shots_on_target",
        "big_chances",
        "team_rating",
      ])
        assert.equal(row[key], null);
    const original = (
      await db.query("select * from teams where id=$1", [existing.id])
    ).rows[0];
    assert.deepEqual(original, existing);
    assert.deepEqual(
      await rpc(db, "europe_prepare_drafts", [payload, nonce]),
      result,
    );
    const again = await rpc(db, "europe_prepare_drafts", [
      payload,
      randomUUID(),
    ]);
    assert.equal(again.drafts, 0);
    assert.equal(again.existing, 1);
    assert.equal(again.newClubs, 0);
    // A second import locates its new club by the persisted external identity; it never overwrites it.
    assert.deepEqual(await snapshot(), baseline);
    await db.query("update matches set goals_home=3 where id=$1", [saved.id]);
    await db.query("update match_team_stats set shots=0 where match_id=$1", [
      saved.id,
    ]);
    assert.deepEqual(await snapshot(), baseline);
    await assert.rejects(
      rpc(db, "europe_prepare_drafts", [
        { ...payload, matches: [{ ...match, stage: "qualification" }] },
        randomUUID(),
      ]),
      /phase|saison/,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from europe_preparation_runs"))
        .rows[0].n,
      2,
    );
    await db.query(
      "update matches set is_published=true,verified_at=now() where id=$1",
      [saved.id],
    );
    assert.equal(
      (await db.query("select is_valid from form_snapshots")).rows[0].is_valid,
      false,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select enabled from arena_model")).rows[0].enabled,
      false,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(rpc(db, "europe_preparation_status"), /permission/);
  } finally {
    await db.close();
  }
});
test("European preview blocks qualifications, invented hours, invalid sources, club ambiguities and duplicated fixtures; missing scores remain null", () => {
  const dataset = {
    teams: [{ id: "porto", name: "FC Porto", country: "Portugal" }],
    seasons: [],
    competitions: [],
    members: [],
    matches: [],
    stats: [],
  };
  const row = {
    competition: "europa-league",
    season: "2026-2027",
    stage: "league-phase",
    round: "Journée 1",
    date: "2026-09-16 21:00",
    timezone: "Europe/Paris",
    home_team: "Porto",
    away_team: "Nouveau club",
    home_goals: "",
    away_goals: "",
    status: "finished",
    source_url: "https://source.test/result",
    away_country: "Suisse",
    away_identity_source_url: "https://source.test/club",
  };
  const plan = planEuropeanPreparation([row], dataset, {
    aliases: { Porto: "FC Porto" },
  });
  assert.deepEqual(plan.rows[0].errors, []);
  assert.equal(plan.rows[0].payload.goals_home, null);
  assert.equal(plan.rows[0].payload.kickoff, "2026-09-16T19:00:00.000Z");
  assert.equal(plan.clubs[0].existing_id, "porto");
  assert.equal(plan.summary.newClubs, 1);
  for (const bad of [
    { stage: "qualification" },
    { season: "2025-2026" },
    { date: "2026-09-16" },
    { date: "bad-date" },
    { source_url: "javascript:alert(1)" },
    { home_goals: "2", away_goals: "" },
    { home_team: "Nouveau club" },
  ]) {
    const p = planEuropeanPreparation([{ ...row, ...bad }], dataset, {
      aliases: { Porto: "FC Porto" },
    });
    assert.ok(p.rows[0].errors.length);
  }
  const duplicate = planEuropeanPreparation([row, row], dataset, {
    aliases: { Porto: "FC Porto" },
  });
  assert.ok(duplicate.rows[1].errors.some((e) => e.includes("répétée")));
  assert.ok(duplicate.errors.length);
  assert.throws(() => readEuropeanCSV("competition;season\n"), /vide/);
});
test("all 72 synthetic test fixtures import atomically as private drafts and a second import cannot duplicate clubs or matches", async () => {
  const { db, as, admin } = await setup();
  try {
    await db.exec(await migration());
    await as(admin);
    const clubs = [],
      matches = [];
    for (const competition of ["champions-league", "europa-league"]) {
      const keys = [];
      for (let i = 0; i < 36; i++) {
        const key = competition + "-" + i;
        keys.push(key);
        clubs.push({
          key,
          name: "Test " + key,
          slug: "test-" + key,
          short: "T" + i,
          country: "Pays de test",
          identity_source_url: "https://source.test/club/" + key,
        });
      }
      for (const round of [1, 2])
        for (let i = 0; i < 36; i += 2)
          matches.push({
            competition,
            season: "2026-2027",
            stage: "league-phase",
            round,
            kickoff:
              round === 1 ? "2026-09-15T19:00:00Z" : "2026-09-29T19:00:00Z",
            home_key: keys[(i + round - 1) % 36],
            away_key: keys[(i + round) % 36],
            status: "finished",
            goals_home: null,
            goals_away: null,
            source:
              "https://source.test/fixture/" +
              competition +
              "/" +
              round +
              "/" +
              i,
            is_published: true,
          });
    }
    const payload = { reviewed: true, clubs, matches };
    const first = await rpc(db, "europe_prepare_drafts", [
      payload,
      randomUUID(),
    ]);
    assert.equal(first.drafts, 72);
    assert.equal(first.newClubs, 72);
    assert.equal(first.published, 0);
    const again = await rpc(db, "europe_prepare_drafts", [
      payload,
      randomUUID(),
    ]);
    assert.equal(again.drafts, 0);
    assert.equal(again.newClubs, 0);
    assert.equal(again.existing, 72);
    const rows = (
      await db.query(
        "select m.* from matches m join seasons s on s.id=m.season_id join competitions c on c.id=s.competition_id where c.type='european-cup'",
      )
    ).rows;
    assert.equal(rows.length, 72);
    assert.ok(
      rows.every(
        (m) =>
          !m.is_published && m.goals_home === null && m.goals_away === null,
      ),
    );
    await db.exec("reset role;set role anon");
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from matches m join seasons s on s.id=m.season_id join competitions c on c.id=s.competition_id where c.type='european-cup'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
