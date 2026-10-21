import {
  statisticalRecords,
  coverageAudit,
  priorRecords,
} from "../engines/statistics/data.js";
import { teamProfile } from "../engines/statistics/profiles.js";
import { experimentalForm } from "../engines/statistics/form.js";
import {
  researchGoals,
  researchCounts,
} from "../engines/statistics/probabilities.js";
import { validateResearch } from "../engines/statistics/validation.js";

const cache = new WeakMap();
export function createResearchReport({
  dataset,
  home,
  away,
  year,
  venue,
  cutoff,
  match,
}) {
  const records = statisticalRecords(dataset);
  // Never mix national/european populations merely to reach a minimum sample size.
  const known = priorRecords(records, { cutoff, year });
  const common = [
    ...new Set(
      known
        .filter(
          (r) => r.year === Number(year) && [r.home, r.away].includes(home.id),
        )
        .map((r) => r.competition),
    ),
  ].filter((id) =>
    known.some(
      (r) =>
        r.year === Number(year) &&
        r.competition === id &&
        [r.home, r.away].includes(away.id),
    ),
  );
  const competitionId =
    match?.competition?.id || (common.length === 1 ? common[0] : null);
  const options = {
    homeId: home.id,
    awayId: away.id,
    year,
    venue,
    cutoff,
    competitionId,
  };
  const key = JSON.stringify([year, cutoff, competitionId]);
  let cached = cache.get(dataset);
  if (!cached) {
    cached = new Map();
    cache.set(dataset, cached);
  }
  if (!cached.has(key)) {
    const validation = competitionId
      ? validateResearch(records, dataset, options)
      : {
          status: "unavailable",
          reason:
            "Sélectionner une rencontre avec une compétition identifiée pour comparer les modèles.",
          goals: {},
          counts: {},
          form: {},
          selection: { activated: false },
        };
    cached.set(key, validation);
    if (cached.size > 3) cached.delete(cached.keys().next().value);
  }
  return {
    status: "experimental",
    version: "statistics-research-v1",
    arenaAffected: false,
    competitionId,
    coverage: coverageAudit(records, { cutoff, year }),
    profiles: {
      home: teamProfile(records, { ...options, teamId: home.id }),
      away: teamProfile(records, { ...options, teamId: away.id }),
    },
    form: {
      home: experimentalForm(records, { ...options, teamId: home.id }),
      away: experimentalForm(records, { ...options, teamId: away.id }),
    },
    goals: competitionId
      ? researchGoals(records, options)
      : {
          status: "unavailable",
          reason:
            "Compétition commune ambiguë ou absente ; sélectionner un match réel.",
        },
    countMarkets: ["shots_on_target", "corners"].flatMap((statistic) =>
      ["home", "away"].flatMap((side) =>
        (statistic === "corners" ? [4, 6, 8] : [3, 4, 5]).map((threshold) => ({
          statistic,
          side,
          threshold,
          poisson: researchCounts(
            records,
            options,
            statistic,
            side,
            threshold,
            "poisson",
          ),
          negativeBinomial: researchCounts(
            records,
            options,
            statistic,
            side,
            threshold,
            "negative-binomial",
          ),
        })),
      ),
    ),
    validation: cached.get(key),
    reason:
      "Nouveau moteur en étude, distinct des probabilités actuelles et de l’Arène. Aucune variable supplémentaire ni cote activée sans validation indépendante.",
  };
}
