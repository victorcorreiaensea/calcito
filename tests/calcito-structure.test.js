import test from "node:test";
import assert from "node:assert/strict";
import { predictionFixture } from "./support/prediction-fixture.js";
import {
  createStatisticalReport,
  statisticalVerdict,
} from "../src/services/predictionService.js";
import {
  estimateGoals,
  evaluateGoals,
} from "../src/engines/goalPredictionEngine.js";
import {
  calcitoMoods,
  calcitoPersonality,
} from "../src/domain/calcitoPersonality.js";
import {
  scientificOfferVerdict,
  validateNegotiationSnapshot,
  prepareNegotiationRequest,
  validateNegotiationOffer,
} from "../src/domain/negotiationContract.js";

const args = () => ({
  dataset: predictionFixture(),
  home: {
    id: "club-0",
    name: "Club 0",
    score: 51,
    coverage: { variant: "provisional" },
  },
  away: {
    id: "club-1",
    name: "Club 1",
    score: 52,
    coverage: { variant: "provisional" },
  },
  year: 2026,
  venue: "home",
  cutoff: "2026-10-21T12:00:00Z",
});
const attempt = (number, odds = 1.7, decision = "rejected") => ({
  number,
  requestId: "fixture-request-" + number,
  createdAt: "2026-10-21T12:00:00Z",
  offeredOdds: odds,
  scientificVerdict: scientificOfferVerdict(0.5, odds),
  personalDecision: {
    decision,
    kind: "server-risk-policy",
    reason:
      decision === "rejected"
        ? "La cote ne convient pas selon le verdict et les règles serveur."
        : "Décision serveur de test.",
  },
});
const snapshot = (attempts = []) => ({
  id: "fixture-negotiation",
  matchId: "fixture-match",
  eventId: "home",
  userId: "fixture-owner",
  authority: "server",
  revision: attempts.length,
  predictionRef: {
    id: "fixture-server-quote",
    modelVersion: "fixture-v1",
    matchRevision: "fixture-revision",
    probability: 0.5,
    calculatedAt: "2026-10-21T11:00:00Z",
  },
  attempts,
  status: attempts.some((a) => a.personalDecision.decision === "accepted")
    ? "accepted"
    : attempts.length === 3
      ? "exhausted"
      : "open",
});

test("shared statistical view preserves the existing engines, event values and current highlights without fabricated prices", () => {
  const a = args(),
    report = createStatisticalReport(a);
  assert.deepEqual(
    report.forecast,
    estimateGoals({
      dataset: a.dataset,
      homeId: a.home.id,
      awayId: a.away.id,
      year: a.year,
      venue: a.venue,
      cutoff: a.cutoff,
    }),
  );
  assert.deepEqual(
    report.validation,
    evaluateGoals(a.dataset, { year: a.year, cutoff: a.cutoff }),
  );
  assert.equal(report.events.length, 15);
  assert.equal(report.topProbabilities.length, 3);
  for (const e of report.events) {
    assert.equal(e.probability, report.forecast.markets[e.id]);
    assert.ok(
      e.theoreticalOdds === null ||
        Math.abs(e.theoreticalOdds * e.probability - 1) < 1e-10,
    );
  }
  assert.deepEqual(report.valueRanking, { status: "development", items: [] });
  assert.match(statisticalVerdict(report), /modèle expérimental/);
});
test("five deterministic presentation moods never change statistics or produce an emotional acceptance", () => {
  const a = args(),
    report = createStatisticalReport(a),
    before = JSON.stringify(report);
  assert.equal(Object.keys(calcitoMoods).length, 5);
  for (const mood of Object.keys(calcitoMoods)) {
    const persona = calcitoPersonality({
      mood,
      verdict: statisticalVerdict(report),
    });
    assert.deepEqual(
      persona,
      calcitoPersonality({ mood, verdict: statisticalVerdict(report) }),
    );
    assert.equal(persona.emotionalDecision.decision, null);
    assert.equal(persona.emotionalDecision.status, "development");
    assert.equal(JSON.stringify(report), before);
  }
  assert.deepEqual(createStatisticalReport(a), report);
  assert.equal(calcitoPersonality().mood, "scientific");
  assert.throws(() => calcitoPersonality({ mood: "invented" }));
});
test("future negotiation requests reject invalid offers without consuming a persisted attempt", () => {
  const s = snapshot(),
    before = structuredClone(s);
  for (const value of [
    "",
    null,
    NaN,
    Infinity,
    -1,
    0,
    1,
    1001,
    "1.2.3",
    "Infinity",
    "abc",
  ])
    assert.throws(() =>
      prepareNegotiationRequest(s, {
        offeredOdds: value,
        requestId: "fixture-new",
      }),
    );
  assert.equal(validateNegotiationOffer("1,70"), 1.7);
  assert.equal(validateNegotiationOffer("1.777"), 1.777);
  assert.equal(
    prepareNegotiationRequest(s, {
      offeredOdds: "1.77712345678901234567",
      requestId: "precise",
    }).offeredOdds,
    "1.77712345678901234567",
  );
  assert.deepEqual(
    prepareNegotiationRequest(s, {
      offeredOdds: "1,70",
      requestId: "fixture-new",
    }),
    {
      negotiationId: s.id,
      expectedRevision: 0,
      clientNonce: "fixture-new",
      offeredOdds: "1.70",
    },
  );
  assert.deepEqual(s, before);
});
test("future response contract enforces three attempts per negotiation and immediate terminal acceptance", () => {
  const exhausted = snapshot([attempt(1), attempt(2, 1.8), attempt(3, 1.9)]);
  assert.equal(validateNegotiationSnapshot(exhausted), exhausted);
  assert.throws(
    () =>
      prepareNegotiationRequest(exhausted, {
        offeredOdds: 2.5,
        requestId: "fourth",
      }),
    /terminée/,
  );
  assert.throws(
    () =>
      validateNegotiationSnapshot({
        ...exhausted,
        attempts: [...exhausted.attempts, attempt(4)],
      }),
    /Trois/,
  );
  const accepted = snapshot([attempt(1, 2.2, "accepted")]);
  assert.equal(validateNegotiationSnapshot(accepted), accepted);
  assert.throws(
    () =>
      prepareNegotiationRequest(accepted, {
        offeredOdds: 2.3,
        requestId: "second",
      }),
    /terminée/,
  );
  assert.throws(
    () =>
      validateNegotiationSnapshot(
        snapshot([attempt(1, 2.2, "accepted"), attempt(2)]),
      ),
    /acceptation/,
  );
  assert.equal(validateNegotiationSnapshot(snapshot()).status, "open");
});
test("scientific verdicts reflect expected value, stay frozen and do not substitute for server risk decisions", () => {
  assert.equal(scientificOfferVerdict(0.5, 1.7).verdict, "unfavourable");
  assert.equal(scientificOfferVerdict(0.5, 2).verdict, "neutral");
  assert.equal(scientificOfferVerdict(0.5, 2.2).verdict, "favourable");
  assert.match(scientificOfferVerdict(0.5, 1.7).reason, /négative/);
  const s = snapshot([attempt(1)]);
  s.attempts[0].personalDecision.reason = "";
  assert.throws(() => validateNegotiationSnapshot(s), /explication/);
  const changed = snapshot([attempt(1)]);
  changed.attempts[0].scientificVerdict = scientificOfferVerdict(0.8, 1.7);
  assert.throws(() => validateNegotiationSnapshot(changed), /figée/);
  const inconsistent = snapshot([attempt(1, 1.7, "accepted")]);
  assert.throws(
    () => validateNegotiationSnapshot(inconsistent),
    /émotionnelle/,
  );
  inconsistent.attempts[0].personalDecision = {
    decision: "accepted",
    kind: "emotional",
    reason: "Exemple de futur format, aucune exécution réelle.",
  };
  assert.equal(validateNegotiationSnapshot(inconsistent).status, "accepted");
  assert.equal(
    inconsistent.attempts[0].scientificVerdict.verdict,
    "unfavourable",
  );
  assert.throws(
    () => validateNegotiationSnapshot({ ...snapshot(), authority: "browser" }),
    /serveur/,
  );
});
