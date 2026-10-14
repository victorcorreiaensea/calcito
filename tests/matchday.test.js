import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchdaySlots,
  planMatchday,
  suggestedMatchCount,
} from "../src/domain/matchday.js";
const competition = {
  id: "c",
  name: "Liga Portugal",
  slug: "liga-portugal",
  type: "league",
};
const season = {
  id: "s",
  competition_id: "c",
  label: "2026–2027",
  start_year: 2026,
  end_year: 2027,
};
const teams = Array.from({ length: 18 }, (_, i) => ({
  id: `t${i}`,
  name: `Club ${i}`,
  slug: `club-${i}`,
}));
const dataset = {
  competitions: [competition],
  seasons: [season],
  teams,
  members: teams.map((t) => ({ season_id: "s", team_id: t.id })),
  matches: [],
  stats: [],
  simplified: [],
};
const header = {
  competition_id: "c",
  season_id: "s",
  round: "Journée 8",
  source_url: "",
};
const row = {
  home_team: "t0",
  away_team: "t1",
  home_goals: "2",
  away_goals: "0",
};
test("nine prototypes contain no invented fixtures or scores; blank dated rows never become database records", () => {
  assert.equal(suggestedMatchCount(competition, season, dataset), 9);
  assert.equal(
    suggestedMatchCount(
      { ...competition, type: "european-cup" },
      season,
      dataset,
    ),
    18,
  );
  const slots = createMatchdaySlots(9, "2026-10-01");
  assert.equal(slots.length, 9);
  assert.equal(slots[0].home_goals, "");
  assert.deepEqual(planMatchday(slots, header, dataset), []);
  for (const n of [0, 41, 1.5, "abc"])
    assert.throws(() => createMatchdaySlots(n));
});
test("only completed matches are planned as private drafts with real zeroes and absent stats left null", () => {
  const slots = createMatchdaySlots(9, "2026-10-01");
  Object.assign(slots[0], row, {
    home_shots: "0",
    home_shots_on_target: "0",
    home_woodwork: "1",
    home_rating: "7.2",
  });
  const plan = planMatchday(slots, header, dataset);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].errors, []);
  assert.equal(plan[0].payload.round, "Journée 8");
  assert.equal(plan[0].payload.is_published, false);
  assert.equal(plan[0].payload.home_stats.shots, 0);
  assert.equal(plan[0].payload.home_stats.woodwork, 1);
  assert.equal(plan[0].payload.away_stats.shots, null);
  assert.equal(plan[0].payload.home_stats.team_rating, 7.2);
});
test("incomplete scores, duplicate participants and already recorded matchday participants are rejected", () => {
  const slots = createMatchdaySlots(2, "2026-10-01");
  Object.assign(slots[0], row);
  Object.assign(slots[1], row, { away_team: "t2", away_goals: "" });
  const plan = planMatchday(slots, header, dataset);
  assert.ok(plan.every((p) => p.errors.length));
  Object.assign(slots[1], { home_team: "t3", away_goals: "1" });
  assert.ok(
    planMatchday(slots, header, dataset).every((p) => !p.errors.length),
  );
  const existing = {
    id: "old",
    season_id: "s",
    round: "Journée 8",
    home_team_id: "t0",
    away_team_id: "t4",
    kickoff: "2026-09-30T12:00:00Z",
  };
  assert.ok(
    planMatchday(slots, header, {
      ...dataset,
      matches: [existing],
    })[0].errors.some((e) => e.includes("déjà enregistrée")),
  );
});
