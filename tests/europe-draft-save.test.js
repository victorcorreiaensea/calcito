import test from "node:test";
import assert from "node:assert/strict";
import { saveEuropeanEdits } from "../src/domain/europeDraftSave.js";
const form = (id) => ({
  id,
  updated_at: "2026-10-17T12:00:00.123456Z",
  season_id: "s",
  home_team_id: "h",
  away_team_id: "a",
  round: "J1",
  kickoff: "2026-09-08T16:45:00Z",
  status: "finished",
  goals_home: 2,
  goals_away: 3,
  home_stats: {
    shots: 14,
    corners: 0,
    passes_completed: 532,
    passes_attempted: 602,
  },
  away_stats: { shots: 21 },
  is_published: false,
});
test("European save-all preserves zero, nulls, version and draft status; only dirty private fixtures are written", async () => {
  const rows = [form("a"), form("b"), { ...form("c"), is_published: true }],
    edits = new Map([
      ["a", form("a")],
      ["c", form("c")],
    ]),
    calls = [],
    saved = [];
  const r = await saveEuropeanEdits(rows, edits, {
    save: async (p) => calls.push(p),
    onSaved: (id) => saved.push(id),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].is_published, false);
  assert.equal(calls[0].home_stats.corners, 0);
  assert.equal(calls[0].home_stats.team_rating, null);
  assert.equal(calls[0].expected_updated_at, form("a").updated_at);
  assert.deepEqual(saved, ["a"]);
  assert.deepEqual(r, { total: 2, saved: 1, unchanged: 1, failed: [] });
});
test("Save-all continues after per-match validation/network conflicts and clears only confirmed successes", async () => {
  const a = form("a"),
    b = { ...form("b"), goals_home: -1 },
    c = form("c"),
    d = form("d"),
    saved = [],
    calls = [];
  const r = await saveEuropeanEdits(
    [a, b, c, d],
    new Map([a, b, c, d].map((x) => [x.id, x])),
    {
      save: async (p) => {
        calls.push(p.id);
        if (p.id === "c") throw new Error("Données modifiées ailleurs");
      },
      onSaved: (id) => saved.push(id),
    },
  );
  assert.deepEqual(calls, ["a", "c", "d"]);
  assert.deepEqual(saved, ["a", "d"]);
  assert.equal(r.saved, 2);
  assert.deepEqual(
    r.failed.map((x) => x.id),
    ["b", "c"],
  );
  assert.match(r.failed[1].message, /modifiées/);
});
