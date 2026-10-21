import test from "node:test";
import assert from "node:assert/strict";
import {
  officialPredictionEvents,
  rankProbabilities,
  rankOfferedOdds,
  offeredDecimal,
  verifiedOffers,
  comparisonRankings,
  comparisonContextId,
} from "../src/services/predictionRankings.js";
import { poissonMarkets } from "../src/engines/goalPredictionEngine.js";
import { matchIdentity } from "../src/services/externalOdds.js";
const now = Date.now(),
  iso = (n) => new Date(n).toISOString();
function fixture() {
  const match = {
    id: "match-1",
    home: { id: "home", name: "Domicile" },
    away: { id: "away", name: "Extérieur" },
    competition: { id: "league" },
    season: 2026,
    kickoff: iso(now + 86400000),
    updated_at: iso(now - 3600000),
    status: "scheduled",
    timeKnown: true,
  };
  const markets = poissonMarkets(1.8, 0.9);
  const payload = {
    model: "poisson-goals-v1",
    forecast: markets.probabilities,
    quotes: Object.entries(markets.markets).map(([market, probability]) => ({
      id: `q-${market}`,
      market,
      probability,
      creator: "user",
      match_id: match.id,
      model_version: "poisson-goals-v1",
      model_at: iso(now - 7200000),
      match_revision: match.updated_at,
      kickoff: match.kickoff,
      forecast: markets.probabilities,
      created_at: iso(now - 1000),
      expires_at: iso(now + 800000),
    })),
  };
  return { match, payload, userId: "user", now };
}
const events = () => officialPredictionEvents(fixture()).events;
const offer = (marketId, decimal, contextId = "match:match-1") => ({
  marketId,
  decimal,
  contextId,
  source: { type: "manual" },
});

test("official ranking uses validated server quotes only and deterministic diverse probability ordering", () => {
  const e = events(),
    rank = rankProbabilities(e);
  assert.equal(rank.length, 3);
  assert.equal(new Set(rank.map((r) => r.family)).size, 3);
  assert.ok(
    rank.every((r, i) => !i || r.probability <= rank[i - 1].probability),
  );
  assert.deepEqual(rank, rankProbabilities([...e].reverse()));
  assert.ok(
    rank.every(
      (r) =>
        r.theoreticalOdds * r.probability === 1 ||
        Math.abs(r.theoreticalOdds * r.probability - 1) < 1e-12,
    ),
  );
  const ties = e.map((r) => ({ ...r, probability: 0.5 }));
  assert.deepEqual(rankProbabilities(ties), rankProbabilities(ties.reverse()));
  assert.ok(rank.filter((r) => r.family === "totalGoals").length <= 1);
});

test("complementary outcomes share a family; never pad a partial ranking", () => {
  const e = events();
  assert.equal(
    rankProbabilities(e.filter((r) => r.family === "btts")).length,
    1,
  );
  assert.equal(
    rankProbabilities(e.filter((r) => r.family === "result")).length,
    1,
  );
  assert.equal(
    rankProbabilities(e.filter((r) => r.family === "totalGoals")).length,
    1,
  );
  assert.equal(rankProbabilities([e[0]]).length, 1);
  assert.deepEqual(rankProbabilities([]), []);
  assert.deepEqual(comparisonRankings({ official: null }), {
    status: "unavailable",
    reason: null,
    probabilities: [],
    values: [],
  });
});

test("experimental, unknown, mixed-context or mixed-calibration models cannot feed official rankings", () => {
  const e = events();
  assert.deepEqual(
    rankProbabilities(e.map((r) => ({ ...r, validation: "experimental" }))),
    [],
  );
  assert.deepEqual(
    rankProbabilities(
      e.map((r) => ({ ...r, modelVersion: "poisson-comparator-v1" })),
    ),
    [],
  );
  assert.deepEqual(
    rankProbabilities(
      e.map((r) => ({ ...r, source: "statistics-research-v1" })),
    ),
    [],
  );
  assert.deepEqual(
    rankProbabilities([e[0], { ...e[1], contextId: "match:other" }]),
    [],
  );
  assert.deepEqual(
    rankProbabilities([
      e[0],
      {
        ...e[1],
        predictionRef: { ...e[1].predictionRef, modelAt: "different" },
      },
    ]),
    [],
  );
  assert.deepEqual(rankProbabilities([{ ...e[0], probability: null }]), []);
});

test("invalid server responses are rejected, never promoted by a calibrated flag", () => {
  for (const mutate of [
    (f) => {
      f.payload.model = "statistics-research-v1";
      f.payload.calibrated = true;
    },
    (f) => {
      f.userId = "other";
    },
    (f) => {
      f.match.status = "finished";
    },
    (f) => {
      f.match.timeKnown = false;
    },
    (f) => {
      f.payload.quotes.forEach((q) => (q.expires_at = iso(now - 1)));
    },
    (f) => {
      f.match.updated_at = iso(now - 100);
    },
    (f) => {
      f.payload.quotes.forEach((q) => (q.match_id = "other"));
    },
    (f) => {
      f.payload.quotes.forEach((q) => (q.created_at = iso(now + 1)));
    },
    (f) => {
      f.payload.forecast = { home: 0.5, draw: 0.5, away: 0.5 };
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(officialPredictionEvents(f).events.length, 0);
  }
  const absent = fixture();
  absent.payload = { reason: "Modèle non validé" };
  assert.equal(officialPredictionEvents(absent).reason, "Modèle non validé");
  const malformed = fixture();
  malformed.payload.quotes.find((q) => q.market === "btts_no").probability =
    0.99;
  assert.equal(officialPredictionEvents(malformed).status, "error");
  const calibrations = fixture();
  calibrations.payload.quotes[0].model_at = iso(now - 7000000);
  assert.equal(officialPredictionEvents(calibrations).status, "error");
});

test("only returned admissible markets are used; no SOT/corners activation or invention from full forecast", () => {
  const f = fixture();
  f.payload.quotes = [
    f.payload.quotes[0],
    { ...f.payload.quotes[0], market: "corners_over_4" },
  ];
  const result = officialPredictionEvents(f);
  assert.equal(result.events.length, 1);
  assert.equal(rankProbabilities(result.events).length, 1);
  const duplicate = fixture();
  duplicate.payload.quotes.push({
    ...duplicate.payload.quotes.find((q) => q.market === "btts_yes"),
    probability: 0.123,
  });
  assert.equal(officialPredictionEvents(duplicate).status, "error");
});

test("manual decimal validation preserves comma notation and rejects empty, booleans, exponent, Infinity and <=1", () => {
  assert.equal(offeredDecimal("1,90"), 1.9);
  assert.equal(offeredDecimal(1.001), 1.001);
  for (const value of [
    "",
    null,
    true,
    false,
    "0x10",
    "2e2",
    "NaN",
    "Infinity",
    Infinity,
    1,
    0,
    -2,
    "1.2.3",
  ])
    assert.equal(offeredDecimal(value), null, String(value));
});

test("value calculation handles positive, zero and negative edges and returns the stage-4 data contract without transactions", () => {
  const event = { ...events()[0], probability: 0.6 };
  const [positive] = rankOfferedOdds([event], [offer(event.id, 1.9)]);
  assert.ok(Math.abs(positive.edge - 0.14) < 1e-12);
  assert.equal(positive.assessment, "favourable");
  assert.equal(positive.officialProbability, 0.6);
  assert.equal(positive.theoreticalOdds, 1 / 0.6);
  assert.equal(positive.oddsSource.type, "manual");
  assert.equal(positive.contextId, "match:match-1");
  assert.equal(positive.quoteId, event.quoteId);
  assert.equal(positive.schemaVersion, 1);
  assert.equal(
    rankOfferedOdds([{ ...event, probability: 0.5 }], [offer(event.id, 2)])[0]
      .edge,
    0,
  );
  assert.equal(
    rankOfferedOdds([event], [offer(event.id, 1.2)])[0].assessment,
    "unfavourable",
  );
  assert.deepEqual(rankOfferedOdds([event], [offer(event.id, 1)]), []);
  assert.deepEqual(
    rankOfferedOdds([event], [offer(event.id, 2, "match:other")]),
    [],
  );
  assert.deepEqual(
    rankOfferedOdds(
      [{ ...event, validation: "experimental" }],
      [offer(event.id, 2)],
    ),
    [],
  );
});

test("best odds ranking is deterministic, signed, uses each event once, and accepts fewer than three offers", () => {
  const e = events(),
    offers = e.slice(0, 5).map((r, i) => offer(r.id, 2 + i));
  const rank = rankOfferedOdds(e, offers);
  assert.equal(rank.length, 3);
  assert.ok(rank.every((r, i) => !i || r.edge <= rank[i - 1].edge));
  assert.deepEqual(
    rank,
    rankOfferedOdds([...e].reverse(), [...offers].reverse()),
  );
  assert.equal(rankOfferedOdds(e, [offers[0], offers[0]]).length, 1);
  assert.equal(rankOfferedOdds(e, [offers[0]]).length, 1);
  assert.deepEqual(rankOfferedOdds(e, []), []);
  const noMutation = JSON.stringify(e);
  rankOfferedOdds(e, offers);
  assert.equal(JSON.stringify(e), noMutation);
});

test("external offers require verified provenance, exact match identity and fresh quotes; Arena prices are never offered odds", () => {
  const { match } = fixture();
  const q = {
    match: matchIdentity(match),
    market: "result",
    selection: "home",
    decimal: 2,
    provider: "licensed-fixture",
    bookmaker: "Fixture only",
    quotedAt: iso(now - 1000),
  };
  const response = { status: "available", quotes: [q] };
  assert.equal(verifiedOffers(response, match, now).length, 1);
  for (const patch of [
    { provider: null },
    { bookmaker: "" },
    { quotedAt: iso(now + 1000) },
    { quotedAt: iso(now - 301000) },
    { match: { ...q.match, id: "other" } },
    { selection: "unknown" },
  ])
    assert.deepEqual(
      verifiedOffers(
        { status: "available", quotes: [{ ...q, ...patch }] },
        match,
        now,
      ),
      [],
    );
  assert.deepEqual(verifiedOffers(fixture().payload, match, now), []);
  assert.equal(
    rankOfferedOdds(events(), verifiedOffers(response, match, now))[0]
      .oddsSource.type,
    "external-verified",
  );
});

test("malformed or absent inputs never create a ranking or a calculation crash", () => {
  const f = fixture();
  for (const quotes of [null, {}, "invalid", [null, {}]])
    assert.equal(
      officialPredictionEvents({ ...f, payload: { ...f.payload, quotes } })
        .events.length,
      0,
    );
  assert.deepEqual(rankProbabilities([null, {}]), []);
  assert.deepEqual(rankOfferedOdds(events(), [null, {}]), []);
  const malformed = { ...f.payload.quotes[0], market: "constructor" };
  assert.equal(
    officialPredictionEvents({
      ...f,
      payload: { ...f.payload, quotes: [malformed] },
    }).events.length,
    0,
  );
});

test("simulation offers have reproducible context IDs distinct by team, season, venue and real fixture", () => {
  const args = { homeId: "a", awayId: "b", year: 2026, venue: "home" };
  const id = comparisonContextId(args);
  assert.equal(id, comparisonContextId({ ...args }));
  for (const patch of [
    { year: 2027 },
    { homeId: "c" },
    { awayId: "d" },
    { venue: "neutral" },
    { match: { id: "fixture" } },
  ])
    assert.notEqual(id, comparisonContextId({ ...args, ...patch }));
});
