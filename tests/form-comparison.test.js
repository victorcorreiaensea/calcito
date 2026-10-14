import test from "node:test";
import assert from "node:assert/strict";
import { compareHistoricalForms } from "../src/domain/formComparison.js";
const row = (day, after, version = "v4") => ({
  kickoff: `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`,
  after,
  afterInitialized: false,
  version,
});
test("comparison uses common dates and previously known measures, not arbitrary match numbers or future points", () => {
  const series = [
    {
      team: { id: "a", name: "A" },
      history: [row(1, 50), row(10, 70), row(20, 80)],
    },
    {
      team: { id: "b", name: "B" },
      history: [row(5, 55), row(15, 60), row(25, 90)],
    },
  ];
  const c = compareHistoricalForms(series, "season");
  assert.equal(c.leader.id, "b");
  assert.equal(new Date(c.progress.start).getUTCDate(), 5);
  assert.equal(new Date(c.progress.end).getUTCDate(), 20);
  assert.deepEqual(
    c.progress.changes.map((r) => r.delta),
    [30, 5],
  );
  assert.equal(c.progress.leader.id, "a");
  const unknown = compareHistoricalForms(
    series.map((s) => ({
      ...s,
      history: s.history.map((r) => ({ ...r, afterInitialized: true })),
    })),
    "season",
  );
  assert.equal(unknown, null);
  assert.equal(
    compareHistoricalForms([
      { ...series[0], history: [row(1, 50)] },
      { ...series[1], history: [row(25, 90)] },
    ]).progress,
    null,
  );
  assert.equal(
    compareHistoricalForms([
      { ...series[0] },
      {
        ...series[1],
        history: series[1].history.map((r) => ({ ...r, version: "other" })),
      },
    ]),
    null,
  );
});
