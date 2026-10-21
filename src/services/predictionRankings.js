import { validateProbabilities } from "../engines/predictionEngine.js";
import { fairOdd } from "../engines/goalPredictionEngine.js";
import { compareOdds, matchIdentity, oddsSelections } from "./externalOdds.js";

const family = Object.fromEntries(
  Object.entries(oddsSelections).flatMap(([group, keys]) =>
    keys.map((key) => [key, group.startsWith("total") ? "totalGoals" : group]),
  ),
);
const stable = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const finiteProbability = (p) =>
  typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;
const date = (v) => (typeof v === "string" ? Date.parse(v) : NaN);
export function comparisonContextId({
  match,
  homeId,
  awayId,
  year,
  venue = "home",
}) {
  return match?.id
    ? `match:${match.id}`
    : `simulation:${encodeURIComponent(JSON.stringify([homeId, awayId, Number(year), venue]))}`;
}
export function offeredDecimal(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 1 && Number.isFinite(n * 1) ? n : null;
}
function label(id, match) {
  return {
    home: `${match.home.name} gagne`,
    draw: "Match nul",
    away: `${match.away.name} gagne`,
    home_scores: `${match.home.name} marque`,
    home_blank: `${match.home.name} ne marque pas`,
    away_scores: `${match.away.name} marque`,
    away_blank: `${match.away.name} ne marque pas`,
    btts_yes: "Les deux équipes marquent",
    btts_no: "Les deux équipes ne marquent pas toutes les deux",
    ...Object.fromEntries(
      [1, 2, 3].flatMap((n) => [
        [`over_${n}_5`, `Plus de ${n},5 buts`],
        [`under_${n}_5`, `Moins de ${n},5 buts`],
      ]),
    ),
  }[id];
}
const empty = (status, reason) => ({ status, reason, events: [], items: [] });
// Boundary adapter for the EXISTING authenticated arena_quote response. Never calls an RPC.
// Its quote IDs are references, not client-side permission to place a bet.
export function officialPredictionEvents({
  payload,
  match,
  userId,
  now = Date.now(),
}) {
  const identity = matchIdentity(match);
  if (
    !identity ||
    !userId ||
    match.status !== "scheduled" ||
    date(identity.kickoff) <= now
  )
    return empty(
      "unavailable",
      "Une rencontre future à heure précise et une connexion sont nécessaires.",
    );
  if (
    !payload?.forecast ||
    !Array.isArray(payload.quotes) ||
    !payload.quotes.length
  )
    return empty(
      "unavailable",
      payload?.reason || "Aucune prévision serveur validée disponible.",
    );
  // No experimental version, published form snapshot or arbitrary calibrated flag is accepted.
  if (payload.model !== "poisson-goals-v1")
    return empty("unavailable", "Version officielle non prise en charge.");
  try {
    validateProbabilities(payload.forecast);
  } catch {
    return empty("error", "Prévisions serveur incohérentes.");
  }
  const rows = payload.quotes.filter((q) => {
    if (!q || typeof q !== "object") return false;
    const created = date(q.created_at),
      expires = date(q.expires_at),
      trained = date(q.model_at);
    return (
      q.id &&
      q.creator === userId &&
      q.match_id === match.id &&
      Object.hasOwn(family, q.market) &&
      q.model_version === payload.model &&
      finiteProbability(q.probability) &&
      date(q.match_revision) === date(match.updated_at) &&
      Number.isFinite(date(q.match_revision)) &&
      date(q.kickoff) === date(identity.kickoff) &&
      Number.isFinite(created) &&
      created <= now &&
      Number.isFinite(expires) &&
      expires > now &&
      expires <= date(identity.kickoff) &&
      expires > created &&
      expires - created <= 15 * 60000 &&
      Number.isFinite(trained) &&
      trained <= created &&
      ["home", "draw", "away"].every(
        (k) =>
          finiteProbability(q.forecast?.[k]) &&
          Math.abs(q.forecast[k] - payload.forecast[k]) < 1e-9,
      ) &&
      (!["home", "draw", "away"].includes(q.market) ||
        Math.abs(q.probability - payload.forecast[q.market]) < 1e-9)
    );
  });
  if (!rows.length)
    return empty(
      "unavailable",
      "Prévisions expirées, modifiées ou non admissibles : recharge les prévisions serveur.",
    );
  if (new Set(rows.map((q) => q.model_at)).size !== 1)
    return empty("error", "Versions de calibration incompatibles.");
  const grouped = new Map();
  for (const q of rows) {
    if (!grouped.has(q.market)) grouped.set(q.market, []);
    grouped.get(q.market).push(q);
  }
  if (
    [...grouped.values()].some((group) =>
      group.some((q) => Math.abs(q.probability - group[0].probability) > 1e-9),
    )
  )
    return empty(
      "error",
      "Probabilités contradictoires pour un même événement.",
    );
  const quotes = [...grouped.values()].map(
    (group) =>
      group.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0],
  );
  const probabilities = Object.fromEntries(
    quotes.map((q) => [q.market, q.probability]),
  );
  for (const keys of Object.values(oddsSelections).filter(
    (keys) => keys.length === 2,
  ))
    if (
      keys.every((k) => probabilities[k] !== undefined) &&
      Math.abs(probabilities[keys[0]] + probabilities[keys[1]] - 1) > 1e-9
    )
      return empty("error", "Marchés complémentaires incohérents.");
  for (const prefix of ["over", "under"])
    for (const n of [1, 2]) {
      const a = probabilities[`${prefix}_${n}_5`],
        b = probabilities[`${prefix}_${n + 1}_5`];
      if (
        a !== undefined &&
        b !== undefined &&
        (prefix === "over" ? a + 1e-9 < b : a > b + 1e-9)
      )
        return empty("error", "Seuils de buts incohérents.");
    }
  const events = quotes.map((q) => ({
    id: q.market,
    marketId: q.market,
    selection: q.market,
    label: label(q.market, match),
    family: family[q.market],
    contextId: `match:${match.id}`,
    matchId: match.id,
    probability: q.probability,
    theoreticalOdds: fairOdd(q.probability),
    modelVersion: payload.model,
    source: "arena_quote",
    validation: "validated",
    quoteId: q.id,
    predictionRef: {
      modelAt: q.model_at,
      matchRevision: q.match_revision,
      createdAt: q.created_at,
      expiresAt: q.expires_at,
    },
  }));
  return { status: "available", reason: null, events };
}
function admissible(events) {
  const selected = (Array.isArray(events) ? events : []).filter(
    (e) =>
      e &&
      e.validation === "validated" &&
      e.source === "arena_quote" &&
      e.modelVersion === "poisson-goals-v1" &&
      Object.hasOwn(family, e.id) &&
      e.family === family[e.id] &&
      finiteProbability(e.probability) &&
      e.contextId &&
      e.quoteId,
  );
  if (
    new Set(
      selected.map((e) =>
        JSON.stringify([e.contextId, e.modelVersion, e.predictionRef?.modelAt]),
      ),
    ).size > 1
  )
    return [];
  return selected;
}
// Greedy deterministic diversity: descending probability, ID tie-break, at most one per family.
// All goal totals form ONE family, as do complementary selections and the 1/N/2 result.
export function rankProbabilities(events) {
  const seen = new Set();
  return [...admissible(events)]
    .sort((a, b) => b.probability - a.probability || stable(a, b))
    .filter((e) => {
      if (seen.has(e.family)) return false;
      seen.add(e.family);
      return true;
    })
    .slice(0, 3);
}
export function rankOfferedOdds(events, offers) {
  const eligible = admissible(events),
    values = [];
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!offer || typeof offer !== "object") continue;
    const event = eligible.find(
      (e) => e.id === offer.marketId && e.contextId === offer.contextId,
    );
    const decimal = offeredDecimal(offer.decimal);
    if (
      !event ||
      decimal === null ||
      !["manual", "external-verified"].includes(offer.source?.type)
    )
      continue;
    if (
      offer.source.type === "external-verified" &&
      (!offer.source.provider ||
        !offer.source.bookmaker ||
        !Number.isFinite(date(offer.source.quotedAt)) ||
        date(offer.source.quotedAt) > Date.now() ||
        Date.now() - date(offer.source.quotedAt) > 5 * 60000)
    )
      continue;
    const comparison = compareOdds(event.probability, decimal);
    if (!comparison || !Number.isFinite(comparison.theoreticalValue)) continue;
    const edge =
      Math.abs(comparison.theoreticalValue) < 1e-12
        ? 0
        : comparison.theoreticalValue;
    values.push({
      schemaVersion: 1,
      contextId: event.contextId,
      matchId: event.matchId,
      marketId: event.id,
      selection: event.selection,
      label: event.label,
      officialProbability: event.probability,
      theoreticalOdds: fairOdd(event.probability),
      offeredOdds: decimal,
      oddsSource: offer.source,
      edge,
      assessment:
        edge > 0 ? "favourable" : edge < 0 ? "unfavourable" : "neutral",
      modelVersion: event.modelVersion,
      probabilitySource: event.source,
      quoteId: event.quoteId,
      predictionRef: event.predictionRef,
      id: event.id,
    });
  }
  const unique = new Set();
  return values
    .sort(
      (a, b) =>
        b.edge - a.edge ||
        stable(a, b) ||
        b.offeredOdds - a.offeredOdds ||
        JSON.stringify(a.oddsSource).localeCompare(
          JSON.stringify(b.oddsSource),
        ),
    )
    .filter((v) => {
      if (unique.has(v.marketId)) return false;
      unique.add(v.marketId);
      return true;
    })
    .slice(0, 3);
}
// External rows must come from the existing exact-match/freshness checked adapter.
export function verifiedOffers(response, match, now = Date.now()) {
  const identity = matchIdentity(match);
  if (
    !identity ||
    response?.status !== "available" ||
    date(identity.kickoff) <= now
  )
    return [];
  return (Array.isArray(response.quotes) ? response.quotes : [])
    .filter(
      (q) =>
        q &&
        q.match &&
        Object.entries(identity).every(([k, v]) => q.match[k] === v) &&
        Object.hasOwn(oddsSelections, q.market) &&
        oddsSelections[q.market].includes(q.selection) &&
        q.provider &&
        q.bookmaker &&
        date(q.quotedAt) <= now &&
        now - date(q.quotedAt) <= 5 * 60000,
    )
    .map((q) => ({
      contextId: `match:${match.id}`,
      marketId: q.selection,
      decimal: q.decimal,
      source: {
        type: "external-verified",
        provider: q.provider,
        bookmaker: q.bookmaker,
        quotedAt: q.quotedAt,
      },
    }));
}
export function comparisonRankings({ official, offers = [] }) {
  const events = official?.status === "available" ? official.events : [];
  return {
    status: official?.status || "unavailable",
    reason: official?.reason || null,
    probabilities: rankProbabilities(events),
    values: rankOfferedOdds(events, offers),
  };
}
