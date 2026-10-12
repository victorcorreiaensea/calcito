import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCalcitoForm,
  prepareCalcitoInput,
  EUROPEAN_COEFFICIENT,
} from "../src/engines/calcitoEngine.js";
import {
  calculatePrediction,
  theoreticalOdds,
  validateProbabilities,
} from "../src/engines/predictionEngine.js";
import { createPredictionHistory } from "../src/services/predictionHistory.js";

const matches = Array.from({ length: 6 }, (_, i) => ({
  id: String(i),
  kickoff: `2030-06-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
  status: "finished",
  home: { id: "a", name: "A" },
  away: { id: "b", name: "B" },
  goalsHome: 2,
  goalsAway: 1,
  competition: { id: "europe-confirmed" },
  teamStats: { shots: 0, bigChances: 0, rating: 7, bonuses: [] },
  sourceReference: `fixture-${i}`,
}));
const coefficients = { "europe-confirmed": EUROPEAN_COEFFICIENT };
test("selects five latest unique finished matches for the selected team", () => {
  const prepared = prepareCalcitoInput({
    teamId: "a",
    matches: [
      ...matches,
      matches[0],
      { ...matches[5], id: "live", status: "live" },
      { ...matches[5], id: "unrelated", home: { id: "z" } },
    ],
    competitionCoefficients: coefficients,
  });
  assert.equal(prepared.complete, true);
  assert.deepEqual(
    prepared.trace.map((item) => item.matchId),
    ["5", "4", "3", "2", "1"],
  );
  assert.equal(prepared.trace[0].statistics.shots, 0);
  assert.equal(prepared.trace[0].sourceReference, "fixture-5");
});
test("missing stats or coefficients prevent a definitive score and are not replaced", () => {
  let called = false;
  const result = calculateCalcitoForm(
    {
      teamId: "a",
      matches: matches.map((m) => ({
        ...m,
        teamStats: { ...m.teamStats, shots: null },
      })),
    },
    {
      formula: () => {
        called = true;
        return 90;
      },
      formulaVersion: "test",
    },
  );
  assert.equal(result.score, null);
  assert.equal(called, false);
  assert.equal(result.trace[0].statistics.shots, null);
  assert.ok(result.missing.some((item) => item.includes("coefficient")));
});
test("complete data still requires an explicit formula and version", () => {
  assert.equal(
    calculateCalcitoForm({
      teamId: "a",
      matches,
      competitionCoefficients: coefficients,
    }).status,
    "formula-pending",
  );
  assert.throws(() =>
    calculateCalcitoForm(
      { teamId: "a", matches, competitionCoefficients: coefficients },
      { formula: () => 101, formulaVersion: "test-only" },
    ),
  );
});
test("opponent results are interpreted from the selected team perspective", () => {
  assert.equal(
    prepareCalcitoInput({
      teamId: "b",
      matches,
      competitionCoefficients: coefficients,
    }).trace[0].result,
    "D",
  );
});
test("uncalibrated or absent prediction models never produce probabilities or odds", () => {
  const pending = calculatePrediction({
    match: { home: { score: 92 }, away: { score: 64 } },
    model: {
      calibrated: false,
      predict: () => {
        throw new Error("Must not run");
      },
    },
  });
  assert.equal(pending.probabilities, null);
  assert.equal(pending.odds, null);
  assert.equal(pending.calculatedAt, null);
});
test("probabilities must sum to one and odds invert decimals; zero has no finite odds", () => {
  assert.throws(() =>
    validateProbabilities({ home: 0.5, draw: 0.3, away: 0.3 }),
  );
  assert.throws(() => validateProbabilities({ home: -1, draw: 1, away: 1 }));
  assert.deepEqual(theoreticalOdds({ home: 0.5, draw: 0.25, away: 0.25 }), {
    home: 2,
    draw: 4,
    away: 4,
  });
  assert.equal(theoreticalOdds({ home: 1, draw: 0, away: 0 }).draw, null);
});
test("prediction history preserves probabilities and evaluates an actual final result", () => {
  const entries = new Map();
  const history = createPredictionHistory({
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  });
  assert.deepEqual(history.list(), []);
  history.save({
    id: "one",
    match: { id: "1", homeName: "A", awayName: "B" },
    modelVersion: "test-only",
    predictedAt: "2030-01-01T00:00:00Z",
    probabilities: { home: 0.5, draw: 0.25, away: 0.25 },
  });
  assert.equal(history.evaluate("one", "home"), 0.375);
  assert.equal(history.list()[0].finalResult, "home");
  assert.equal(history.list()[0].evaluation.metric, "brier-sum");
});
