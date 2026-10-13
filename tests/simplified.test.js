import test from "node:test";
import assert from "node:assert/strict";
import {
  teamHistory,
  formCoverage,
  resultLetter,
  validateSimplified,
  inferSeason,
  isTrackedLeague,
} from "../src/domain/simplified.js";
import {
  europeanRows,
  compatibleRankingGroups,
} from "../src/domain/european.js";
import { buildStandings } from "../src/domain/standings.js";
import {
  publicDataset,
  manualSimplified,
} from "../src/services/manualAdapter.js";
const stats = {
  shots: 0,
  shots_on_target: 0,
  big_chances: 0,
  team_rating: 7,
  bonuses: [],
};
function fixture() {
  return {
    competitions: [
      {
        id: "l",
        slug: "ligue-1",
        type: "league",
        name: "Ligue 1",
        is_published: true,
      },
      { id: "eu", type: "european-cup", name: "Europe", is_published: true },
    ],
    seasons: [
      {
        id: "s",
        competition_id: "l",
        start_year: 2026,
        end_year: 2027,
        is_published: true,
      },
      {
        id: "e",
        competition_id: "eu",
        start_year: 2026,
        end_year: 2027,
        is_published: true,
      },
    ],
    teams: [
      { id: "a", name: "A", country: "France", is_published: true },
      {
        id: "b",
        name: "B",
        country: "Tchéquie",
        domestic_league: "Championnat tchèque",
        is_published: true,
      },
    ],
    members: [
      { team_id: "a", season_id: "s" },
      { team_id: "b", season_id: "e" },
    ],
    forms: [],
    predictions: [],
    matches: [],
    stats: [],
    simplified: [],
  };
}
test("merged chronology includes quick results, ignores drafts/archives and uses actual zero without fictitious statistics", () => {
  const d = fixture();
  d.matches = [
    {
      id: "old",
      season_id: "s",
      home_team_id: "b",
      away_team_id: "a",
      kickoff: "2026-10-01T18:00:00Z",
      status: "finished",
      goals_home: 2,
      goals_away: 0,
      is_published: true,
    },
  ];
  d.simplified = [
    {
      id: "new",
      team_id: "a",
      kickoff: "2026-10-02T12:00:00Z",
      season_start_year: 2026,
      goals_for: 0,
      goals_against: 0,
      is_published: true,
      entry_type: "simplified",
    },
    {
      id: "draft",
      team_id: "a",
      kickoff: "2026-10-03T12:00:00Z",
      season_start_year: 2026,
      is_published: false,
    },
    {
      id: "archive",
      team_id: "a",
      kickoff: "2026-10-04T12:00:00Z",
      season_start_year: 2026,
      is_published: true,
      converted_at: "2026-10-05",
    },
  ];
  const history = teamHistory(d, "a", 2026);
  assert.deepEqual(
    history.map((m) => m.id),
    ["new", "old"],
  );
  assert.equal(history[0].stats, null);
  assert.equal(history[1].goals_for, 0);
  assert.deepEqual(formCoverage(history).results, ["D", "N"]);
  assert.equal(teamHistory(d, "a", 2025).length, 0);
  assert.equal(teamHistory(d, "a", 2026, { publishedOnly: false }).length, 3);
});
test("all mixed five-match combinations use a distinct results benchmark while preserving a validated full model", () => {
  const snapshot = {
    score: 78,
    is_valid: true,
    is_published: true,
    model_version: "validated-test",
    index_variant: "complete",
  };
  for (let quick = 0; quick <= 5; quick++) {
    const history = Array.from({ length: 5 }, (_, i) => ({
      entry_type: i < quick ? "simplified" : "complete",
      stats: i < quick ? null : stats,
      goals_for: 1,
      goals_against: 0,
    }));
    assert.equal(formCoverage(history, snapshot).score, 100);
    const c = formCoverage(history, snapshot, {
      completeModel: { version: "validated-test", formula: () => 78 },
    });
    assert.equal(c.simplified, quick);
    assert.equal(c.detailed, 5 - quick);
    assert.equal(c.variant, quick ? "provisional" : "complete");
    assert.equal(c.score, quick ? 100 : 78);
    if (quick) assert.match(c.label, /Indice résultats provisoire/);
  }
  assert.equal(
    formCoverage(
      Array(5).fill({
        entry_type: "complete",
        stats: { ...stats, shots: null },
      }),
      snapshot,
    ).score,
    null,
  );
  assert.equal(
    formCoverage(Array(4).fill({ entry_type: "complete", stats }), snapshot)
      .score,
    null,
  );
  assert.equal(
    formCoverage(Array(5).fill({ entry_type: "simplified", stats: null }), {
      ...snapshot,
      index_variant: "provisional",
    }).score,
    null,
  );
});
test("quick validation handles missing scores, negatives, calendar dates and explicit ambiguous seasons", () => {
  const base = {
    team_id: "a",
    opponent_name: "Club",
    competition_name: "Championnat tchèque",
    date: "2026-10-01",
    season_start_year: 2026,
    season_end_year: 2027,
    venue: "away",
    goals_for: "0",
    goals_against: "1",
  };
  assert.deepEqual(validateSimplified(base, new Date("2026-10-13")), {});
  for (const change of [
    { goals_for: "" },
    { goals_for: -1 },
    { goals_for: 1.5 },
    { date: "2026-02-30" },
    { date: "2027-01-01" },
    { season_start_year: 2024 },
    { opponent_team_id: "a" },
  ])
    assert.ok(
      Object.keys(
        validateSimplified({ ...base, ...change }, new Date("2026-10-13")),
      ).length,
    );
  const d = fixture();
  assert.equal(inferSeason(d, "b", "2026-10-01").inferred, true);
  d.seasons.push({ id: "old", start_year: 2025, end_year: 2026 });
  d.members.push({ team_id: "b", season_id: "old" });
  assert.equal(inferSeason(d, "b", "2026-10-01").inferred, false);
  assert.equal(resultLetter(0, 0), "N");
  assert.equal(resultLetter("", 0), null);
});
test("European entrants include secondary league clubs; national standings cannot consume quick or European matches", () => {
  const d = fixture();
  d.simplified = [
    {
      id: "q",
      team_id: "b",
      entry_type: "simplified",
      season_start_year: 2026,
      competition_name: "Championnat tchèque",
      goals_for: 2,
      goals_against: 1,
      kickoff: "2026-10-01",
      is_published: true,
    },
  ];
  const rows = europeanRows(d, 2026);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.team.id === "b").extra, true);
  assert.equal(
    rows.find((r) => r.team.id === "b").origin,
    "Championnat tchèque",
  );
  const season = {
    ...d.seasons[0],
    tie_breakers: ["points"],
    win_points: 3,
    draw_points: 1,
    loss_points: 0,
  };
  const table = buildStandings({
    season,
    teams: d.teams,
    members: d.members,
    matches: [
      {
        id: "eu",
        season_id: "e",
        home_team_id: "a",
        away_team_id: "b",
        status: "finished",
        is_published: true,
        goals_home: 4,
        goals_away: 0,
        kickoff: "2026-10-02",
      },
      ...d.simplified,
    ],
  });
  assert.equal(table.recordedMatches, 0);
  assert.equal(table.rows[0].points, 0);
  assert.equal(isTrackedLeague({ slug: "secondary", type: "league" }), false);
});
test("incompatible methods are ranked separately, equal scores share rank, unavailable teams have no rank", () => {
  const row = (id, score, group, variant = "complete") => ({
    team: { id, name: id },
    score,
    compatibilityGroup: group,
    variant,
  });
  const groups = compatibleRankingGroups([
    row("b", 80, "v1"),
    row("a", 80, "v1"),
    row("c", 85, "v2"),
    row("d", null, null),
    row("e", 70, "p1", "provisional"),
  ]);
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups.find((g) => g.key === "complete:v1").rows.map((r) => r.rank),
    [1, 1],
  );
  assert.equal(groups.find((g) => g.key === "unavailable").rows[0].rank, null);
});
test("public quick history cannot expose drafts, unpublished teams, converted records or a private opponent fiche", () => {
  const d = fixture();
  d.teams[1].is_published = false;
  const base = {
    id: "q",
    team_id: "a",
    opponent_name: "B",
    opponent_team_id: "b",
    entry_type: "simplified",
    venue: "away",
    goals_for: 0,
    goals_against: 2,
    season_start_year: 2026,
    is_published: true,
  };
  d.simplified = [
    base,
    { ...base, id: "draft", is_published: false },
    { ...base, id: "hidden-team", team_id: "b" },
    { ...base, id: "converted", converted_at: "2026-10-01" },
  ];
  const visible = publicDataset(d);
  assert.deepEqual(
    visible.simplified.map((r) => r.id),
    ["q"],
  );
  const match = manualSimplified(base, visible);
  assert.equal(match.home.name, "B");
  assert.equal(match.home.id, null);
  assert.equal(match.goalsAway, 0);
});

test("a simplified result cannot use the full formula, even when injected data appears complete", async () => {
  const { calculateCalcitoForm } =
    await import("../src/engines/calcitoEngine.js");
  const input = {
    teamId: "a",
    competitionCoefficients: { league: 1 },
    matches: Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      entry_type: i === 0 ? "simplified" : "complete",
      home: { id: "a", name: "A" },
      away: { id: "b", name: "B" },
      status: "finished",
      kickoff: `2026-10-0${i + 1}T12:00:00Z`,
      goalsHome: 1,
      goalsAway: 0,
      competition: { id: "league" },
      teamStats: { shots: 1, bigChances: 1, rating: 7, bonuses: [] },
    })),
  };
  let called = false;
  const result = calculateCalcitoForm(input, {
    formula: () => {
      called = true;
      return 90;
    },
    formulaVersion: "test-only",
  });
  assert.equal(result.score, 100);
  assert.equal(result.indexVariant, "provisional");
  assert.equal(called, false);
});
