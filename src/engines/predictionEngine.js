export function validateProbabilities(probabilities) {
  if (
    !probabilities ||
    !["home", "draw", "away"].every(
      (key) =>
        typeof probabilities[key] === "number" &&
        Number.isFinite(probabilities[key]) &&
        probabilities[key] >= 0 &&
        probabilities[key] <= 1,
    )
  )
    throw new Error("Probabilités décimales invalides.");
  if (
    Math.abs(probabilities.home + probabilities.draw + probabilities.away - 1) >
    1e-9
  )
    throw new Error("Les probabilités doivent totaliser 100 %.");
  return probabilities;
}
export function theoreticalOdds(probabilities) {
  validateProbabilities(probabilities);
  return Object.fromEntries(
    Object.entries(probabilities).map(([key, probability]) => [
      key,
      probability === 0 ? null : 1 / probability,
    ]),
  );
}
// Separate from the form engine. No fallback conversion from form to probabilities.
export function calculatePrediction({ match, model, context }) {
  if (
    !model?.calibrated ||
    typeof model.predict !== "function" ||
    !model.version
  )
    return {
      status: "model-pending",
      probabilities: null,
      odds: null,
      calculatedAt: null,
      quality: null,
      factors: [],
    };
  const output = model.predict({ match, context });
  const probabilities = validateProbabilities(output.probabilities);
  if (!output.quality || !Array.isArray(output.factors))
    throw new Error("Qualité des données et facteurs du modèle requis.");
  return {
    status: "calculated",
    modelVersion: model.version,
    probabilities,
    odds: theoreticalOdds(probabilities),
    calculatedAt: new Date().toISOString(),
    quality: output.quality,
    factors: output.factors,
  };
}
