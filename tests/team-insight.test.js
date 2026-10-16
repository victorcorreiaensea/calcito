import test from "node:test";
import assert from "node:assert/strict";
import { recentInsight, insightText } from "../src/domain/teamInsight.js";
const fixture = (id, date, home, away, gf, ga, performance) => ({
  id,
  kickoff: date,
  status: "finished",
  home: { id: home },
  away: { id: away },
  goalsHome: gf,
  goalsAway: ga,
  dynamic: { performance },
});
test("club commentary uses actual club perspective, chronologically ordered prior results and no future, unfinished or missing scores", () => {
  const rows = [
    fixture("a", "2026-09-01", "porto", "b", 2, 0, 70),
    fixture("b", "2026-09-02", "c", "porto", 1, 3, 80),
    fixture("c", "2026-09-03", "porto", "d", 0, 1, 30),
    fixture("future", "2027-01-01", "porto", "b", 10, 0, 100),
    fixture("missing", "2026-09-04", "porto", "b", null, null, 90),
    {
      ...fixture("scheduled", "2026-09-04", "porto", "b", 3, 0, 90),
      status: "scheduled",
    },
    fixture("other", "2026-09-04", "x", "b", 3, 0, 90),
  ];
  const before = JSON.stringify(rows);
  const result = recentInsight(rows, "porto", Date.parse("2026-10-01"));
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["c", "b", "a"],
  );
  assert.equal(result.goalsFor, 5);
  assert.equal(result.goalsAgainst, 2);
  assert.equal(result.wins, 2);
  assert.equal(result.instant, 60);
  assert.equal(result.values[1].venue, "away");
  assert.equal(JSON.stringify(rows), before);
  assert.match(insightText("Porto", result), /5 buts marqués et 2 encaissés/);
});
test("instantaneous descriptive view requires three real ledger performances and never fills missing numbers with zero", () => {
  const a = fixture("a", "2026-09-01", "porto", "b", 0, 0, 0),
    b = fixture("b", "2026-09-02", "porto", "c", 1, 0, 60),
    c = fixture("c", "2026-09-03", "porto", "d", 2, 0, null);
  assert.equal(recentInsight([a, b], "porto").instant, null);
  assert.equal(recentInsight([a, b, c], "porto").instant, null);
  c.dynamic.performance = 30;
  assert.equal(recentInsight([a, b, c], "porto").instant, 30);
  assert.match(
    insightText("Porto", recentInsight([], "porto")),
    /pas encore de résultat/,
  );
});
test("the comparison distinguishes overall and immediate leaders without assigning win probabilities", async () => {
  const { compareInsights } = await import("../src/domain/teamInsight.js");
  const text = compareInsights(
    { name: "A", score: 80 },
    { name: "B", score: 70 },
    { instant: 55 },
    { instant: 90 },
  );
  assert.match(text, /A présente l’indice général le plus élevé/);
  assert.match(text, /B affiche la meilleure moyenne/);
  assert.match(text, /ne sont pas des probabilités/);
  assert.match(
    compareInsights(
      { name: "A", score: null },
      { name: "B", score: null },
      { instant: null },
      { instant: null },
    ),
    /comparaison reste partielle/,
  );
});
