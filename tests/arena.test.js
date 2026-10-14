import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCoins,
  maxStake,
  ticketNumbers,
  levelFor,
} from "../src/domain/arena.js";
import {
  createMatchdaySlots,
  planScheduledMatchday,
} from "../src/domain/matchday.js";

test("fractional coins and risk ceilings never round up; combination arithmetic matches exact decimal server flooring", () => {
  for (const [input, cents] of [
    ["5", 500],
    ["2,50", 250],
    ["0.01", 1],
    ["50.09", 5009],
  ])
    assert.equal(parseCoins(input), cents);
  for (const input of ["-1", "1e3", "1.005", "NaN", "1,2,3", "Infinity"])
    assert.equal(parseCoins(input), null);
  for (const [coins, limit] of [
    [5000, 250],
    [5001, 250],
    [10000, 500],
    [15000, 750],
    [20000, 1000],
    [200000, 1000],
    [19, 0],
  ])
    assert.equal(maxStake(coins), limit);
  const q = [
    { odds: "1.80", probability: 0.5 },
    { odds: "1.60", probability: 0.6 },
    { odds: "1.90", probability: 0.4 },
  ];
  const math = ticketNumbers(q, 500);
  assert.equal(math.gross, 2736);
  assert.equal(math.net, 2236);
  assert.ok(Math.abs(math.odds - 5.472) < 1e-12);
  assert.equal(
    ticketNumbers([{ odds: "1.01", probability: 0.98 }], 100).gross,
    101,
  );
  assert.equal(
    ticketNumbers([{ odds: "2", probability: 0.5 }], 100, "bookmaker", "3,20")
      .userRisk,
    220,
  );
  assert.equal(ticketNumbers(q, 100, "bookmaker", "NaN"), null);
  assert.equal(levelFor(10000).name, "Amateur");
  assert.equal(levelFor(9999).name, "Débutant");
});
const d = {
  competitions: [{ id: "c", type: "league" }],
  seasons: [{ id: "s", competition_id: "c", start_year: 2026, end_year: 2027 }],
  teams: Array.from({ length: 18 }, (_, i) => ({ id: "t" + i })),
  members: Array.from({ length: 18 }, (_, i) => ({
    season_id: "s",
    team_id: "t" + i,
  })),
  matches: [],
};
const header = {
  competition_id: "c",
  season_id: "s",
  round: "Journée 8",
  future: true,
  timezone: "Europe/Lisbon",
};
const now = new Date("2026-10-14T10:00:00Z");
test("future matchday requires authentic pairings and exact local kickoff; no blanks or fabricated scores are saved", () => {
  const slots = createMatchdaySlots(9, "2026-10-20");
  assert.equal(planScheduledMatchday(slots, header, d, now).length, 0);
  Object.assign(slots[0], {
    home_team: "t0",
    away_team: "t1",
    time: "20:30",
    home_goals: "7",
    home_shots: "99",
  });
  let p = planScheduledMatchday(slots, header, d, now);
  assert.deepEqual(p[0].errors, []);
  assert.equal(p[0].payload.kickoff, "2026-10-20T19:30:00.000Z");
  assert.equal(p[0].payload.status, "scheduled");
  assert.equal(p[0].payload.goals_home, null);
  assert.equal(p[0].payload.is_published, false);
  assert.deepEqual(p[0].payload.home_stats, {});
  slots[0].time = "";
  assert.ok(planScheduledMatchday(slots, header, d, now)[0].errors.length);
  slots[0].time = "20:30";
  slots[0].date = "2026-10-13";
  assert.ok(
    planScheduledMatchday(slots, header, d, now)[0].errors.some((e) =>
      e.includes("future"),
    ),
  );
  slots[0].date = "2026-10-20";
  Object.assign(slots[1], { home_team: "t0", away_team: "t2", time: "21:00" });
  assert.ok(
    planScheduledMatchday(slots, header, d, now).every((p) => p.errors.length),
  );
});
