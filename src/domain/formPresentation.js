import { dynamicFormModel } from "../config/dynamicFormModel.js";
import { resultsFormModel } from "../config/resultsFormModel.js";
export function formAppreciation(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100)
    return "Indice indisponible";
  if (score >= 90) return "En feu";
  if (score >= 75) return "Très bonne forme";
  if (score >= 60) return "Bonne dynamique";
  if (score >= 45) return "Forme modérée";
  if (score >= 30) return "Dynamique fragile";
  return "En difficulté";
}
export function buildFormStory(
  trace = [],
  { modelVersion, breakdown = [] } = {},
) {
  const valid = (m) =>
    [m.goalsFor, m.goalsAgainst].every(
      (n) => typeof n === "number" && Number.isInteger(n) && n >= 0,
    );
  const recent = trace.slice(0, 5);
  const matches = recent.filter(valid);
  const wins = matches.filter((m) => m.goalsFor > m.goalsAgainst).length;
  const draws = matches.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const losses = matches.length - wins - draws;
  const goalsFor = matches.reduce((n, m) => n + m.goalsFor, 0);
  const goalsAgainst = matches.reduce((n, m) => n + m.goalsAgainst, 0);
  const cleanSheets = matches.filter((m) => m.goalsAgainst === 0).length;
  const awayWins = matches.filter(
    (m) => m.venue === "away" && m.goalsFor > m.goalsAgainst,
  ).length;
  const awayGoals = matches
    .filter((m) => m.venue === "away")
    .reduce((n, m) => n + m.goalsFor, 0);
  const awayMatches = matches.filter((m) => m.venue === "away").length;
  let unbeatenStreak = recent.length ? 0 : null;
  for (const m of recent) {
    if (!valid(m)) {
      unbeatenStreak = null;
      break;
    }
    if (m.goalsFor < m.goalsAgainst) break;
    unbeatenStreak++;
  }
  // Only show numeric contributions provided by the matching, current model.
  const attributable =
    modelVersion === resultsFormModel.version &&
    recent.length === 5 &&
    matches.length === 5 &&
    breakdown.length === 5 &&
    breakdown.every(
      (b, i) =>
        Number.isFinite(b.raw) &&
        b.goalsFor === recent[i].goalsFor &&
        b.goalsAgainst === recent[i].goalsAgainst &&
        b.venue ===
          (["home", "away"].includes(recent[i].venue) ? recent[i].venue : null),
    );
  const contributions = attributable
    ? breakdown.map((b) => (100 * b.raw) / (5 * resultsFormModel.maximum))
    : [];
  const facts = [
    {
      key: "wins",
      value: wins,
      text: `${wins} victoire${wins > 1 ? "s" : ""} sur ${matches.length} matchs`,
    },
    {
      key: "attack",
      value: goalsFor,
      text: `${goalsFor} but${goalsFor > 1 ? "s" : ""} marqué${goalsFor > 1 ? "s" : ""}`,
    },
    {
      key: "defence",
      value: cleanSheets,
      text: `${cleanSheets} match${cleanSheets > 1 ? "s" : ""} sans encaisser`,
    },
    {
      key: "away",
      value: awayWins,
      text: `${awayWins} victoire${awayWins > 1 ? "s" : ""} à l’extérieur${matches.some((m) => !["home", "away"].includes(m.venue)) ? " sur les terrains connus" : ""}`,
    },
  ];
  let summary;
  if (!matches.length)
    summary =
      "Les résultats publiés permettront de raconter la dynamique de cette équipe.";
  else if (matches.length < 5)
    summary = `${matches.length} résultat${matches.length > 1 ? "s" : ""} exploitable${matches.length > 1 ? "s" : ""} : la série est encore incomplète. Cinq matchs sont nécessaires pour calculer la forme.`;
  else {
    const parts = [];
    parts.push(
      wins >= 4
        ? "Les victoires portent la dynamique récente."
        : losses >= 3
          ? "Les résultats récents montrent une équipe en difficulté."
          : draws >= 4
            ? "Les matchs nuls dominent la série récente."
            : "Les résultats dessinent une dynamique contrastée.",
    );
    if (goalsFor >= 10)
      parts.push("L’attaque se distingue par sa production de buts.");
    else if (goalsFor <= 3)
      parts.push("Le faible nombre de buts marqués limite la forme.");
    if (goalsAgainst <= 4 && cleanSheets >= 2)
      parts.push("Les matchs sans encaisser témoignent d’une défense solide.");
    else if (goalsAgainst >= 10)
      parts.push("Les buts encaissés pèsent sur la dynamique.");
    if (awayWins > 0 && attributable)
      parts.push("Les victoires à l’extérieur renforcent l’indice.");
    summary = parts.join(" ");
  }
  return {
    sampleSize: matches.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    cleanSheets,
    awayWins,
    awayGoals,
    awayMatches,
    unbeatenStreak,
    venueKnown: matches.filter((m) => ["home", "away"].includes(m.venue))
      .length,
    facts,
    summary,
    contributions,
  };
}

export function formDimensions(breakdown = [], modelVersion) {
  if (
    modelVersion === dynamicFormModel.version &&
    breakdown.length === 5 &&
    breakdown.every(
      (r) => r.intrinsicBreakdown && Number.isFinite(r.performance),
    )
  ) {
    const intrinsic = formDimensions(
      breakdown.map((r) => r.intrinsicBreakdown),
      resultsFormModel.version,
    );
    if (!intrinsic.length) return [];
    const known = breakdown.filter((r) => Number.isFinite(r.appliedAdjustment));
    if (!known.length) return intrinsic;
    return [
      ...intrinsic,
      {
        key: "surprise",
        label:
          known.length < 5
            ? "Surprise partielle"
            : breakdown.some(
                  (r) => r.beforeInitialized || r.opponentInitialized,
                )
              ? "Surprise estimée"
              : "Surprise relative",
        value: known.reduce((n, r) => n + r.appliedAdjustment, 0) / 5,
      },
    ];
  }

  if (
    modelVersion !== resultsFormModel.version ||
    breakdown.length !== 5 ||
    breakdown.some(
      (b) =>
        !b.components ||
        Object.keys(resultsFormModel.weights).some(
          (key) => !Number.isFinite(b.components[key]) || b.components[key] < 0,
        ),
    )
  )
    return [];
  const groups = [
    ["results", "Résultats", ["result"]],
    ["attack", "Attaque", ["attack"]],
    ["defence", "Défense", ["defence", "homeCleanSheet"]],
    ["balance", "Différence de buts", ["goalDifference"]],
    ["away", "Extérieur", ["awayResult", "awayGoals"]],
  ];
  return groups.map(([key, label, fields]) => ({
    key,
    label,
    value:
      (100 *
        breakdown.reduce(
          (n, b) =>
            n + fields.reduce((sum, f) => sum + (b.components[f] ?? 0), 0),
          0,
        )) /
      (5 * resultsFormModel.maximum),
  }));
}
