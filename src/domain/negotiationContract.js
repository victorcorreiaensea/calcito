import { compareOdds } from "../services/externalOdds.js";

export const negotiationContract = Object.freeze({
  version: 1,
  maxAttempts: 3,
  status: "development",
  authority: "server-required",
});
export function validateNegotiationOffer(value) {
  if (typeof value !== "number" && typeof value !== "string")
    throw Error("Proposez une cote numérique.");
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,20})?$/.test(text))
    throw Error("Format de cote décimale invalide.");
  const odds = Number(text);
  // Existing Arena offer range, not a new acceptance threshold.
  if (!Number.isFinite(odds) || odds < 1.01 || odds > 1000)
    throw Error("La cote doit être comprise entre 1,01 et 1000.");
  return odds;
}
export function scientificOfferVerdict(probability, offeredOdds) {
  const odds = validateNegotiationOffer(offeredOdds),
    comparison = compareOdds(probability, odds);
  if (!comparison) throw Error("Probabilité scientifique indisponible.");
  const verdict =
    comparison.theoreticalValue > 1e-12
      ? "favourable"
      : comparison.theoreticalValue < -1e-12
        ? "unfavourable"
        : "neutral";
  const price =
    comparison.theoreticalOdds == null
      ? "non finie"
      : comparison.theoreticalOdds.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return {
    ...comparison,
    probability,
    offeredOdds: odds,
    verdict,
    perspective: "calcito-backs-selection",
    reason: `Cote proposée ${odds.toLocaleString("fr-FR")} ; cote théorique ${price} : espérance ${verdict === "favourable" ? "positive" : verdict === "unfavourable" ? "négative" : "nulle"} pour Calcito qui prend le pari.`,
  };
}
// Validate a FUTURE authoritative response, never fabricate or persist an acceptance here.
export function validateNegotiationSnapshot(snapshot) {
  if (
    !snapshot?.id ||
    !snapshot.matchId ||
    !snapshot.eventId ||
    !snapshot.predictionRef ||
    snapshot.authority !== "server" ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.attempts)
  )
    throw Error("Réponse de négociation serveur incomplète.");
  if (
    typeof snapshot.userId !== "string" ||
    !snapshot.userId ||
    !snapshot.predictionRef.id ||
    !snapshot.predictionRef.modelVersion ||
    !snapshot.predictionRef.matchRevision ||
    !Number.isFinite(Date.parse(snapshot.predictionRef.calculatedAt)) ||
    !Number.isFinite(snapshot.predictionRef.probability) ||
    snapshot.predictionRef.probability < 0 ||
    snapshot.predictionRef.probability > 1
  )
    throw Error("Référence scientifique figée et propriétaire requis.");
  if (snapshot.attempts.length > negotiationContract.maxAttempts)
    throw Error("Trois tentatives maximum par négociation.");
  const ids = new Set();
  let accepted = false;
  for (const [index, attempt] of snapshot.attempts.entries()) {
    if (accepted)
      throw Error("Une acceptation termine immédiatement la négociation.");
    if (
      !attempt.requestId ||
      ids.has(attempt.requestId) ||
      attempt.number !== index + 1 ||
      !Number.isFinite(Date.parse(attempt.createdAt))
    )
      throw Error("Historique de tentatives incohérent.");
    ids.add(attempt.requestId);
    if (
      attempt.scientificVerdict?.probability !==
      snapshot.predictionRef.probability
    )
      throw Error(
        "La probabilité figée ne peut pas changer entre les tentatives.",
      );
    const science = scientificOfferVerdict(
      attempt.scientificVerdict?.probability,
      attempt.offeredOdds,
    );
    if (attempt.scientificVerdict?.verdict !== science.verdict)
      throw Error(
        "Le verdict statistique ne correspond pas à la probabilité et à la cote.",
      );
    if (
      !["accepted", "rejected"].includes(attempt.personalDecision?.decision) ||
      typeof attempt.personalDecision.reason !== "string" ||
      !attempt.personalDecision.reason.trim()
    )
      throw Error("Chaque décision doit fournir une explication.");
    if (
      !["server-risk-policy", "emotional"].includes(
        attempt.personalDecision.kind,
      )
    )
      throw Error("Origine de la décision personnelle requise.");
    if (
      science.verdict === "unfavourable" &&
      attempt.personalDecision.decision === "accepted" &&
      attempt.personalDecision.kind !== "emotional"
    )
      throw Error(
        "Une exception au verdict doit être explicitement émotionnelle.",
      );
    accepted = attempt.personalDecision.decision === "accepted";
  }
  const expected = accepted
    ? "accepted"
    : snapshot.attempts.length === 3
      ? "exhausted"
      : "open";
  if (snapshot.status !== expected)
    throw Error("Statut de négociation incohérent.");
  return snapshot;
}
export function prepareNegotiationRequest(
  snapshot,
  { offeredOdds, requestId },
) {
  validateNegotiationSnapshot(snapshot);
  if (snapshot.status !== "open")
    throw Error("Cette négociation est terminée.");
  validateNegotiationOffer(offeredOdds);
  if (
    typeof requestId !== "string" ||
    !requestId.trim() ||
    snapshot.attempts.some((a) => a.requestId === requestId)
  )
    throw Error("Identifiant de nouvelle demande requis.");
  // No attempt is consumed until an authoritative response arrives.
  return {
    negotiationId: snapshot.id,
    expectedRevision: snapshot.revision,
    clientNonce: requestId,
    offeredOdds: String(offeredOdds).trim().replace(",", "."),
  };
}
