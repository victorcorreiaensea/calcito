import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMatch,
  matchPayload,
  nullableNumber,
  completeness,
} from "../src/domain/match.js";
import { buildStandings } from "../src/domain/standings.js";
import { parseCSV, exportCSV } from "../src/domain/csv.js";
import { validatePublicConfig } from "../src/services/supabaseClient.js";

const form = {
  season_id: "one",
  round: "J1",
  kickoff: "2026-10-12T18:00:00Z",
  home_team_id: "a",
  away_team_id: "b",
  status: "finished",
  goals_home: "0",
  goals_away: "1",
  source: "Source",
  verified_at: "2026-10-12T20:00:00Z",
  home_stats: { shots: "0", shots_on_target: "0", team_rating: "7,5" },
  away_stats: {},
};
test("manual validation distinguishes zero from missing values and protects publishing", () => {
  assert.deepEqual(validateMatch(form, true), {});
  assert.equal(nullableNumber(""), null);
  assert.equal(nullableNumber("0"), 0);
  assert.equal(matchPayload(form, true).home_stats.team_rating, 7.5);
  assert.equal(matchPayload(form, true).away_stats.shots, null);
  assert.ok(validateMatch({ ...form, home_team_id: "b" }, true).away_team_id);
  assert.ok(
    validateMatch(
      { ...form, home_stats: { shots: "2", shots_on_target: "3" } },
      true,
    ).home_shots_on_target,
  );
  assert.ok(
    validateMatch({ ...form, source: "", verified_at: "" }, true).source,
  );
  assert.ok(validateMatch({ ...form, goals_home: "" }, true).goals_home);
  assert.equal(
    validateMatch({ ...form, source: "", verified_at: "" }, false).source,
    undefined,
  );
  assert.ok(completeness(form).percent < 100);
});
const teams = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() }));
const members = teams.map((team) => ({
  season_id: "one",
  team_id: team.id,
  point_adjustment: 0,
}));
const season = {
  id: "one",
  win_points: 3,
  draw_points: 1,
  loss_points: 0,
  tie_breakers: ["points", "goalDifference", "goalsFor"],
  rules_confirmed: true,
  verified_complete: true,
  expected_matches: 1,
};
const fixture = {
  id: "m1",
  season_id: "one",
  home_team_id: "a",
  away_team_id: "b",
  kickoff: "2026-10-12T18:00:00Z",
  status: "finished",
  is_published: true,
  goals_home: 2,
  goals_away: 1,
  source: "Source",
  verified_at: "2026-10-12T20:00:00Z",
};
test("league standings use each match once, both teams, sanctions and season-specific coverage", () => {
  const result = buildStandings({
    season,
    teams,
    members,
    matches: [
      fixture,
      { ...fixture, id: "draft", is_published: false },
      { ...fixture, id: "old", season_id: "old" },
    ],
  });
  assert.equal(result.recordedMatches, 1);
  assert.equal(result.partial, false);
  assert.equal(result.rows.find((r) => r.id === "a").points, 3);
  assert.equal(result.rows.find((r) => r.id === "b").lost, 1);
  assert.equal(result.rows.find((r) => r.id === "c").played, 0);
  const changed = buildStandings({
    season: { ...season, rules_confirmed: false },
    teams,
    members: members.map((m) => ({
      ...m,
      point_adjustment: m.team_id === "a" ? -3 : 0,
      adjustment_reason: "Sanction vérifiée",
    })),
    matches: [fixture],
  });
  assert.equal(changed.rows.find((r) => r.id === "a").points, 0);
  assert.equal(changed.partial, true);
});
test("equal teams share rank; head-to-head criteria use the complete tied mini-league", () => {
  const ties = buildStandings({
    season: { ...season, tie_breakers: ["points"] },
    teams,
    members,
    matches: [],
  });
  assert.deepEqual(
    ties.rows.map((r) => r.position),
    [1, 1, 1],
  );
  const games = [
    fixture,
    {
      ...fixture,
      id: "m2",
      home_team_id: "b",
      away_team_id: "c",
      goals_home: 3,
      goals_away: 0,
    },
    {
      ...fixture,
      id: "m3",
      home_team_id: "c",
      away_team_id: "a",
      goals_home: 1,
      goals_away: 0,
    },
  ];
  const ranked = buildStandings({
    season: { ...season, tie_breakers: ["points", "headToHeadGoalDifference"] },
    teams,
    members,
    matches: games,
  });
  assert.deepEqual(
    ranked.rows.map((r) => r.id),
    ["b", "a", "c"],
  );
});
test("CSV parser supports quoted delimiters, escaped quotes, line breaks and rejects malformed input", () => {
  assert.deepEqual(
    parseCSV('name,comment\r\n"Club, A","dit ""oui""\nsource"'),
    [{ name: "Club, A", comment: 'dit "oui"\nsource' }],
  );
  assert.throws(() => parseCSV("a,a\n1,2"));
  assert.throws(() => parseCSV("a,b\n1"));
  assert.throws(() => parseCSV('a\n"unfinished'));
  const csv = exportCSV([{ name: '=HYPERLINK("bad")', score: 0 }]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(parseCSV(csv)[0].score, "0");
});
test("frontend configuration rejects server and service-role keys", () => {
  assert.equal(
    validatePublicConfig("https://example.supabase.co", "sb_secret_do-not-use")
      .configured,
    false,
  );
  const jwt = (role) => `test.${btoa(JSON.stringify({ role }))}.test`;
  assert.equal(
    validatePublicConfig("https://example.supabase.co", jwt("service_role"))
      .configured,
    false,
  );
  assert.equal(
    validatePublicConfig("https://example.supabase.co", jwt("anon")).configured,
    true,
  );
  assert.equal(
    validatePublicConfig(
      "https://example.supabase.co",
      "sb_publishable_public-test",
    ).configured,
    true,
  );
  assert.equal(validatePublicConfig(undefined, undefined).configured, false);
});

test("public pages hide private drafts and source statistics even for a logged-in owner", async () => {
  const { publicDataset } = await import("../src/services/manualAdapter.js");
  const data = {
    competitions: [{ id: "c", is_published: true }],
    seasons: [
      { id: "s", competition_id: "c", start_year: 2026, is_published: true },
    ],
    teams: [
      { id: "a", is_published: true },
      { id: "b", is_published: true },
    ],
    members: [{ season_id: "s", team_id: "a" }],
    matches: [
      {
        id: "public",
        season_id: "s",
        home_team_id: "a",
        away_team_id: "b",
        is_published: true,
        kickoff: "2026-10-12T18:00:00Z",
      },
      {
        id: "draft",
        season_id: "s",
        home_team_id: "a",
        away_team_id: "b",
        is_published: false,
      },
    ],
    stats: [{ match_id: "public" }, { match_id: "draft" }],
    forms: [],
    predictions: [],
  };
  const visible = publicDataset(data);
  assert.deepEqual(
    visible.matches.map((row) => row.id),
    ["public"],
  );
  assert.deepEqual(
    visible.stats.map((row) => row.match_id),
    ["public"],
  );
});

test('team profiles use the selected season for league affiliation and form, without borrowing another year',async()=>{
  const {manualTeam}=await import('../src/services/manualAdapter.js');
  const raw={id:'a',name:'A'};
  const data={seasons:[{id:'old',competition_id:'first',start_year:2025},{id:'new',competition_id:'second',start_year:2026}],competitions:[{id:'first',name:'Old league',type:'league'},{id:'second',name:'New league',type:'league'}],members:[{team_id:'a',season_id:'old'},{team_id:'a',season_id:'new'}],forms:[{team_id:'a',season_start_year:2025,is_valid:true,is_published:true,score:70,calculated_at:'2025-12-01T00:00:00Z'}]};
  assert.equal(manualTeam(raw,data,2025).competitionName,'Old league');
  assert.equal(manualTeam(raw,data,2025).score,70);
  assert.equal(manualTeam(raw,data,2026).competitionName,'New league');
  assert.equal(manualTeam(raw,data,2026).score,null);
  assert.equal(manualTeam(raw,data,2024).season,null);
});
