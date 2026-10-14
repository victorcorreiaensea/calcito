import { resultsFormModel } from "../config/resultsFormModel.js";
export function calculateResultsForm(history = []) {
  const recent = history.slice(0, 5);
  const validGoal = (n) =>
    (typeof n === "number" || typeof n === "string") &&
    String(n).trim() !== "" &&
    Number.isSafeInteger(Number(n)) &&
    Number(n) >= 0 &&
    Number(n) <= 32767;
  if (
    recent.length !== 5 ||
    recent.some((m) => !validGoal(m.goals_for) || !validGoal(m.goals_against))
  )
    return {
      score: null,
      status: "unavailable",
      reason: "Cinq résultats valides nécessaires",
    };
  const breakdown = recent.map((m) => {
    const gf = Number(m.goals_for),
      ga = Number(m.goals_against);
    const result = gf > ga ? 1 : gf === ga ? 1 / 3 : 0;
    const attack = gf / (gf + 2);
    const components = {
      result,
      goalDifference: (1 + Math.tanh((gf - ga) / 2)) / 2,
      defence: 1 / (ga + 1),
      attack,
      awayResult: m.venue === "away" ? (gf > ga ? 1 : gf === ga ? 0.5 : 0) : 0,
      awayGoals: m.venue === "away" ? attack : 0,
      homeCleanSheet: m.venue === "home" && ga === 0 ? 1 : 0,
    };
    const weighted = Object.fromEntries(
      Object.entries(components).map(([key, value]) => [
        key,
        value * resultsFormModel.weights[key],
      ]),
    );
    return {
      goalsFor: gf,
      goalsAgainst: ga,
      venue: ["home", "away"].includes(m.venue) ? m.venue : null,
      points: result * 3,
      components: weighted,
      raw: Object.values(weighted).reduce((a, b) => a + b, 0),
    };
  });
  return {
    score:
      (100 * breakdown.reduce((n, m) => n + m.raw, 0)) /
      (5 * resultsFormModel.maximum),
    status: "provisional",
    formulaVersion: resultsFormModel.version,
    points: breakdown.reduce((n, m) => n + m.points, 0),
    goalsFor: breakdown.reduce((n, m) => n + m.goalsFor, 0),
    goalsAgainst: breakdown.reduce((n, m) => n + m.goalsAgainst, 0),
    venueKnown: breakdown.filter((m) => m.venue !== null).length,
    breakdown,
  };
}
