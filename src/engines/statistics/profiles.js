import {
  average,
  priorRecords,
  sideObservation,
  statisticFields,
} from "./data.js";

export function summarizeObservations(observations) {
  const metric = (get) => {
    const values = observations
      .map(get)
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    return {
      mean: average(values),
      n: values.length,
      total: values.length ? values.reduce((s, n) => s + n, 0) : null,
      coverage: observations.length
        ? values.length / observations.length
        : null,
    };
  };
  const pairs = observations.filter(
    (o) => o.for.shots > 0 && o.for.shots_on_target != null,
  );
  return {
    n: observations.length,
    goalsFor: metric((o) => o.goalsFor),
    goalsAgainst: metric((o) => o.goalsAgainst),
    points: metric((o) =>
      o.goalsFor > o.goalsAgainst ? 3 : o.goalsFor === o.goalsAgainst ? 1 : 0,
    ),
    for: Object.fromEntries(
      statisticFields.map((key) => [key, metric((o) => o.for[key])]),
    ),
    against: Object.fromEntries(
      statisticFields.map((key) => [key, metric((o) => o.against[key])]),
    ),
    accuracy: {
      n: pairs.length,
      ratio: pairs.length
        ? pairs.reduce((s, o) => s + o.for.shots_on_target, 0) /
          pairs.reduce((s, o) => s + o.for.shots, 0)
        : null,
    },
  };
}
export function teamProfile(
  records,
  { teamId, cutoff, year, competitionId } = {},
) {
  const previous = priorRecords(records, { cutoff, year, competitionId });
  const history = previous.filter(
    (r) => r.home === teamId || r.away === teamId,
  );
  const observations = history.map((r) => sideObservation(r, teamId, cutoff));
  // Opponent strengths are computed at each historical match, never from today's table.
  const opponents = history.map((r) => {
    const id = r.home === teamId ? r.away : r.home;
    const ownPrior = priorRecords(records, {
      cutoff: r.kickoff,
      year: r.year,
      competitionId: r.competition,
    })
      .filter((x) => x.home === id || x.away === id)
      .slice(-5);
    const summary = summarizeObservations(
      ownPrior.map((x) => sideObservation(x, id, r.kickoff)),
    );
    return {
      matchId: r.id,
      teamId: id,
      n: summary.n,
      pointsPerMatch: summary.n >= 5 ? summary.points.mean : null,
    };
  });
  return {
    teamId,
    cutoff,
    year: Number(year),
    competitionId: competitionId || null,
    ...summarizeObservations(observations),
    recent: observations.slice(-5).reverse(),
    last5: summarizeObservations(observations.slice(-5)),
    home: summarizeObservations(observations.filter((o) => o.venue === "home")),
    away: summarizeObservations(observations.filter((o) => o.venue === "away")),
    opponents,
    lastMatch: observations.at(-1)?.kickoff || null,
  };
}
