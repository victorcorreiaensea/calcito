import { simulationScenarios } from "../demoData.js";

// Assign a fixed illustrative scenario by identifier. Not a sporting calculation.
export function simulatedProfile(teamId) {
  const seed = [...String(teamId)].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  const scenario = simulationScenarios[seed % simulationScenarios.length];
  return {
    score: scenario.score,
    results: [...scenario.results],
    simulated: true,
  };
}
