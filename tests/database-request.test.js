import test from "node:test";
import assert from "node:assert/strict";
import { databaseRequest } from "../src/services/databaseRequest.js";
test("a request blocked before fetch times out and aborts without retrying or starting a delayed write", async () => {
  let signal,
    calls = 0;
  const blocked = {
    abortSignal(s) {
      signal = s;
      calls++;
      return new Promise(() => {});
    },
  };
  const result = await databaseRequest(blocked, 10);
  assert.equal(result.error.code, "57014");
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});
test("successful database requests return their result and release their deadline", async () => {
  const result = { data: [{ id: "match" }], error: null };
  assert.equal(
    await databaseRequest({ abortSignal: () => Promise.resolve(result) }, 10),
    result,
  );
});
