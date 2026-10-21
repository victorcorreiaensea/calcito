import test from "node:test";
import assert from "node:assert/strict";
import {
  poissonMarkets,
  estimateGoals,
  predictionRecords,
  evaluateGoals,
  displayProbabilities,
  fairOdd,
} from "../src/engines/goalPredictionEngine.js";
import { predictionFixture } from "./support/prediction-fixture.js";
const cutoff = "2026-10-20T12:00:00Z";
const estimate = (dataset) =>
  estimateGoals({
    dataset,
    homeId: "club-0",
    awayId: "club-1",
    year: 2026,
    cutoff,
  });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test("all goal markets come from a coherent Poisson distribution, including degenerate zero rates", () => {
  for (const [h, a] of [
    [0, 0],
    [0, 2],
    [1.4, 0.9],
    [6, 6],
    [0.1, 5.9],
  ]) {
    const { probabilities: p, markets: m } = poissonMarkets(h, a);
    close(p.home + p.draw + p.away, 1);
    for (const value of Object.values(m))
      assert.ok(value >= -1e-12 && value <= 1 + 1e-12);
    close(m.btts_yes + m.btts_no, 1);
    close(m.home_scores + m.home_blank, 1);
    close(m.away_scores + m.away_blank, 1);
    close(m.home_scores, 1 - Math.exp(-h));
    close(m.away_scores, 1 - Math.exp(-a));
    close(m.btts_yes, m.home_scores * m.away_scores);
    assert.ok(m.over_1_5 >= m.over_2_5 && m.over_2_5 >= m.over_3_5);
    for (const n of [1, 2, 3]) close(m[`over_${n}_5`] + m[`under_${n}_5`], 1);
  }
  assert.equal(poissonMarkets(0, 0).probabilities.draw, 1);
  assert.equal(fairOdd(0), null);
  assert.equal(fairOdd(Number.NaN), null);
  assert.equal(fairOdd(0.25), 4);
  assert.throws(() => poissonMarkets(-1, 1));
  assert.deepEqual(
    displayProbabilities({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }),
    { home: 33.4, draw: 33.3, away: 33.3 },
  );
  close(
    Object.values(
      displayProbabilities({ home: 0.12345, draw: 0.23456, away: 0.64199 }),
    ).reduce((a, b) => a + b, 0),
    100,
  );
});
test("goals model requires five results per team and a population reference, never uses form scores or missing goals", () => {
  const d = predictionFixture(),
    f = estimate(d);
  assert.equal(f.status, "estimated");
  assert.equal(f.quality.home, 5);
  assert.equal(f.quality.poolHome, 160);
  d.teams.forEach((t) => (t.score = 100000));
  assert.deepEqual(estimate(d), f);
  const sparse = { ...d, matches: d.matches.slice(0, 4) };
  assert.equal(estimate(sparse).status, "unavailable");
  assert.match(
    estimate({ ...d, matches: d.matches.slice(0, 28) }).reason,
    /30 résultats/,
  );
  assert.equal(
    estimateGoals({
      dataset: d,
      homeId: "club-0",
      awayId: "club-1",
      year: 2025,
      cutoff,
    }).status,
    "unavailable",
  );
  const missing = {
    ...d,
    matches: d.matches.map((m) => ({ ...m, goals_home: null })),
  };
  assert.equal(estimate(missing).status, "unavailable");
  assert.equal(
    estimateGoals({
      dataset: d,
      homeId: "club-0",
      awayId: "club-0",
      year: 2026,
      cutoff,
    }).status,
    "unavailable",
  );
});
test("cutoffs exclude future, private, same-day, late imports and retrospective corrections", () => {
  const d = predictionFixture(),
    f = estimate(d);
  const contaminated = structuredClone(d),
    base = d.matches[0];
  for (const extra of [
    { id: "future", kickoff: "2026-11-01T12:00:00Z" },
    {
      id: "same-day",
      kickoff: "2026-10-20T01:00:00Z",
      updated_at: "2026-10-20T04:00:00Z",
      verified_at: "2026-10-20T04:00:00Z",
    },
    {
      id: "late",
      kickoff: "2026-10-01T12:00:00Z",
      updated_at: "2026-11-01T12:00:00Z",
    },
    { id: "draft", kickoff: "2026-10-02T12:00:00Z", is_published: false },
  ])
    contaminated.matches.push({ ...base, goals_home: 99, ...extra });
  assert.deepEqual(estimate(contaminated), f);
  const late = structuredClone(d);
  late.matches.forEach((m) => (m.updated_at = "2026-11-01T12:00:00Z"));
  assert.equal(estimate(late).status, "unavailable");
  assert.equal(evaluateGoals(late, { year: 2026, cutoff }).sample, 0);
});
test("neutral simulations are symmetric and the venue effect follows observed home/away goal baselines", () => {
  const d = predictionFixture(),
    args = { dataset: d, year: 2026, cutoff, venue: "neutral" };
  const a = estimateGoals({ ...args, homeId: "club-0", awayId: "club-1" }),
    b = estimateGoals({ ...args, homeId: "club-1", awayId: "club-0" });
  close(a.probabilities.home, b.probabilities.away);
  close(a.markets.home_scores, b.markets.away_scores);
  const home = estimate(d);
  assert.ok(home.expectedGoals.home > a.expectedGoals.home);
  assert.ok(home.expectedGoals.away < a.expectedGoals.away);
});
test("resolved quick scores are deduplicated, detailed matches take priority, and conflicting mirrors are excluded", () => {
  const d = predictionFixture(),
    r = d.matches[0];
  const quick = {
    id: "quick",
    team_id: r.home_team_id,
    opponent_team_id: r.away_team_id,
    venue: "home",
    competition_name: "Ligue 1",
    season_start_year: 2026,
    goals_for: r.goals_home,
    goals_against: r.goals_away,
    kickoff: r.kickoff,
    updated_at: r.updated_at,
    is_published: true,
  };
  d.simplified.push(quick);
  assert.equal(predictionRecords(d).length, 160);
  d.matches.shift();
  assert.equal(predictionRecords(d).length, 160);
  d.simplified.push({
    ...quick,
    id: "mirror",
    team_id: r.away_team_id,
    opponent_team_id: r.home_team_id,
    venue: "away",
    goals_for: r.goals_away,
    goals_against: 99,
  });
  assert.equal(predictionRecords(d).length, 159);
});
test("historical walk-forward evaluation reports actual Brier scores, a chronological baseline and calibration bins", () => {
  const d = predictionFixture(),
    report = evaluateGoals(d, { year: 2026, cutoff });
  assert.equal(report.sample, 60);
  assert.equal(report.status, "evaluated");
  assert.ok(report.brier >= 0 && report.brier <= 2);
  assert.ok(report.baselineBrier >= 0 && report.baselineBrier <= 2);
  assert.ok(report.binaryBrier >= 0 && report.binaryBrier <= 1);
  assert.equal(
    report.bins.reduce((n, b) => n + b.count, 0),
    report.sample * 3,
  );
  assert.equal(report.scope.includes("ne certifie pas"), true);
});
