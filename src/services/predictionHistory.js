import { validateProbabilities } from "../engines/predictionEngine.js";

const KEY = "calcito.prediction-history.v1";
function validateRecord(record) {
  if (
    !record ||
    typeof record.id !== "string" ||
    !record.id ||
    !record.match?.id ||
    !record.modelVersion ||
    !Number.isFinite(Date.parse(record.predictedAt))
  )
    throw new Error("Pronostic incomplet.");
  validateProbabilities(record.probabilities);
  if (
    record.finalResult != null &&
    !["home", "draw", "away"].includes(record.finalResult)
  )
    throw new Error("Résultat final invalide.");
  return record;
}
// Optional browser storage, injectable for future backend persistence. Never seed fake records.
export function createPredictionHistory(storage) {
  return {
    list() {
      const raw = storage.getItem(KEY);
      if (!raw) return [];
      const records = JSON.parse(raw);
      if (!Array.isArray(records))
        throw new Error("Historique local illisible.");
      return records.map(validateRecord);
    },
    save(record) {
      validateRecord(record);
      const records = this.list();
      storage.setItem(
        KEY,
        JSON.stringify([
          ...records.filter((item) => item.id !== record.id),
          {
            ...record,
            finalResult: record.finalResult ?? null,
            evaluation: record.evaluation ?? null,
          },
        ]),
      );
    },
    evaluate(id, finalResult) {
      if (!["home", "draw", "away"].includes(finalResult))
        throw new Error("Résultat final invalide.");
      const record = this.list().find((item) => item.id === id);
      if (!record) throw new Error("Pronostic introuvable.");
      // Multiclass Brier score, unscaled sum across the three possible outcomes.
      const brierScore = ["home", "draw", "away"].reduce(
        (sum, key) =>
          sum +
          (record.probabilities[key] - (key === finalResult ? 1 : 0)) ** 2,
        0,
      );
      this.save({
        ...record,
        finalResult,
        evaluation: {
          metric: "brier-sum",
          value: brierScore,
          evaluatedAt: new Date().toISOString(),
        },
      });
      return brierScore;
    },
  };
}
