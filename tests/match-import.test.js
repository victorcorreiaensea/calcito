import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../src/domain/csv.js";
import {
  readMatchCSV,
  parseImportDate,
  planMatchImport,
  executeMatchImport,
  importMappings,
  DATE_ONLY_MARKER,
} from "../src/domain/matchImport.js";
const d = () => ({
  competitions: [
    {
      id: "c",
      name: "Liga Portugal",
      slug: "liga-portugal",
      type: "league",
      is_published: true,
    },
  ],
  seasons: [
    {
      id: "s",
      competition_id: "c",
      label: "2026–2027",
      start_year: 2026,
      end_year: 2027,
      is_published: true,
    },
  ],
  teams: [
    {
      id: "p",
      name: "FC Porto",
      slug: "fc-porto",
      country: "Portugal",
      is_published: true,
    },
    {
      id: "b",
      name: "Benfica",
      slug: "benfica",
      country: "Portugal",
      is_published: true,
    },
  ],
  members: [
    { season_id: "s", team_id: "p" },
    { season_id: "s", team_id: "b" },
  ],
  matches: [],
  stats: [],
  simplified: [],
});
const row = (extra = {}) => ({
  date: "2026-10-01T20:00:00+01:00",
  competition: "Liga Portugal",
  season: "2026-2027",
  home_team: "FC Porto",
  away_team: "Benfica",
  home_goals: "0",
  away_goals: "1",
  home_shots: "0",
  home_rating: "7,5",
  source_url: "https://example.org/verified-test-only",
  ...extra,
});
const options = {
  now: new Date("2026-10-13T20:00:00Z"),
  verified: true,
  published: true,
};
test("import parses requested, legacy, semicolon and pasted spreadsheet formats without confusing decimal commas or zeros", () => {
  assert.deepEqual(parseCSV('a;b\n"x;y";"7,5"'), [{ a: "x;y", b: "7,5" }]);
  assert.deepEqual(parseCSV("a\tb\nx\t0"), [{ a: "x", b: "0" }]);
  const rows = readMatchCSV(
    "date,competition,season,home_team,away_team,home_goals,away_goals\n2026-10-01,Liga Portugal,2026-2027,FC Porto,Benfica,0,1",
  );
  assert.equal(rows[0].home_goals, "0");
  const legacy = readMatchCSV(
    "kickoff,competition,season,home,away,goals_home,goals_away\n2026-10-01T20:00:00Z,liga-portugal,2026,fc-porto,benfica,2,1",
  );
  assert.equal(legacy[0].home_team, "fc-porto");
  assert.throws(
    () => readMatchCSV("date,competition\n2026-10-01,Liga Portugal"),
    /Colonnes/,
  );
  assert.throws(
    () =>
      readMatchCSV(
        "date,competition,season,home_team,away_team,home_goals,away_goals",
      ),
    /aucun match/,
  );
});
test("date parser validates impossible dates, explicit offsets, Lisbon/Paris DST and honest date-only precision", () => {
  assert.equal(
    parseImportDate("01/10/2026 20:00", "Europe/Lisbon").iso,
    "2026-10-01T19:00:00.000Z",
  );
  assert.equal(
    parseImportDate("2026-10-01 20:00", "Europe/Paris").iso,
    "2026-10-01T18:00:00.000Z",
  );
  assert.equal(
    parseImportDate("2026-01-01 20:00", "Europe/Lisbon").iso,
    "2026-01-01T20:00:00.000Z",
  );
  assert.equal(parseImportDate("2026-10-01").dateOnly, true);
  for (const date of [
    "2026-02-30",
    "2026-13-01",
    "2026-10-01 25:00",
    "2026-10-01T20:00:00+25:00",
    "2026-03-29 02:30",
    "2026-10-25 02:30",
  ])
    assert.throws(() => parseImportDate(date, "Europe/Paris"));
  assert.equal(
    parseImportDate("2026-10-25T02:30:00+02:00").iso,
    "2026-10-25T00:30:00.000Z",
  );
});
test("plans associate names/slugs and manual aliases, keep missing stats null, refuse future/unverified/ineligible data", () => {
  const dataset = d();
  const plan = planMatchImport([row()], dataset, options)[0];
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.payload.goals_home, 0);
  assert.equal(plan.payload.home_stats.shots, 0);
  assert.equal(plan.payload.home_stats.team_rating, 7.5);
  assert.equal(plan.payload.away_stats.shots, null);
  assert.equal(plan.payload.home_stats.bonuses, undefined);
  const unknown = row({ home_team: "Porto" });
  assert.deepEqual(importMappings([unknown], dataset).teams, ["Porto"]);
  assert.equal(planMatchImport([unknown], dataset, options)[0].home, null);
  assert.equal(
    planMatchImport([unknown], dataset, {
      ...options,
      mapping: { teams: { Porto: "p" } },
    })[0].payload.home_team_id,
    "p",
  );
  for (const changes of [
    { date: "2026-10-20" },
    { home_goals: "" },
    { home_goals: "1.5" },
    { home_shots: "2", home_shots_on_target: "3" },
    { home_rating: "11" },
    { source_url: "javascript:alert(1)" },
    { away_team: "FC Porto" },
    { season: "2024-2025" },
  ])
    assert.ok(
      planMatchImport([row(changes)], dataset, options)[0].errors.length,
    );
  assert.ok(
    planMatchImport([row()], dataset, { ...options, verified: false })[0].errors
      .length,
  );
  dataset.members = [];
  assert.ok(
    planMatchImport([row()], dataset, options)[0].errors.some((e) =>
      e.includes("participants"),
    ),
  );
  const privateTeam = d();
  privateTeam.teams[0].is_published = false;
  assert.ok(
    planMatchImport([row()], privateTeam, options)[0].errors.some((e) =>
      e.includes("Publiez"),
    ),
  );
  assert.deepEqual(
    planMatchImport([row()], privateTeam, { ...options, published: false })[0]
      .errors,
    [],
  );
  const dateOnly = planMatchImport(
    [row({ date: "2026-10-01" })],
    d(),
    options,
  )[0];
  assert.ok(dateOnly.payload.comment.includes(DATE_ONLY_MARKER));
});
test("duplicate updates preserve identity, optimistic revision, publication and every existing stat not supplied in CSV", () => {
  const dataset = d();
  dataset.matches = [
    {
      id: "existing",
      season_id: "s",
      home_team_id: "p",
      away_team_id: "b",
      kickoff: "2026-10-01T19:00:00Z",
      status: "finished",
      goals_home: 2,
      goals_away: 1,
      is_published: true,
      updated_at: "stamp",
      source: "Original source",
      verified_at: "2026-10-01T22:00:00Z",
      halftime_home: 1,
    },
  ];
  dataset.stats = [
    {
      match_id: "existing",
      team_id: "p",
      shots: 15,
      shots_on_target: 8,
      bonuses: [1],
    },
  ];
  const ignore = planMatchImport([row()], dataset, options)[0];
  assert.equal(ignore.action, "ignore");
  const update = planMatchImport([row({ home_shots: "" })], dataset, {
    ...options,
    published: false,
    duplicates: "update",
  })[0];
  assert.deepEqual(update.errors, []);
  assert.equal(update.payload.id, "existing");
  assert.equal(update.payload.expected_updated_at, "stamp");
  assert.equal(update.payload.is_published, true);
  assert.equal(update.payload.home_stats.shots, 15);
  assert.equal(update.payload.home_stats.shots_on_target, 8);
  assert.deepEqual(update.payload.home_stats.bonuses, [1]);
  assert.equal(update.payload.halftime_home, 1);
  const keepTime = planMatchImport([row({ date: "2026-10-01" })], dataset, {
    ...options,
    duplicates: "update",
  })[0];
  assert.equal(keepTime.payload.kickoff, dataset.matches[0].kickoff);
  assert.equal(keepTime.payload.comment.includes(DATE_ONLY_MARKER), false);
  const internally = planMatchImport(
    [row(), row({ home_goals: "5" })],
    d(),
    options,
  );
  assert.equal(internally[1].action, "ignore");
  assert.equal(internally[1].inFile, 2);
  const firstInvalid = planMatchImport(
    [row({ home_goals: "-1" }), row()],
    d(),
    options,
  );
  assert.equal(firstInvalid[1].action, "insert");
});
test("existing quick results and cross-season conflicts cannot silently create a second full record or erase its history", () => {
  const dataset = d();
  dataset.simplified = [
    {
      id: "quick",
      team_id: "p",
      opponent_name: "Benfica",
      kickoff: "2026-10-01T12:00:00Z",
    },
  ];
  assert.equal(planMatchImport([row()], dataset, options)[0].action, "ignore");
  assert.ok(
    planMatchImport([row()], dataset, {
      ...options,
      duplicates: "update",
    })[0].errors.some((e) => e.includes("convertissez")),
  );
  dataset.simplified = [];
  dataset.matches = [
    {
      id: "other",
      season_id: "other",
      home_team_id: "p",
      away_team_id: "b",
      kickoff: "2026-10-01T12:00:00Z",
    },
  ];
  assert.ok(
    planMatchImport([row()], dataset, {
      ...options,
      duplicates: "update",
    })[0].errors.some((e) => e.includes("autre saison")),
  );
});
test("batch imports only valid records, counts updates/ignores/rejections and distinguishes uncertain commits from untouched rows", async () => {
  const plan = planMatchImport(
    [
      row(),
      row(),
      row({ date: "2026-10-02", home_goals: "bad" }),
      row({ date: "2026-10-03" }),
    ],
    d(),
    options,
  );
  const calls = [];
  const result = await executeMatchImport(plan, {
    save: async (p) => {
      calls.push(p);
      return p.id;
    },
  });
  assert.equal(result.imported, 2);
  assert.equal(result.ignored, 1);
  assert.equal(result.rejected, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((p) => p.id));
  const unconfirmed = await executeMatchImport(plan, {
    save: async () => null,
  });
  assert.equal(unconfirmed.imported, 0);
  assert.equal(unconfirmed.uncertain, 1);
  const error = Object.assign(new Error("Network timeout"), {});
  const failed = await executeMatchImport(plan, {
    save: async () => {
      throw error;
    },
  });
  assert.equal(failed.uncertain, 1);
  assert.equal(failed.imported, 0);
  assert.equal(failed.unprocessed, 3);
  assert.ok(failed.rows[0].id);
  const sqlFailure = await executeMatchImport(plan, {
    save: async () => {
      throw Object.assign(new Error("Constraint"), { code: "23514" });
    },
  });
  assert.equal(sqlFailure.rejected, 3);
  assert.equal(sqlFailure.ignored, 1);
  assert.equal(sqlFailure.uncertain, 0);
  const denied = await executeMatchImport(plan, {
    save: async () => {
      throw Object.assign(new Error("Denied"), { code: "42501" });
    },
  });
  assert.equal(denied.rejected, 1);
  assert.equal(denied.unprocessed, 3);
  assert.equal(denied.uncertain, 0);
});
