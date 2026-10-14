import test from "node:test";
import assert from "node:assert/strict";
import { calculateResultsForm } from "../src/engines/resultsFormEngine.js";
import { formCoverage, teamHistory } from "../src/domain/simplified.js";
const form = (gf, ga, venue = "home") =>
  calculateResultsForm(
    Array(5).fill({ goals_for: gf, goals_against: ga, venue }),
  );
test("normalized goal and venue model is bounded and monotonic across ordinary and extreme scores", () => {
  for (const venue of ["home", "away", null]) {
    for (let gf = 0; gf < 12; gf++)
      for (let ga = 0; ga < 12; ga++) {
        const s = form(gf, ga, venue).score;
        assert.ok(s >= 0 && s <= 100);
        assert.ok(form(gf + 1, ga, venue).score >= s);
        assert.ok(form(gf, ga + 1, venue).score <= s);
      }
    for (const [gf, ga] of [
      [32767, 0],
      [0, 32767],
      [32767, 32767],
    ])
      assert.ok(
        form(gf, ga, venue).score >= 0 && form(gf, ga, venue).score <= 100,
      );
  }
  assert.ok(form(4, 0).score > form(1, 0).score);
  assert.ok(form(2, 1).score > form(1, 1).score);
  assert.ok(form(2, 0, "away").score > form(2, 0, "home").score);
});
test("components disclose actual bonuses, missing terrain never invents a bonus, old snapshots are not reused", () => {
  const home = form(2, 0),
    away = form(2, 0, "away"),
    unknown = form(2, 0, null);
  assert.equal(home.breakdown[0].components.homeCleanSheet, 3);
  assert.equal(away.breakdown[0].components.awayResult, 4);
  assert.equal(away.breakdown[0].components.awayGoals, 1.5);
  assert.equal(form(1, 1, "away").breakdown[0].components.awayResult, 2);
  assert.equal(form(0, 1, "away").breakdown[0].components.awayResult, 0);
  assert.equal(unknown.venueKnown, 0);
  assert.equal(unknown.breakdown[0].components.awayGoals, 0);
  assert.equal(unknown.breakdown[0].components.homeCleanSheet, 0);
  const history = Array(5).fill({
    goals_for: 2,
    goals_against: 0,
    venue: "home",
    entry_type: "complete",
  });
  const coverage = formCoverage(history, {
    score: 100,
    is_valid: true,
    is_published: true,
    model_version: "results-points-v1",
    index_variant: "provisional",
  });
  assert.equal(coverage.score, home.score);
  assert.equal(coverage.compatibilityGroup, "results-context-v2");
  assert.equal(coverage.venueKnown, 5);
});
test("five real integer scores are required and full-match terrain follows the team perspective", () => {
  for (const invalid of [
    null,
    undefined,
    "",
    " ",
    false,
    -1,
    0.5,
    Infinity,
    32768,
  ])
    assert.equal(form(invalid, 0).score, null);
  assert.equal(
    calculateResultsForm(Array(4).fill({ goals_for: 1, goals_against: 0 }))
      .score,
    null,
  );
  assert.notEqual(form(0, 0).score, null);
  const d = {
    matches: [
      {
        id: "m",
        home_team_id: "a",
        away_team_id: "b",
        status: "finished",
        goals_home: 2,
        goals_away: 1,
        is_published: true,
        kickoff: "2026-10-01T12:00:00Z",
      },
    ],
    seasons: [],
    stats: [],
  };
  assert.equal(teamHistory(d, "a")[0].venue, "home");
  assert.equal(teamHistory(d, "b")[0].venue, "away");
});
