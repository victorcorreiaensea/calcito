import test from "node:test";
import assert from "node:assert/strict";
import { simulatedProfile } from "../src/services/simulation.js";
import { calculateCalcitoForm } from "../src/engines/calcitoEngine.js";

test("illustrative form is stable, explicitly simulated and independent of the proprietary engine", () => {
  const first = simulatedProfile("team-1");
  const second = simulatedProfile("team-1");
  assert.deepEqual(first, second);
  assert.equal(first.simulated, true);
  assert.equal(first.results.length, 5);
  first.results[0] = "D";
  assert.notDeepEqual(first.results, simulatedProfile("team-1").results);
  assert.equal(
    calculateCalcitoForm({ teamId: "team-1", matches: [] }).score,
    null,
  );
});
