import { poissonMarkets } from "../goalPredictionEngine.js";
import { average, priorRecords, sideObservation } from "./data.js";

export const researchPolicy = Object.freeze({
  version: "statistics-research-v1",
  minimumPool: 30,
  minimumTeam: 5,
  minimumCounts: 8,
  minimumCoverage: 0.6,
  maximumAgeDays: 180,
  validationMinimum: 200,
  selectionMinimum: 60,
  holdoutMinimum: 60,
});
export const goalVariants = Object.freeze([
  "population",
  "recent",
  "venue",
  "opponents",
  "shots",
  "shots_on_target",
]);
const clamp = (n) => Math.max(0.05, Math.min(6, n));
const age = (r, cutoff) =>
  (Date.parse(cutoff) - Date.parse(r.kickoff)) / 86400000;
function context(records, options) {
  const rows = priorRecords(records, options).filter(
    (r) => age(r, options.cutoff) <= researchPolicy.maximumAgeDays,
  );
  return {
    rows,
    home: rows.filter(
      (r) => r.home === options.homeId || r.away === options.homeId,
    ),
    away: rows.filter(
      (r) => r.home === options.awayId || r.away === options.awayId,
    ),
  };
}
const unavailable = (reason, quality = {}) => ({
  status: "unavailable",
  reason,
  quality,
});
export function researchGoals(records, options, variant = "recent") {
  if (!goalVariants.includes(variant)) throw new TypeError("Variante inconnue");
  if (
    !options.competitionId ||
    options.homeId === options.awayId ||
    !["home", "away", "neutral", undefined].includes(options.venue)
  )
    return unavailable("Compétition et adversaires distincts requis.");
  const { rows, home, away } = context(records, options);
  const quality = {
    pool: rows.length,
    home: home.length,
    away: away.length,
    competitionId: options.competitionId,
    cutoff: options.cutoff,
  };
  if (
    rows.length < researchPolicy.minimumPool ||
    home.length < 5 ||
    away.length < 5
  )
    return unavailable(
      "Au moins 30 matchs dans la compétition et 5 par équipe, datant de moins de 180 jours.",
      quality,
    );
  const neutral = options.venue === "neutral";
  const physicalHome = options.venue !== "away";
  const base = (isHome) =>
    neutral
      ? average(rows.flatMap((r) => [r.homeGoals, r.awayGoals]))
      : average(rows.map((r) => (isHome ? r.homeGoals : r.awayGoals)));
  const rate = (history, id, isHome) => {
    let selected = history.slice(-5);
    if (variant === "venue" && !neutral)
      selected = history.filter((r) => (r.home === id) === isHome).slice(-5);
    if (selected.length < (variant === "venue" ? 3 : 5)) return null;
    const observations = selected.map((r) =>
      sideObservation(r, id, options.cutoff),
    );
    if (["shots", "shots_on_target"].includes(variant)) {
      const pairs = rows
        .flatMap((r) => [
          sideObservation(r, r.home, options.cutoff),
          sideObservation(r, r.away, options.cutoff),
        ])
        .filter((o) => o.for[variant] != null);
      const own = observations.filter(
        (o) => o.for[variant] != null && o.against[variant] != null,
      );
      const volume = pairs.reduce((s, o) => s + o.for[variant], 0);
      if (pairs.length < 60 || own.length < 5 || !volume) return null;
      const conversion = pairs.reduce((s, o) => s + o.goalsFor, 0) / volume;
      quality.statisticPairs = pairs.length;
      return {
        attack: average(own.map((o) => o.for[variant])) * conversion,
        defence: average(own.map((o) => o.against[variant])) * conversion,
      };
    }
    if (variant === "opponents") {
      const corrected = selected.map((r, i) => {
        const o = observations[i];
        const prior = priorRecords(records, { ...options, cutoff: r.kickoff });
        const opp = prior
          .filter((x) => x.home === o.opponentId || x.away === o.opponentId)
          .slice(-5)
          .map((x) => sideObservation(x, o.opponentId, r.kickoff));
        if (opp.length < 5 || prior.length < 30) return null;
        const league = average(
          prior.flatMap((x) => [x.homeGoals, x.awayGoals]),
        );
        if (!league) return null;
        const strength = (key) =>
          Math.max(
            0.5,
            Math.min(
              2,
              (average(opp.map((x) => x[key])) + league) / (2 * league),
            ),
          );
        return {
          attack: o.goalsFor / strength("goalsAgainst"),
          defence: o.goalsAgainst / strength("goalsFor"),
        };
      });
      if (corrected.some((o) => !o)) return null;
      return {
        attack: average(corrected.map((o) => o.attack)),
        defence: average(corrected.map((o) => o.defence)),
      };
    }
    return {
      attack: average(observations.map((o) => o.goalsFor)),
      defence: average(observations.map((o) => o.goalsAgainst)),
    };
  };
  let h = base(physicalHome),
    a = base(!physicalHome);
  if (variant !== "population") {
    const hr = rate(home, options.homeId, physicalHome),
      ar = rate(away, options.awayId, !physicalHome);
    if (!hr || !ar)
      return unavailable(
        `Échantillon insuffisant pour la variante ${variant}.`,
        quality,
      );
    // Fixed candidate shrinkage, NOT claimed fitted or optimal. Tested against population and V1.
    h = 0.5 * h + 0.25 * (hr.attack + ar.defence);
    a = 0.5 * a + 0.25 * (ar.attack + hr.defence);
  }
  const clipped = h !== clamp(h) || a !== clamp(a);
  return {
    status: "experimental",
    version: researchPolicy.version,
    variant,
    expectedGoals: { home: clamp(h), away: clamp(a) },
    ...poissonMarkets(clamp(h), clamp(a)),
    odds: null,
    quality: { ...quality, clipped },
    commercialUse: false,
  };
}

// Poisson versus negative binomial (method-of-moments dispersion from prior counts only).
export function countTail(mean, variance, threshold, model = "poisson") {
  if (
    !Number.isFinite(mean) ||
    mean < 0 ||
    !Number.isFinite(variance) ||
    variance < 0 ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    !["poisson", "negative-binomial"].includes(model)
  )
    throw new TypeError("Paramètres de comptage invalides");
  if (!mean) return 0;
  const r =
    model === "negative-binomial" && variance > mean + 1e-6
      ? (mean * mean) / (variance - mean)
      : null;
  let mass = r ? Math.exp(r * Math.log(r / (r + mean))) : Math.exp(-mean),
    cdf = mass;
  for (let k = 1; k < threshold; k++) {
    mass *= r ? (((k - 1 + r) / k) * mean) / (r + mean) : mean / k;
    cdf += mass;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}
export function researchCounts(
  records,
  options,
  statistic,
  side,
  threshold,
  model = "poisson",
) {
  if (
    !["shots_on_target", "corners"].includes(statistic) ||
    !["home", "away"].includes(side)
  )
    throw new TypeError("Marché de comptage inconnu");
  if (!options.competitionId || options.homeId === options.awayId)
    return unavailable("Compétition et adversaires distincts requis.");
  const { rows, home, away } = context(records, options);
  const ownId = side === "home" ? options.homeId : options.awayId,
    oppId = side === "home" ? options.awayId : options.homeId;
  const own = (side === "home" ? home : away)
    .slice(-20)
    .map((r) => sideObservation(r, ownId, options.cutoff));
  const opp = (side === "home" ? away : home)
    .slice(-20)
    .map((r) => sideObservation(r, oppId, options.cutoff));
  const attack = own.map((o) => o.for[statistic]).filter((v) => v != null),
    defence = opp.map((o) => o.against[statistic]).filter((v) => v != null);
  const population = rows
    .flatMap((r) => [
      sideObservation(r, r.home, options.cutoff),
      sideObservation(r, r.away, options.cutoff),
    ])
    .map((o) => o.for[statistic])
    .filter((v) => v != null);
  const quality = {
    pool: population.length,
    home: attack.length,
    away: defence.length,
    ownCoverage: own.length ? attack.length / own.length : 0,
    opponentCoverage: opp.length ? defence.length / opp.length : 0,
    competitionId: options.competitionId,
  };
  if (
    population.length < 60 ||
    attack.length < 8 ||
    defence.length < 8 ||
    quality.ownCoverage < 0.6 ||
    quality.opponentCoverage < 0.6
  )
    return unavailable(
      "8 observations par équipe, couverture ≥ 60 % et 60 observations dans la compétition requises.",
      quality,
    );
  const base = average(population),
    mean = 0.5 * base + 0.25 * (average(attack) + average(defence));
  const variance =
    population.reduce((s, n) => s + (n - base) ** 2, 0) /
    (population.length - 1);
  const probability = countTail(
    mean,
    base ? mean * Math.max(1, variance / base) : mean,
    threshold,
    model,
  );
  return {
    status: "experimental",
    model,
    statistic,
    side,
    threshold,
    probability,
    complement: 1 - probability,
    mean,
    quality,
    theoreticalOdds: null,
    reason: "Validation indépendante requise ; aucune cote activée.",
  };
}
