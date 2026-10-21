import { fairOdd } from "../goalPredictionEngine.js";

// No odds exposed for experimental research; activation requires a future explicit decision.
export function validatedTheoreticalOdds(probability, { status } = {}) {
  return status === "validated" ? fairOdd(probability) : null;
}
