import { average, priorRecords, sideObservation } from "./data.js";

export const formVariants = Object.freeze([
  "results",
  "goals",
  "context",
  "shots",
  "accuracy",
  "targetDefence",
]);
const percentile = (value, population) =>
  population.length
    ? (100 *
        population.reduce(
          (n, x) => n + (x < value ? 1 : x === value ? 0.5 : 0),
          0,
        )) /
      population.length
    : null;
// Alternative one-dimensional signals: never sum correlated shot volume and accuracy.
// Percentiles are descriptive ranks, NOT probabilities, and have no fitted coefficients.
export function experimentalForm(
  records,
  { teamId, cutoff, year, competitionId } = {},
) {
  const previous = priorRecords(records, { cutoff, year, competitionId });
  const own = previous
    .filter((r) => r.home === teamId || r.away === teamId)
    .slice(-5)
    .map((r) => sideObservation(r, teamId, cutoff));
  const population = previous.flatMap((r) => [
    sideObservation(r, r.home, cutoff),
    sideObservation(r, r.away, cutoff),
  ]);
  const signals = {
    results: (o) =>
      o.goalsFor > o.goalsAgainst
        ? 1
        : o.goalsFor === o.goalsAgainst
          ? 1 / 3
          : 0,
    goals: (o) => o.goalsFor - o.goalsAgainst,
    shots: (o) =>
      o.for.shots == null || o.against.shots == null
        ? null
        : o.for.shots - o.against.shots,
    accuracy: (o) =>
      o.for.shots > 0 && o.for.shots_on_target != null
        ? o.for.shots_on_target / o.for.shots
        : null,
    targetDefence: (o) =>
      o.against.shots_on_target == null ? null : -o.against.shots_on_target,
    context: (o) => {
      const prior = priorRecords(records, {
        cutoff: o.kickoff,
        year,
        competitionId: o.competition,
      });
      const opponents = prior
        .filter((r) => r.home === o.opponentId || r.away === o.opponentId)
        .slice(-5)
        .map((r) => sideObservation(r, o.opponentId, o.kickoff));
      const venue = prior.map((r) =>
        sideObservation(r, o.venue === "home" ? r.home : r.away, o.kickoff),
      );
      if (opponents.length < 5 || venue.length < 30) return null;
      const opponentPoints = average(opponents.map(signals.results));
      // Residual versus prior venue points and opponent's previous strength; research hypothesis only.
      return (
        signals.results(o) -
        (average(venue.map(signals.results)) + 1 - opponentPoints) / 2
      );
    },
  };
  return {
    version: "form-research-v1",
    status: own.length === 5 ? "experimental" : "unavailable",
    reason:
      "Variantes descriptives à comparer sur le résultat du match suivant ; aucun remplacement de form-v4.",
    variants: Object.fromEntries(
      formVariants.map((key) => {
        const values = own.map(signals[key]).filter((v) => v !== null);
        const reference =
          key === "context"
            ? previous.map(() => 0)
            : population.map(signals[key]).filter((v) => v !== null);
        const raw = average(values);
        return [
          key,
          {
            score:
              values.length === 5 && reference.length >= 30
                ? key === "results"
                  ? raw * 100
                  : key === "context"
                    ? Math.max(0, Math.min(100, 50 * (1 + raw)))
                    : percentile(raw, reference)
                : null,
            n: values.length,
            referenceN: reference.length,
          },
        ];
      }),
    ),
  };
}
