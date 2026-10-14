import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFormStory,
  formAppreciation,
  formDimensions,
} from "../src/domain/formPresentation.js";
import { calculateResultsForm } from "../src/engines/resultsFormEngine.js";
const trace = [
  [3, 0, "away"],
  [2, 0, "home"],
  [1, 1, "away"],
  [0, 2, "home"],
  [4, 1, "away"],
].map(([goalsFor, goalsAgainst, venue], i) => ({
  matchId: `m${i}`,
  goalsFor,
  goalsAgainst,
  venue,
}));
const computed = calculateResultsForm(
  trace.map((t) => ({
    goals_for: t.goalsFor,
    goals_against: t.goalsAgainst,
    venue: t.venue,
  })),
);
test("form story uses only actual scores and terrain; contributions sum to the existing model without changing it", () => {
  const s = buildFormStory(trace, {
    modelVersion: computed.formulaVersion,
    breakdown: computed.breakdown,
  });
  assert.equal(s.wins, 3);
  assert.equal(s.draws, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.goalsFor, 10);
  assert.equal(s.goalsAgainst, 4);
  assert.equal(s.cleanSheets, 2);
  assert.equal(s.awayWins, 2);
  assert.equal(s.awayGoals, 8);
  assert.equal(s.unbeatenStreak, 3);
  assert.ok(
    Math.abs(s.contributions.reduce((a, b) => a + b, 0) - computed.score) <
      1e-10,
  );
  assert.match(s.summary, /attaque/);
  assert.match(s.summary, /extérieur/);
  const dimensions = formDimensions(
    computed.breakdown,
    computed.formulaVersion,
  );
  assert.equal(dimensions.length, 5);
  assert.ok(
    Math.abs(dimensions.reduce((n, d) => n + d.value, 0) - computed.score) <
      1e-10,
  );
  assert.equal(
    dimensions.find((d) => d.key === "away").value,
    (100 *
      computed.breakdown.reduce(
        (n, b) => n + b.components.awayResult + b.components.awayGoals,
        0,
      )) /
      (5 * 97),
  );
});
test("unknown or incomplete models do not receive fabricated contributions or claims of exterior bonuses", () => {
  for (const modelVersion of [null, "results-points-v1", "other-model"]) {
    const s = buildFormStory(trace, {
      modelVersion,
      breakdown: computed.breakdown,
    });
    assert.deepEqual(s.contributions, []);
    assert.doesNotMatch(s.summary, /renforcent l’indice/);
    assert.deepEqual(formDimensions(computed.breakdown, modelVersion), []);
  }
  assert.deepEqual(
    formDimensions(Array(5).fill({ components: {} }), computed.formulaVersion),
    [],
  );
  assert.deepEqual(
    buildFormStory(trace, {
      modelVersion: computed.formulaVersion,
      breakdown: [...computed.breakdown].reverse(),
    }).contributions,
    [],
  );
  const partial = buildFormStory(trace.slice(0, 2));
  assert.equal(partial.sampleSize, 2);
  assert.match(partial.summary, /incomplète/);
  assert.deepEqual(partial.contributions, []);
  const missing = buildFormStory([
    { goalsFor: null, goalsAgainst: 0 },
    ...trace.slice(0, 4),
  ]);
  assert.equal(missing.sampleSize, 4);
  assert.equal(missing.unbeatenStreak, null);
  const unknown = buildFormStory(trace.map((t) => ({ ...t, venue: null })));
  assert.equal(unknown.awayWins, 0);
  assert.equal(unknown.venueKnown, 0);
  assert.equal(buildFormStory([]).sampleSize, 0);
});
test("appreciations describe current index levels and do not claim a trend or a probability", () => {
  assert.equal(formAppreciation(95), "En feu");
  assert.equal(formAppreciation(80), "Très bonne forme");
  assert.equal(formAppreciation(50), "Forme modérée");
  assert.equal(formAppreciation(20), "En difficulté");
  for (const s of [null, NaN, undefined, 101, -1])
    assert.equal(formAppreciation(s), "Indice indisponible");
});
test("v4 dimensions sum to the actual bounded dynamic index and disclose estimated context", async () => {
  const { reconstructDynamicForms } =
    await import("../src/engines/dynamicFormEngine.js");
  const dataset = {
    seasons: [{ id: "s", start_year: 2026 }],
    matches: Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      season_id: "s",
      home_team_id: "a",
      away_team_id: "b",
      goals_home: i % 2 ? 32767 : 0,
      goals_away: i % 2 ? 0 : 32767,
      status: "finished",
      is_published: true,
      kickoff: `2026-08-${String(i + 1).padStart(2, "0")}T18:00:00Z`,
    })),
    simplified: [],
  };
  const ledger = reconstructDynamicForms(dataset, 2026);
  for (const history of ledger.histories.values())
    for (let i = 4; i < history.length; i++) {
      const dimensions = formDimensions(
        history.slice(i - 4, i + 1),
        ledger.version,
      );
      assert.ok(
        Math.abs(
          dimensions.reduce((n, d) => n + d.value, 0) - history[i].after,
        ) < 1e-10,
      );
    }
});
