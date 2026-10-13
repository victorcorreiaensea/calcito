import { calculateSimplifiedForm } from "../domain/simplified.js";
export const requiredStatistics = ["shots", "bigChances", "rating", "bonuses"];
export const EUROPEAN_COEFFICIENT = 1.2;
// The owner must explicitly supply the competition IDs to which 1.20 applies.
// No default league, bonus, weight, rating scale or proprietary formula is inferred.
export function prepareCalcitoInput({
  teamId,
  matches = [],
  competitionCoefficients = {},
}) {
  const eligible = matches.filter(
    (match) =>
      match.status === "finished" &&
      Number.isFinite(Date.parse(match.kickoff)) &&
      (match.home?.id === teamId || match.away?.id === teamId),
  );
  const unique = [
    ...new Map(eligible.map((match) => [match.id, match])).values(),
  ];
  const recent = unique
    .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
    .slice(0, 5);
  const missing = [];
  if (recent.length !== 5)
    missing.push("Cinq matchs terminés et datés sont nécessaires.");
  const trace = recent.map((match) => {
    const home = match.home.id === teamId;
    const goalsFor = home ? match.goalsHome : match.goalsAway;
    const goalsAgainst = home ? match.goalsAway : match.goalsHome;
    const validGoals = [goalsFor, goalsAgainst].every(
      (n) => Number.isInteger(n) && n >= 0,
    );
    const result = validGoals
      ? goalsFor > goalsAgainst
        ? "V"
        : goalsFor === goalsAgainst
          ? "N"
          : "D"
      : null;
    if (!result) missing.push(`${match.id} : résultat manquant.`);
    const stats = match.teamStats || {};
    for (const key of requiredStatistics) {
      const valid =
        key === "bonuses"
          ? Array.isArray(stats[key]) && stats[key].every(Number.isFinite)
          : Number.isFinite(stats[key]) && stats[key] >= 0;
      if (!valid) missing.push(`${match.id} : ${key} manquant ou invalide.`);
    }
    const coefficient = competitionCoefficients[match.competition?.id];
    if (!Number.isFinite(coefficient) || coefficient <= 0)
      missing.push(`${match.id} : coefficient de compétition non défini.`);
    return {
      matchId: match.id,
      entryType: match.entry_type || "complete",
      kickoff: match.kickoff,
      opponent: home ? match.away.name : match.home.name,
      result,
      goalsFor,
      goalsAgainst,
      statistics: Object.fromEntries(
        requiredStatistics.map((key) => [key, stats[key] ?? null]),
      ),
      competitionId: match.competition?.id ?? null,
      coefficient: coefficient ?? null,
      sourceReference: match.sourceReference ?? null,
    };
  });
  const indexVariant = recent.some((m) => m.entry_type === "simplified")
    ? "provisional"
    : "complete";
  return {
    teamId,
    indexVariant,
    complete: missing.length === 0,
    missing,
    trace,
  };
}
export function calculateCalcitoForm(input, { formula, formulaVersion } = {}) {
  const prepared = prepareCalcitoInput(input);
  if (prepared.indexVariant === "provisional")
    return {
      ...prepared,
      ...calculateSimplifiedForm(prepared),
      formulaVersion: "results-points-v1",
    };
  if (!prepared.complete)
    return {
      ...prepared,
      status: "insufficient-data",
      score: null,
      formulaVersion: null,
    };
  if (typeof formula !== "function" || !formulaVersion)
    return {
      ...prepared,
      status: "formula-pending",
      score: null,
      formulaVersion: null,
    };
  const score = formula(prepared);
  if (!Number.isFinite(score) || score < 0 || score > 100)
    throw new Error("La formule doit retourner un indice fini entre 0 et 100.");
  return { ...prepared, status: "calculated", score, formulaVersion };
}
