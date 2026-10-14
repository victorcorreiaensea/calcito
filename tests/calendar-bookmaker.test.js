import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setup, rpc } from "./support/arena-fixture.js";
import { planCalendar, calendarLeagues } from "../src/domain/calendar.js";
const source =
  "https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json";
async function upgrade() {
  const data = await setup();
  await data.db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/004_calendar_bookmaker.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return data;
}
test("autonomous bookmaker stakes come from the server, vary with edge, enforce exposure caps, replay idempotently and cannot be bypassed with a client stake", async () => {
  const { db, player, quote, as } = await upgrade();
  try {
    await as(player);
    let d = await rpc(db, "arena_bookmaker_preview", [[quote], 1.5]);
    assert.equal(d.accepted, false);
    assert.equal(d.stake, 0);
    assert.equal((await rpc(db, "arena_account")).wallet.reserved, 0);
    const weak = await rpc(db, "arena_bookmaker_preview", [[quote], 2.2]);
    assert.equal(weak.stake, 208);
    assert.equal(weak.userRisk, 249);
    const strong = await rpc(db, "arena_bookmaker_preview", [[quote], 3.2]);
    assert.ok(strong.stake > weak.stake);
    assert.ok(strong.userRisk <= 1000);
    const nonce = randomUUID();
    d = await rpc(db, "arena_offer_bookmaker", [
      [quote],
      2.2,
      nonce,
      weak.userRisk,
    ]);
    assert.equal(d.ticket.stake, 208);
    assert.equal(d.ticket.user_risk, 249);
    const available = (await rpc(db, "arena_account")).wallet.available;
    assert.equal(available, 19751);
    assert.equal(
      (
        await rpc(db, "arena_offer_bookmaker", [
          [quote],
          2.2,
          nonce,
          weak.userRisk,
        ])
      ).ticket.id,
      d.ticket.id,
    );
    assert.equal((await rpc(db, "arena_account")).wallet.available, available);
    await assert.rejects(
      () =>
        rpc(db, "arena_offer_bookmaker", [[quote], 2.3, nonce, weak.userRisk]),
      /déjà utilisé/,
    );
    await assert.rejects(
      () =>
        rpc(db, "arena_place_ticket", [
          [quote],
          999,
          "bookmaker",
          2.2,
          randomUUID(),
        ]),
      /choisie par Calcito/,
    );
    await assert.rejects(
      () =>
        rpc(db, "_arena_place_ticket_v5", [
          [quote],
          100,
          "bookmaker",
          2.2,
          randomUUID(),
        ]),
      /permission denied/,
    );
    const refused = await rpc(db, "arena_offer_bookmaker", [
      [quote],
      1.5,
      randomUUID(),
      null,
    ]);
    assert.equal(refused.accepted, false);
    assert.equal((await rpc(db, "arena_account")).wallet.available, available);
    await assert.rejects(
      () => db.exec("update arena_offers set decision='{}'"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("calendar synchronization is owner-only, deduplicates reruns, preserves official results and frozen odds, and refunds a postponed ticket", async () => {
  const { db, admin, player, match, quote, as, season, teams } =
    await upgrade();
  try {
    await as(player);
    const bet = await rpc(db, "arena_place_ticket", [
      [quote],
      100,
      "challenge",
      null,
      randomUUID(),
    ]);
    const e = {
      external_key: "fr:2026:J1:Club0:Club1",
      source,
      timezone: "Europe/Paris",
      season_id: season,
      home_team_id: teams[0],
      away_team_id: teams[1],
      round: "J1",
      kickoff: match.kickoff,
      status: "scheduled",
      expected_updated_at: match.updated_at,
    };
    await assert.rejects(
      () => rpc(db, "arena_calendar_apply", [[e], randomUUID()]),
      /Administration/,
    );
    await as(admin);
    let r = await rpc(db, "arena_calendar_apply", [[e], randomUUID()]);
    assert.equal(r.added, 0);
    assert.equal(r.unchanged, 1);
    const n = randomUUID();
    r = await rpc(db, "arena_calendar_apply", [
      [{ ...e, status: "postponed" }],
      n,
    ]);
    assert.equal(r.updated, 1);
    assert.equal(
      (
        await rpc(db, "arena_calendar_apply", [
          [{ ...e, status: "postponed" }],
          n,
        ])
      ).replayed,
      true,
    );
    await as(player);
    const account = await rpc(db, "arena_account");
    assert.equal(account.wallet.available, 20000);
    assert.equal(account.wallet.reserved, 0);
    assert.equal(account.tickets[0].odds, bet.ticket.odds);
    assert.equal(account.tickets[0].status, "void");
    await as(admin);
    const insert = {
      ...e,
      external_key: "fr:2026:J2:Club2:Club3",
      round: "J2",
      home_team_id: teams[2],
      away_team_id: teams[3],
      expected_updated_at: null,
    };
    r = await rpc(db, "arena_calendar_apply", [[insert], randomUUID()]);
    assert.equal(r.added, 1);
    const saved = (
      await db.query("select *from matches where home_team_id=$1", [teams[2]])
    ).rows[0];
    assert.equal(saved.status, "scheduled");
    assert.equal(saved.goals_home, null);
    assert.equal(saved.is_published, true);
    await db.exec("reset role");
    await db.query(
      "update matches set kickoff=now()-interval '1 minute',status='finished',goals_home=2,goals_away=1 where id=$1",
      [saved.id],
    );
    await as(admin);
    r = await rpc(db, "arena_calendar_apply", [[insert], randomUUID()]);
    assert.equal(r.unchanged, 1);
    assert.equal(
      (await db.query("select goals_home from matches where id=$1", [saved.id]))
        .rows[0].goals_home,
      2,
    );
  } finally {
    await db.close();
  }
});
test("two next games are selected per club and deduplicated; missing second kickoff is reported rather than replaced by a later fixture", () => {
  const teams = ["A", "B", "C", "D"].map((name) => ({
    id: name,
    name,
    is_published: true,
  }));
  const dataset = {
    teams,
    competitions: [
      { id: "c", slug: "ligue-1", type: "league", is_published: true },
    ],
    seasons: [
      { id: "s", competition_id: "c", start_year: 2026, is_published: true },
    ],
    members: teams.map((t) => ({ team_id: t.id, season_id: "s" })),
    matches: [],
  };
  const matches = [
    { round: "J1", date: "2026-10-10", time: "20:00", team1: "A", team2: "B" },
    { round: "J2", date: "2026-10-16", time: "20:00", team1: "A", team2: "B" },
    { round: "J2", date: "2026-10-16", time: "21:00", team1: "C", team2: "D" },
    { round: "J3", date: "2026-10-23", team1: "A", team2: "C" },
    { round: "J3", date: "2026-10-23", time: "20:00", team1: "B", team2: "D" },
    { round: "J4", date: "2026-10-30", time: "20:00", team1: "A", team2: "D" },
  ];
  const p = planCalendar(
    {
      feeds: [{ code: "fr", source, matches }],
      clubs: [],
      fetchedAt: "2026-10-14",
      sourceCommit: "test",
    },
    dataset,
    new Date("2026-10-14T12:00:00Z"),
  );
  assert.equal(p.rows.length, 3);
  assert.equal(new Set(p.rows.map((r) => r.external_key)).size, 3);
  assert.ok(p.issues.some((i) => i.reason.includes("Horaire")));
  assert.ok(!p.rows.some((r) => r.round === "J4"));
  assert.equal(p.coverage.find((c) => c.club === "A").found, 1);
  assert.equal(p.rows[0].kickoff, "2026-10-16T18:00:00.000Z");
});

test("the combined installer initializes only verified future pairings from the published club catalog and is safe to replay its seed", async () => {
  const { db } = await setup();
  try {
    await db.exec(
      "reset role;delete from arena_quotes;delete from match_team_stats;delete from matches;delete from season_teams;delete from seasons;",
    );
    const catalog = JSON.parse(
      await readFile(
        new URL(
          "../public/data/upcoming-preview-2026-2027.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const clubs = new Map();
    for (const r of catalog.rows) {
      clubs.set(r.home_team_id, r.home);
      clubs.set(r.away_team_id, r.away);
    }
    await db.exec(
      "delete from teams;update competitions set is_published=true;",
    );
    for (const [id, name] of clubs)
      await db.query(
        "insert into teams(id,name,short,slug,country,is_published)values($1,$2,$3,$4,$5,true)",
        [id, name, name.slice(0, 8), "club-" + id, "Test catalog"],
      );
    const seasons = new Map(catalog.rows.map((r) => [r.season_id, r]));
    for (const [id, r] of seasons) {
      const league = calendarLeagues.find((l) => l.name === r.league);
      const cid = (
        await db.query("select id from competitions where slug=$1", [
          league.slug,
        ])
      ).rows[0].id;
      await db.query(
        "insert into seasons(id,competition_id,label,start_year,end_year,is_published)values($1,$2,'2026–2027',2026,2027,true)",
        [id, cid],
      );
      const members = new Set(
        catalog.rows
          .filter((x) => x.season_id === id)
          .flatMap((x) => [x.home_team_id, x.away_team_id]),
      );
      for (const tid of members)
        await db.query(
          "insert into season_teams(season_id,team_id)values($1,$2)",
          [id, tid],
        );
    }
    const sql = await readFile(
      new URL(
        "../public/downloads/calcito-calendrier-bookmaker.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(sql);
    const future = catalog.rows.filter(
      (r) => Date.parse(r.kickoff) > Date.now(),
    ).length;
    let rows = (await db.query("select *from matches")).rows;
    assert.equal(rows.length, future);
    assert.ok(
      rows.every(
        (m) =>
          m.status === "scheduled" &&
          m.is_published &&
          m.goals_home === null &&
          m.goals_away === null,
      ),
    );
    const seed = sql.slice(sql.indexOf("-- Initial calendar"));
    await db.exec(seed);
    assert.equal((await db.query("select *from matches")).rows.length, future);
    assert.equal(
      (await db.query("select *from arena_calendar_runs")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
