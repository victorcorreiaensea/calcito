import test from "node:test";
import assert from "node:assert/strict";
import {
  createExternalOddsService,
  matchIdentity,
  compareOdds,
} from "../src/services/externalOdds.js";
const now = Date.parse("2026-10-20T12:00:00Z");
const match = {
  id: "m",
  home: { id: "h" },
  away: { id: "a" },
  competition: { id: "cl" },
  season: 2026,
  kickoff: "2026-10-21T18:00:00Z",
};
test("external odds stay unconfigured without a provider and never fabricate commercial prices", async () => {
  assert.deepEqual(
    (await createExternalOddsService().getQuotes(match)).quotes,
    [],
  );
  assert.equal(
    (await createExternalOddsService().getQuotes(match)).status,
    "unconfigured",
  );
  assert.equal(matchIdentity({ ...match, timeKnown: false }), null);
});
test("future odds adapters must resolve exact identity, market, decimal prices and fresh timestamps", async () => {
  const q = {
    match: matchIdentity(match),
    bookmaker: "Fournisseur de test",
    market: "result",
    selection: "home",
    decimal: 2,
    quotedAt: "2026-10-20T11:59:00Z",
  };
  const service = createExternalOddsService({
    now: () => now,
    provider: {
      name: "Fixture de test",
      getQuotes: async () => [
        q,
        { ...q, match: { ...q.match, homeId: "wrong" } },
        { ...q, quotedAt: "2026-10-20T11:00:00Z" },
        { ...q, quotedAt: "2026-10-20T13:00:00Z" },
        { ...q, decimal: 0 },
        { ...q, selection: "invented" },
      ],
    },
  });
  const result = await service.getQuotes(match);
  assert.equal(result.status, "available");
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].retrievedAt, "2026-10-20T12:00:00.000Z");
  const comparison = compareOdds(0.6, 2);
  assert.equal(comparison.impliedProbability, 0.5);
  assert.equal(comparison.theoreticalOdds, 1 / 0.6);
  assert.ok(Math.abs(comparison.theoreticalValue - 0.2) < 1e-12);
  assert.equal(compareOdds(null, 2), null);
});
