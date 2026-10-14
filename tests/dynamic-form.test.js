import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSurprise,
  reconstructDynamicForms,
} from "../src/engines/dynamicFormEngine.js";
const d = (matches) => ({
  seasons: [{ id: "s", start_year: 2026 }],
  matches,
  simplified: [],
});
const m = (i, home = "a", away = "b", gf = 2, ga = 0, day = i + 1) => ({
  id: "m" + i,
  season_id: "s",
  kickoff: `2026-08-${String(day).padStart(2, "0")}T18:00:00Z`,
  home_team_id: home,
  away_team_id: away,
  goals_home: gf,
  goals_away: ga,
  status: "finished",
  is_published: true,
});
test("surprise is continuous, bounded, context-aware, and only reliable significant gaps receive an exploit", () => {
  const run = (own, opp, gf, ga, venue = "away", reliable = true) =>
    calculateSurprise({
      ownBefore: own,
      opponentBefore: opp,
      goalsFor: gf,
      goalsAgainst: ga,
      venue,
      reliable,
    });
  assert.ok(run(45, 88, 1, 1).adjustment > 0);
  assert.ok(run(88, 45, 1, 1).adjustment < 0);
  assert.ok(run(45, 88, 0, 1).adjustment > run(88, 45, 0, 1).adjustment);
  assert.equal(run(45, 88, 2, 0).label, "Exploit Calcito");
  assert.equal(run(80, 81, 2, 0).label, null);
  assert.equal(run(45, 88, 1, 1).label, "Nul arraché");
  assert.equal(run(45, 88, 2, 0, "away", false).label, null);
  assert.equal(run(45, null, 2, 0).surprise, null);
  for (let own = 0; own <= 100; own += 5)
    for (let opp = 0; opp <= 100; opp += 5)
      for (const [gf, ga] of [
        [2, 0],
        [1, 1],
        [0, 2],
      ])
        assert.ok(Math.abs(run(own, opp, gf, ga).adjustment) <= 8);
  assert.ok(
    Math.abs(run(50, 60, 2, 0).adjustment - run(50, 60.01, 2, 0).adjustment) <
      0.01,
  );
  assert.ok(
    run(50, 50, 2, 0, "away").adjustment > run(50, 50, 2, 0, "home").adjustment,
  );
});
test("replay excludes the current and future match from pre-match state; simultaneous matches are frozen and deterministic", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => m(i)),
    m(9, "c", "d", 0, 1, 8),
  ];
  const full = reconstructDynamicForms(d(rows), 2026);
  for (let i = 0; i < 8; i++) {
    const prefix = reconstructDynamicForms(d(rows.slice(0, i)), 2026);
    const row = full.matches.get("m" + i).sides[0];
    const last = prefix.histories.get("a")?.at(-1);
    assert.equal(row.before, last?.after ?? 50);
    assert.ok(row.after >= 0 && row.after <= 100);
  }
  assert.deepEqual(reconstructDynamicForms(d([...rows].reverse()), 2026), full);
  const changed = reconstructDynamicForms(
    d(
      rows.map((r) =>
        r.id === "m7" ? { ...r, goals_home: 0, goals_away: 3 } : r,
      ),
    ),
    2026,
  );
  assert.equal(
    changed.matches.get("m7").sides[0].before,
    full.matches.get("m7").sides[0].before,
  );
  assert.notEqual(
    changed.matches.get("m7").sides[0].after,
    full.matches.get("m7").sides[0].after,
  );
  assert.deepEqual(changed.matches.get("m6"), full.matches.get("m6"));
});
test("ancient imports and corrections replay subsequent history; drafts, missing goals and ambiguous same-day fixtures are excluded", () => {
  const rows = Array.from({ length: 8 }, (_, i) => m(i));
  const first = reconstructDynamicForms(d(rows), 2026);
  assert.equal(first.histories.get("a")[3].afterInitialized, true);
  assert.equal(first.histories.get("a")[4].afterInitialized, false);
  const corrected = reconstructDynamicForms(
    d(
      rows.map((r) =>
        r.id === "m0" ? { ...r, goals_home: 0, goals_away: 4 } : r,
      ),
    ),
    2026,
  );
  assert.notEqual(
    corrected.matches.get("m1").sides[0].opponentBefore,
    first.matches.get("m1").sides[0].opponentBefore,
  );
  const more = reconstructDynamicForms(
    d([
      m(20, "a", "c", 0, 4, 1),
      ...rows.map((r) => ({ ...r, kickoff: r.kickoff.replace("08-", "09-") })),
    ]),
    2026,
  );
  assert.notEqual(
    more.matches.get("m0").sides[0].before,
    first.matches.get("m0").sides[0].before,
  );
  const bad = reconstructDynamicForms(
    d([
      { ...m(0), goals_home: null },
      { ...m(1), is_published: false },
      m(2, "a", "b", 1, 0, 3),
      m(3, "a", "c", 1, 0, 3),
    ]),
    2026,
  );
  assert.equal(bad.histories.size, 0);
  assert.equal(bad.excluded.length, 3);
});
test("unknown quick opponents remain unknown; future and simultaneous ambiguous entries never seed references", () => {
  const dataset = {
    ...d([]),
    teams: [{ id: "a", name: "A" }],
    simplified: [
      {
        id: "q",
        team_id: "a",
        opponent_team_id: null,
        opponent_name: "Club libre",
        season_start_year: 2026,
        kickoff: "2026-08-01T12:00:00Z",
        goals_for: 1,
        goals_against: 1,
        venue: "away",
        is_published: true,
      },
    ],
  };
  const q = reconstructDynamicForms(dataset, 2026).histories.get("a")[0];
  assert.equal(q.opponentBefore, null);
  assert.equal(q.surprise, null);
  assert.equal(q.appliedAdjustment, null);
  assert.equal(q.performance, q.intrinsic);
  assert.equal(q.label, null);
  const future = reconstructDynamicForms(
    d([m(0), { ...m(1), kickoff: "2099-01-01T18:00:00Z" }]),
    2026,
  );
  assert.equal(future.histories.get("a").length, 1);
  assert.equal(future.excluded.length, 1);
  const dateOnly = "Heure non renseignée (date seule).";
  const ambiguous = reconstructDynamicForms(
    d([
      { ...m(0, "a", "b", 1, 0, 1), comment: dateOnly },
      { ...m(1, "a", "c", 1, 0, 1), kickoff: "2026-08-01T20:00:00Z" },
      m(2, "d", "e", 1, 0, 1),
    ]),
    2026,
  );
  assert.equal(ambiguous.histories.has("a"), false);
  assert.equal(ambiguous.histories.get("d")[0].before, 50);
  assert.equal(ambiguous.histories.get("d")[0].conservativeDay, true);
});
test("a fixed per-match surprise adjustment leaves the form window and is never counted twice", () => {
  const result = reconstructDynamicForms(
    d(
      Array.from({ length: 12 }, (_, i) =>
        m(
          i,
          i % 2 ? "b" : "a",
          i % 2 ? "a" : "b",
          i % 3 === 0 ? 0 : 2,
          i % 3 === 0 ? 1 : 0,
        ),
      ),
    ),
    2026,
  );
  for (const history of result.histories.values())
    for (let i = 4; i < history.length; i++) {
      const row = history[i],
        recent = history.slice(i - 4, i + 1);
      assert.ok(
        Math.abs(
          row.after - recent.reduce((n, r) => n + r.performance, 0) / 5,
        ) < 1e-10,
      );
      assert.ok(Math.abs(row.appliedAdjustment) <= 8 + 1e-10);
      assert.ok(row.after >= 0 && row.after <= 100);
    }
});
test("the archived intrinsic formula can be reconstructed with its own version, without surprise", async () => {
  const { calculateResultsForm } =
    await import("../src/engines/resultsFormEngine.js");
  const result = reconstructDynamicForms(
    d(Array.from({ length: 8 }, (_, i) => m(i, "a", "b", i % 3, i % 2))),
    2026,
    { modelVersion: "results-context-v2" },
  );
  const history = result.histories.get("a");
  assert.equal(result.version, "results-context-v2");
  for (let i = 4; i < history.length; i++)
    assert.ok(
      Math.abs(
        history[i].after -
          calculateResultsForm(
            history
              .slice(i - 4, i + 1)
              .map((r) => ({
                goals_for: r.goalsFor,
                goals_against: r.goalsAgainst,
                venue: r.venue,
              })),
          ).score,
      ) < 1e-10,
    );
  assert.ok(
    history.every(
      (r) =>
        r.surprise === null &&
        r.label === null &&
        r.version === "results-context-v2",
    ),
  );
  assert.throws(() =>
    reconstructDynamicForms(d([]), 2026, { modelVersion: "unknown" }),
  );
});
