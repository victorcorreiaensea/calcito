import test from "node:test";
import assert from "node:assert/strict";
import {
  isStandingsCompetition,
  buildStandings,
} from "../src/domain/standings.js";
import { publicDataset } from "../src/services/manualAdapter.js";

test("visitor standings support both European league phases and isolate published results by competition", () => {
  const competitions = [
    {
      id: "cl",
      slug: "champions-league",
      type: "european-cup",
      is_published: true,
    },
    {
      id: "el",
      slug: "europa-league",
      type: "european-cup",
      is_published: true,
    },
    { id: "fr", slug: "ligue-1", type: "league", is_published: true },
  ];
  assert.ok(competitions.every(isStandingsCompetition));
  assert.equal(
    isStandingsCompetition({ type: "cup", slug: "coupe-de-france" }),
    false,
  );
  const seasons = competitions.map((c) => ({
    id: c.id + "-season",
    competition_id: c.id,
    start_year: 2026,
    is_published: true,
    win_points: 3,
    draw_points: 1,
    loss_points: 0,
    tie_breakers: ["points", "goalDifference", "goalsFor"],
    rules_confirmed: false,
  }));
  const teams = ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    is_published: true,
  }));
  const members = seasons.flatMap((s) =>
    teams.map((t) => ({ season_id: s.id, team_id: t.id })),
  );
  const fixture = (id, season, h, a, gf, ga, extra = {}) => ({
    id,
    season_id: season + "-season",
    home_team_id: h,
    away_team_id: a,
    goals_home: gf,
    goals_away: ga,
    status: "finished",
    is_published: true,
    round: "Phase de ligue · Journée 1",
    kickoff: "2026-10-10T18:00:00Z",
    ...extra,
  });
  const d = publicDataset({
    competitions,
    seasons,
    teams,
    members,
    matches: [
      fixture("cl1", "cl", "a", "b", 3, 1),
      fixture("cl2", "cl", "b", "c", 0, 0),
      fixture("private", "cl", "c", "a", 9, 0, { is_published: false }),
      fixture("future", "cl", "c", "a", null, null, { status: "scheduled" }),
      fixture("knockout", "cl", "c", "a", 9, 0, { round: "Quart de finale" }),
      fixture("el1", "el", "c", "a", 2, 0),
      fixture("fr1", "fr", "b", "a", 8, 0),
    ],
    stats: [],
    forms: [],
    predictions: [],
    simplified: [],
  });
  const table = (id) =>
    buildStandings({
      ...d,
      season: seasons.find((s) => s.competition_id === id),
      competition: competitions.find((c) => c.id === id),
    });
  const cl = table("cl");
  assert.equal(cl.recordedMatches, 2);
  assert.equal(cl.partial, true);
  assert.deepEqual(
    cl.rows.map((r) => [r.id, r.played, r.points, r.goalsFor, r.goalsAgainst]),
    [
      ["a", 1, 3, 3, 1],
      ["c", 1, 1, 0, 0],
      ["b", 2, 1, 1, 3],
    ],
  );
  assert.equal(table("el").recordedMatches, 1);
  assert.equal(table("el").rows[0].id, "c");
  assert.equal(table("fr").rows[0].points, 3);
  assert.equal(table("fr").rows[0].goalsFor, 8);
});
