import {
  estimateGoals,
  evaluateGoals,
  fairOdd,
} from "../engines/goalPredictionEngine.js";

// Shared read-only view of the existing engines; personality is intentionally absent.
export function predictionMarketGroups(home, away) {
  return [
    {
      label: "Les deux équipes marquent",
      keys: [
        ["btts_yes", "Oui"],
        ["btts_no", "Non"],
      ],
    },
    {
      label: `${home} marque`,
      keys: [
        ["home_scores", "Oui"],
        ["home_blank", "Non"],
      ],
    },
    {
      label: `${away} marque`,
      keys: [
        ["away_scores", "Oui"],
        ["away_blank", "Non"],
      ],
    },
    ...[1, 2, 3].map((n) => ({
      label: `Total de buts · ${n},5`,
      keys: [
        [`over_${n}_5`, `Plus de ${n},5`],
        [`under_${n}_5`, `Moins de ${n},5`],
      ],
    })),
  ];
}
export function createStatisticalReport({
  dataset,
  home,
  away,
  year,
  venue,
  cutoff,
  match,
}) {
  const forecast = estimateGoals({
    dataset,
    homeId: home.id,
    awayId: away.id,
    year,
    venue,
    cutoff,
    competitionId: match?.competition.id,
  });
  const validation = evaluateGoals(dataset, { cutoff, year });
  const groups = predictionMarketGroups(home.name, away.name);
  const events = forecast.markets
    ? [
        ...[
          ["home", home.name],
          ["draw", "Match nul"],
          ["away", away.name],
        ].map(([id, label]) => ({
          id,
          market: "Résultat",
          selection: label,
          probability: forecast.markets[id],
          theoreticalOdds: fairOdd(forecast.markets[id]),
        })),
        ...groups.flatMap((g) =>
          g.keys.map(([id, label]) => ({
            id,
            market: g.label,
            selection: label,
            probability: forecast.markets[id],
            theoreticalOdds: fairOdd(forecast.markets[id]),
          })),
        ),
      ]
    : [];
  // Retain the existing highlights; a broader event ranking is a later product step.
  const topProbabilities = forecast.markets
    ? groups
        .map((g) => {
          const [key, label] = [...g.keys].sort(
            (a, b) => forecast.markets[b[0]] - forecast.markets[a[0]],
          )[0];
          return {
            group: g.label,
            key,
            label,
            p: forecast.markets[key],
            family:
              key.startsWith("over_") || key.startsWith("under_")
                ? "total"
                : g.label,
          };
        })
        .sort((a, b) => b.p - a.p)
        .filter(
          (item, index, items) =>
            items.findIndex((other) => other.family === item.family) === index,
        )
        .slice(0, 3)
    : [];
  return {
    forecast,
    validation,
    groups,
    events,
    topProbabilities,
    indices: {
      home: {
        score: home.score ?? null,
        variant: home.coverage?.variant ?? null,
      },
      away: {
        score: away.score ?? null,
        variant: away.coverage?.variant ?? null,
      },
    },
    valueRanking: { status: "development", items: [] },
  };
}
export function statisticalVerdict(report) {
  if (report?.forecast.status !== "estimated")
    return report?.forecast.reason || "Probabilités indisponibles.";
  const result = report.events
    .filter((e) => e.market === "Résultat")
    .sort((a, b) => b.probability - a.probability)[0];
  return `Issue la plus probable selon le modèle expérimental : ${result.selection} (${(result.probability * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %).`;
}
