import { estimateGoals } from "../goalPredictionEngine.js";
import { average, priorRecords, sideObservation, day } from "./data.js";
import {
  researchGoals,
  researchCounts,
  goalVariants,
  researchPolicy,
} from "./probabilities.js";
import { experimentalForm, formVariants } from "./form.js";

const keys = ["home", "draw", "away"];
const safeLog = (p) => -Math.log(Math.max(1e-12, Math.min(1, p)));
function binaryTruth(r) {
  return {
    btts_yes: +(r.homeGoals > 0 && r.awayGoals > 0),
    home_scores: +(r.homeGoals > 0),
    away_scores: +(r.awayGoals > 0),
    over_1_5: +(r.homeGoals + r.awayGoals > 1),
    over_2_5: +(r.homeGoals + r.awayGoals > 2),
    over_3_5: +(r.homeGoals + r.awayGoals > 3),
  };
}
export function scoreForecast(forecast, r) {
  const outcome =
    r.homeGoals > r.awayGoals
      ? "home"
      : r.homeGoals === r.awayGoals
        ? "draw"
        : "away";
  return {
    brier: keys.reduce(
      (sum, key) =>
        sum + (forecast.probabilities[key] - +(key === outcome)) ** 2,
      0,
    ),
    logLoss: safeLog(forecast.probabilities[outcome]),
    binary: Object.entries(binaryTruth(r)).map(([key, y]) => ({
      key,
      p: forecast.markets[key],
      y,
    })),
    calibration: keys.map((key) => ({
      p: forecast.probabilities[key],
      y: +(key === outcome),
    })),
  };
}
function bins(events) {
  return Array.from({ length: 10 }, (_, i) => {
    const selected = events.filter(
      (e) => Math.min(9, Math.floor(e.p * 10)) === i,
    );
    return {
      from: i / 10,
      to: (i + 1) / 10,
      n: selected.length,
      predicted: average(selected.map((e) => e.p)),
      observed: average(selected.map((e) => e.y)),
    };
  });
}
export function summarizeValidation(traces = []) {
  const eventKeys = [
    ...new Set(traces.flatMap((t) => t.binary?.map((e) => e.key) || [])),
  ];
  const difference = traces
    .filter((t) => Number.isFinite(t.baselineBrier))
    .map((t) => t.brier - t.baselineBrier);
  const meanDelta = average(difference);
  const error =
    difference.length > 1
      ? Math.sqrt(
          difference.reduce((s, x) => s + (x - meanDelta) ** 2, 0) /
            (difference.length - 1) /
            difference.length,
        )
      : null;
  return {
    n: traces.length,
    brier: average(traces.map((t) => t.brier)),
    logLoss: average(traces.map((t) => t.logLoss)),
    baselineBrier: average(
      traces.map((t) => t.baselineBrier).filter(Number.isFinite),
    ),
    baselineLogLoss: average(
      traces.map((t) => t.baselineLogLoss).filter(Number.isFinite),
    ),
    pairedDelta: meanDelta,
    approximateDeltaInterval:
      error === null
        ? null
        : [meanDelta - 1.96 * error, meanDelta + 1.96 * error],
    calibration: bins(traces.flatMap((t) => t.calibration || [])),
    binary: Object.fromEntries(
      eventKeys.map((key) => {
        const events = traces.flatMap((t) =>
          (t.binary || []).filter((e) => e.key === key),
        );
        return [
          key,
          {
            n: events.length,
            brier: average(events.map((e) => (e.p - e.y) ** 2)),
            baselineBrier: average(
              events
                .filter((e) => Number.isFinite(e.baselineP))
                .map((e) => (e.baselineP - e.y) ** 2),
            ),
            logLoss: average(
              events.map((e) => (e.y ? safeLog(e.p) : safeLog(1 - e.p))),
            ),
            calibration: bins(events),
          },
        ];
      }),
    ),
  };
}
// Development/holdout split is by complete calendar day, never dividing one day's results.
function splitTraces(traces, splitDay) {
  return {
    development: summarizeValidation(traces.filter((t) => t.date < splitDay)),
    holdout: summarizeValidation(traces.filter((t) => t.date >= splitDay)),
    all: summarizeValidation(traces),
  };
}
export function validateResearch(
  records,
  dataset,
  { cutoff, year, competitionId, limit = 300 } = {},
) {
  const eligible = priorRecords(records, { cutoff, year, competitionId }).slice(
    -Math.max(1, Math.min(600, limit)),
  );
  const dates = [...new Set(eligible.map((r) => r.date))];
  const splitDay = dates[Math.floor(dates.length * 0.6)] || day(cutoff);
  const goalTraces = Object.fromEntries(
    [...goalVariants, "legacy"].map((key) => [key, []]),
  );
  const countTraces = {},
    formTraces = Object.fromEntries(formVariants.map((key) => [key, []]));
  for (const r of eligible) {
    const options = {
      homeId: r.home,
      awayId: r.away,
      year: r.year,
      competitionId: r.competition,
      cutoff: r.kickoff,
      venue: "home",
    };
    const prior = priorRecords(records, options);
    if (prior.length < researchPolicy.minimumPool) continue;
    const frequencies = { home: 0, draw: 0, away: 0 };
    for (const x of prior)
      frequencies[
        x.homeGoals > x.awayGoals
          ? "home"
          : x.homeGoals === x.awayGoals
            ? "draw"
            : "away"
      ]++;
    const baseline = {
      probabilities: Object.fromEntries(
        keys.map((k) => [k, (frequencies[k] + 1) / (prior.length + 3)]),
      ),
      markets: {},
    };
    for (const key of Object.keys(binaryTruth(r)))
      baseline.markets[key] =
        (prior.reduce((s, x) => s + binaryTruth(x)[key], 0) + 1) /
        (prior.length + 2);
    const baselineScore = scoreForecast(baseline, r);
    for (const variant of [...goalVariants, "legacy"]) {
      const forecast =
        variant === "legacy"
          ? estimateGoals({ ...options, dataset, records })
          : researchGoals(records, options, variant);
      if (!forecast.probabilities) continue;
      const score = scoreForecast(forecast, r);
      score.binary = score.binary.map((event) => ({
        ...event,
        baselineP: baseline.markets[event.key],
      }));
      goalTraces[variant].push({
        matchId: r.id,
        date: r.date,
        ...score,
        baselineBrier: baselineScore.brier,
        baselineLogLoss: baselineScore.logLoss,
        expectedGoals: forecast.expectedGoals,
      });
    }
    const hform = experimentalForm(records, { ...options, teamId: r.home });
    const aform = experimentalForm(records, { ...options, teamId: r.away });
    const actualDifference = Math.sign(r.homeGoals - r.awayGoals);
    for (const key of formVariants) {
      const h = hform.variants[key].score,
        a = aform.variants[key].score;
      if (h === null || a === null) continue;
      const error = ((h - a) / 100 - actualDifference) ** 2;
      const href = hform.variants.results.score,
        aref = aform.variants.results.score;
      formTraces[key].push({
        matchId: r.id,
        date: r.date,
        squaredError: error,
        baselineSquaredError: ((href - aref) / 100 - actualDifference) ** 2,
      });
    }
    for (const statistic of ["shots_on_target", "corners"])
      for (const side of ["home", "away"]) {
        const target = sideObservation(
          r,
          side === "home" ? r.home : r.away,
          cutoff,
        ).for[statistic];
        if (target == null) continue;
        const historical = prior
          .map(
            (x) =>
              sideObservation(x, side === "home" ? x.home : x.away, r.kickoff)
                .for[statistic],
          )
          .filter((v) => v != null);
        for (const threshold of statistic === "corners" ? [4, 6, 8] : [3, 4, 5])
          for (const model of ["poisson", "negative-binomial"]) {
            const f = researchCounts(
              records,
              options,
              statistic,
              side,
              threshold,
              model,
            );
            if (f.probability == null) continue;
            const key = `${statistic}:${side}:${threshold}:${model}`;
            const y = +(target >= threshold),
              p = f.probability;
            const b =
              (historical.filter((v) => v >= threshold).length + 1) /
              (historical.length + 2);
            (countTraces[key] ||= []).push({
              matchId: r.id,
              date: r.date,
              brier: (p - y) ** 2,
              logLoss: y ? safeLog(p) : safeLog(1 - p),
              baselineBrier: (b - y) ** 2,
              baselineLogLoss: y ? safeLog(b) : safeLog(1 - b),
              calibration: [{ p, y }],
            });
          }
      }
  }
  const goals = Object.fromEntries(
    Object.entries(goalTraces).map(([key, traces]) => [
      key,
      { ...splitTraces(traces, splitDay), traces },
    ]),
  );
  // Compare each candidate on paired cases versus the unchanged V1 as well as frequencies.
  const legacy = new Map(goalTraces.legacy.map((t) => [t.matchId, t]));
  for (const key of goalVariants) {
    goals[key].versusLegacy = splitTraces(
      goalTraces[key]
        .filter((t) => legacy.has(t.matchId))
        .map((t) => ({
          ...t,
          baselineBrier: legacy.get(t.matchId).brier,
          baselineLogLoss: legacy.get(t.matchId).logLoss,
        })),
      splitDay,
    );
  }
  // Selection uses development ONLY; holdout cannot select a variable or tune a coefficient.
  const candidates = goalVariants
    .filter(
      (key) =>
        key !== "population" &&
        goals[key].development.n >= researchPolicy.selectionMinimum,
    )
    .sort(
      (a, b) =>
        goals[a].development.pairedDelta - goals[b].development.pairedDelta,
    );
  const selectedCandidate = candidates[0] || null;
  const selected = selectedCandidate ? goals[selectedCandidate] : null;
  const heldout = selected?.holdout;
  const promising = !!(
    heldout &&
    heldout.n >= researchPolicy.holdoutMinimum &&
    heldout.pairedDelta < 0 &&
    heldout.logLoss < heldout.baselineLogLoss
  );
  const evidenceGaps = [
    ...(!selected
      ? ["Aucun candidat ne dispose de 60 prédictions de développement."]
      : []),
    ...(selected && selected.all.n < researchPolicy.validationMinimum
      ? [
          `${selected.all.n}/${researchPolicy.validationMinimum} prédictions totales pour le candidat étudié.`,
        ]
      : []),
    ...(heldout && heldout.n < researchPolicy.holdoutMinimum
      ? [
          `${heldout.n}/${researchPolicy.holdoutMinimum} prédictions sur la période de contrôle.`,
        ]
      : []),
    ...(!promising
      ? [
          "Amélioration Brier et log loss non démontrée sur la période de contrôle.",
        ]
      : []),
    "Calibration et stabilité à vérifier par compétition, équipe et marché sur une nouvelle période prospective.",
  ];
  const formSummary = (traces) => ({
    n: traces.length,
    mse: average(traces.map((t) => t.squaredError)),
    baselineMse: average(traces.map((t) => t.baselineSquaredError)),
  });
  return {
    status: "experimental",
    policy: researchPolicy,
    splitDay,
    candidatesExamined: eligible.length,
    goals,
    counts: Object.fromEntries(
      Object.entries(countTraces).map(([key, traces]) => [
        key,
        { ...splitTraces(traces, splitDay), traces },
      ]),
    ),
    form: Object.fromEntries(
      Object.entries(formTraces).map(([key, traces]) => [
        key,
        {
          all: formSummary(traces),
          development: formSummary(traces.filter((t) => t.date < splitDay)),
          holdout: formSummary(traces.filter((t) => t.date >= splitDay)),
          traces,
        },
      ]),
    ),
    selection: {
      candidate: selectedCandidate,
      promising,
      evidenceGaps,
      activated: false,
      retainedAdditionalVariables: [],
      reason:
        "Recherche uniquement : aucune activation automatique. Il manque une validation prospective indépendante et suffisante par compétition/marché, avec contrôle de calibration et stabilité.",
    },
    limitations: [
      "Les dates de dernière modification ne reconstituent pas les anciennes versions : les lignes modifiées tardivement sont exclues du passé.",
      "Les intervalles supposent des observations indépendantes ; les matchs d’une journée et d’une équipe sont corrélés. Ils ne constituent pas une certification.",
      "Fenêtre de 180 jours, une seule compétition/saison, pas de transfert automatique entre championnats.",
      "Les résultats de forme mesurent une erreur descriptive sur le résultat suivant, pas une probabilité de victoire.",
    ],
  };
}
