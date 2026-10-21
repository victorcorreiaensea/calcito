import test from "node:test";
import assert from "node:assert/strict";
import { predictionFixture } from "./support/prediction-fixture.js";
import {
  statisticalRecords,
  priorRecords,
  coverageAudit,
} from "../src/engines/statistics/data.js";
import { teamProfile } from "../src/engines/statistics/profiles.js";
import { experimentalForm } from "../src/engines/statistics/form.js";
import {
  researchGoals,
  researchCounts,
  countTail,
  goalVariants,
} from "../src/engines/statistics/probabilities.js";
import {
  validateResearch,
  summarizeValidation,
} from "../src/engines/statistics/validation.js";
import { validatedTheoreticalOdds } from "../src/engines/statistics/odds.js";
import { createResearchReport } from "../src/services/statisticalResearchService.js";
const cutoff = "2026-10-21T12:00:00Z";
const options = {
  cutoff,
  year: 2026,
  homeId: "club-0",
  awayId: "club-1",
  competitionId: "league",
  venue: "home",
};
function withStatistics() {
  const data = predictionFixture();
  data.stats = data.matches.flatMap((r, i) =>
    [r.home_team_id, r.away_team_id].map((id, j) => ({
      match_id: r.id,
      team_id: id,
      shots: 8 + (i % 13) + j,
      shots_on_target: i % 6,
      corners: (i * 3 + j) % 11,
      possession: j ? 46 : 54,
      created_at: r.verified_at,
      updated_at: r.updated_at,
    })),
  );
  return data;
}

test("profiles preserve unknown versus zero and use per-statistic denominators, home/away and paired accuracy", () => {
  const data = withStatistics();
  const own = data.stats.filter((s) => s.team_id === "club-0");
  own.forEach((s) => {
    s.shots = null;
    s.shots_on_target = null;
  });
  own[0].shots = 10;
  own[0].shots_on_target = 0;
  own[1].shots = 20;
  own[1].shots_on_target = 4;
  own[2].shots = 0;
  own[2].shots_on_target = 0;
  const rows = statisticalRecords(data);
  const p = teamProfile(rows, { ...options, teamId: "club-0" });
  assert.equal(p.n, 40);
  assert.equal(p.for.shots.n, 3);
  assert.equal(p.for.shots.mean, 10);
  assert.equal(p.for.shots_on_target.mean, 4 / 3);
  assert.equal(p.for.woodwork.mean, null);
  assert.equal(p.for.woodwork.n, 0);
  assert.equal(p.accuracy.n, 2);
  assert.equal(p.accuracy.ratio, 4 / 30);
  assert.equal(p.home.n + p.away.n, p.n);
  assert.ok(p.against.shots.n > p.for.shots.n);
  const audit = coverageAudit(rows, options);
  assert.equal(audit.teams.find((t) => t.id === "club-0").fields.shots.n, 3);
  assert.equal(audit.fields.woodwork.coverage, 0);
});

test("late or unknown stats timestamps, duplicate rows and invalid values cannot supply historical features", () => {
  const data = withStatistics(),
    first = data.stats[0];
  first.updated_at = "2027-01-01T00:00:00Z";
  data.stats[1].created_at = null;
  data.stats[2].shots = "";
  data.stats[3].shots_on_target = 900;
  data.stats.push({ ...data.stats[4] });
  const rows = statisticalRecords(data);
  const p = teamProfile(rows, {
    ...options,
    teamId: data.matches[0].home_team_id,
  });
  assert.equal(p.n, 40);
  assert.equal(coverageAudit(rows, options).fields.shots.n, 316);
  const original = structuredClone(data);
  original.stats = [];
  assert.equal(
    teamProfile(statisticalRecords(original), { ...options, teamId: "club-0" })
      .for.shots.mean,
    null,
  );
});

test("new goals are coherent and experimental for every computable variant; no unvalidated odds", () => {
  const rows = statisticalRecords(withStatistics());
  for (const variant of goalVariants) {
    const f = researchGoals(rows, options, variant);
    assert.equal(f.status, "experimental", variant);
    assert.equal(f.odds, null);
    assert.ok(
      Math.abs(Object.values(f.probabilities).reduce((s, n) => s + n, 0) - 1) <
        1e-12,
    );
    for (const [yes, no] of [
      ["btts_yes", "btts_no"],
      ["home_scores", "home_blank"],
      ["away_scores", "away_blank"],
      ...[1, 2, 3].map((n) => [`over_${n}_5`, `under_${n}_5`]),
    ])
      assert.ok(Math.abs(f.markets[yes] + f.markets[no] - 1) < 1e-12);
  }
  const neutral = researchGoals(rows, { ...options, venue: "neutral" });
  const swapped = researchGoals(rows, {
    ...options,
    venue: "neutral",
    homeId: options.awayId,
    awayId: options.homeId,
  });
  assert.equal(neutral.expectedGoals.home, swapped.expectedGoals.away);
  assert.equal(neutral.expectedGoals.away, swapped.expectedGoals.home);
});

test("score-only history supports goal research but never invents shot/corner markets or performance indices", () => {
  const rows = statisticalRecords(predictionFixture());
  assert.equal(researchGoals(rows, options).status, "experimental");
  assert.equal(researchGoals(rows, options, "shots").status, "unavailable");
  assert.equal(
    researchCounts(rows, options, "corners", "home", 4).status,
    "unavailable",
  );
  const form = experimentalForm(rows, { ...options, teamId: "club-0" });
  assert.notEqual(form.variants.results.score, null);
  assert.notEqual(form.variants.goals.score, null);
  assert.equal(form.variants.shots.score, null);
  assert.equal(form.variants.accuracy.score, null);
});

test("insufficient, cross-competition, stale or identical-team requests do not produce false precision", () => {
  const rows = statisticalRecords(withStatistics());
  for (const opts of [
    { ...options, competitionId: "europe" },
    { ...options, homeId: "unknown" },
    { ...options, awayId: options.homeId },
    { ...options, cutoff: "2027-10-21T00:00:00Z" },
  ])
    assert.equal(researchGoals(rows, opts).status, "unavailable");
  assert.equal(researchGoals(rows.slice(0, 20), options).status, "unavailable");
  assert.throws(() => priorRecords(rows, { ...options, cutoff: "bad" }));
});

test("counts use their own observed samples; Poisson and overdispersed negative-binomial tails are coherent", () => {
  assert.equal(countTail(0, 0, 3), 0);
  assert.ok(Math.abs(countTail(1, 1, 1) - (1 - Math.exp(-1))) < 1e-12);
  assert.equal(countTail(4, 4, 3, "negative-binomial"), countTail(4, 4, 3));
  assert.notEqual(
    countTail(4, 12, 3, "negative-binomial"),
    countTail(4, 12, 3),
  );
  assert.throws(() => countTail(-1, 1, 3));
  for (const model of ["poisson", "negative-binomial"]) {
    let previous = 1;
    for (const threshold of [3, 4, 5]) {
      const f = researchCounts(
        statisticalRecords(withStatistics()),
        options,
        "shots_on_target",
        "home",
        threshold,
        model,
      );
      assert.equal(f.status, "experimental");
      assert.equal(f.probability + f.complement, 1);
      assert.ok(f.probability <= previous);
      assert.ok(f.quality.home >= 8);
      previous = f.probability;
    }
  }
});

test("temporal replay is deterministic and unchanged by future results, later-entered statistics or future ratings", () => {
  const data = withStatistics(),
    rows = statisticalRecords(data);
  const early = { ...options, cutoff: "2026-08-25T00:00:00Z", limit: 60 };
  const validation = validateResearch(rows, data, early);
  const altered = structuredClone(data);
  altered.forms = [{ score: 100, team_id: "club-0" }];
  for (const r of altered.matches)
    if (r.kickoff >= early.cutoff) {
      r.goals_home = 70;
      r.goals_away = 60;
    }
  for (const s of altered.stats)
    if (s.updated_at >= early.cutoff) {
      s.shots = 99;
      s.shots_on_target = 70;
    }
  assert.deepEqual(
    validation,
    validateResearch(statisticalRecords(altered), altered, early),
  );
  for (const m of Object.values(validation.goals)) {
    assert.equal(m.development.n + m.holdout.n, m.all.n);
    assert.ok(m.traces.every((t) => t.date < early.cutoff.slice(0, 10)));
  }
  assert.equal(validation.selection.activated, false);
  assert.deepEqual(validation.selection.retainedAdditionalVariables, []);
  const allLate = withStatistics();
  allLate.stats.forEach((s) => {
    s.updated_at = cutoff;
  });
  const lateValidation = validateResearch(
    statisticalRecords(allLate),
    allLate,
    options,
  );
  assert.equal(Object.keys(lateValidation.counts).length, 0);
});

test("paired metrics, log loss, binary calibration and no evidence on an empty dataset", () => {
  assert.equal(summarizeValidation([]).brier, null);
  const data = withStatistics(),
    result = validateResearch(statisticalRecords(data), data, options);
  assert.ok(result.goals.recent.all.n > 60);
  assert.ok(
    result.goals.recent.all.brier >= 0 && result.goals.recent.all.brier <= 2,
  );
  assert.ok(Number.isFinite(result.goals.recent.all.logLoss));
  assert.equal(
    result.goals.recent.all.calibration.reduce((s, b) => s + b.n, 0),
    3 * result.goals.recent.all.n,
  );
  assert.equal(Object.keys(result.goals.recent.all.binary).length, 6);
  assert.ok(
    Object.values(result.counts).every((c) => c.all.n > 0 && c.all.n <= 160),
  );
  assert.ok(result.goals.recent.versusLegacy.all.n > 0);
  assert.equal(validatedTheoreticalOdds(0.5, { status: "experimental" }), null);
  assert.equal(validatedTheoreticalOdds(0.5, { status: "validated" }), 2);
  assert.equal(validatedTheoreticalOdds(0, { status: "validated" }), null);
});

test("common competition inference ignores future matches and new service remains read-only", () => {
  const data = predictionFixture();
  const before = JSON.stringify(data);
  const r = createResearchReport({
    dataset: data,
    home: data.teams[0],
    away: data.teams[1],
    ...options,
  });
  assert.equal(r.arenaAffected, false);
  assert.equal(r.goals.status, "experimental");
  assert.equal(JSON.stringify(data), before);
  const early = createResearchReport({
    dataset: data,
    home: data.teams[0],
    away: data.teams[1],
    ...options,
    cutoff: "2026-07-01T00:00:00Z",
  });
  assert.equal(early.competitionId, null);
  assert.equal(early.goals.status, "unavailable");
});

test("quick-entry results reuse canonical deduplication and supply no synthetic advanced statistics", () => {
  const data = predictionFixture(),
    m = data.matches[0];
  data.simplified = [
    {
      id: "quick-mirror",
      team_id: m.home_team_id,
      opponent_team_id: m.away_team_id,
      competition_name: "Ligue 1",
      season_start_year: 2026,
      venue: "home",
      goals_for: m.goals_home,
      goals_against: m.goals_away,
      kickoff: m.kickoff,
      updated_at: m.updated_at,
      is_published: true,
    },
  ];
  assert.equal(statisticalRecords(data).length, 160);
  data.matches = data.matches.filter((r) => r.id !== m.id);
  const rows = statisticalRecords(data);
  assert.equal(rows.length, 160);
  assert.equal(rows.find((r) => r.id === "quick-mirror").kind, "simplified");
  assert.equal(coverageAudit(rows, options).fields.shots.n, 0);
});

test("extreme score histories are bounded and flagged rather than interpreted as reliable forecasts", () => {
  const data = predictionFixture();
  data.matches.forEach((m) => {
    m.goals_home = 32767;
    m.goals_away = 0;
  });
  const f = researchGoals(statisticalRecords(data), options);
  assert.equal(f.status, "experimental");
  assert.equal(f.quality.clipped, true);
  assert.ok(Object.values(f.expectedGoals).every((v) => v >= 0.05 && v <= 6));
  assert.ok(Object.values(f.markets).every((v) => v >= 0 && v <= 1));
});
