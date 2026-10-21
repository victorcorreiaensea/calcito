import { predictionRecords } from "../goalPredictionEngine.js";

export const statisticFields = Object.freeze([
  "shots",
  "shots_on_target",
  "corners",
  "possession",
  "xg",
  "big_chances",
  "woodwork",
  "team_rating",
  "passes_completed",
  "passes_attempted",
  "pass_accuracy",
  "yellow_cards",
  "red_cards",
]);
const bounded = { possession: 100, pass_accuracy: 100, team_rating: 10 };
export const validStatistic = (key, value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= (bounded[key] ?? 32767) &&
  (["possession", "pass_accuracy", "team_rating", "xg"].includes(key) ||
    Number.isInteger(value));
export const average = (values) =>
  values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
export const day = (date) => new Date(date).toISOString().slice(0, 10);
export function assertCutoff(cutoff) {
  if (!Number.isFinite(Date.parse(cutoff)))
    throw new TypeError("Date de calcul invalide");
}
// Reuse the public, verified, conflict-aware score normalizer; never infer availability.
export function statisticalRecords(dataset = {}) {
  const groups = new Map();
  for (const row of dataset.stats || []) {
    const key = `${row.match_id}:${row.team_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const read = (record, team) => {
    const rows = groups.get(`${record.id}:${team}`) || [];
    if (rows.length !== 1 || record.kind !== "detailed") return null;
    const row = rows[0];
    // Missing timestamps cannot establish historical availability. Both timestamps matter.
    if (
      ![row.created_at, row.updated_at].every((v) =>
        Number.isFinite(Date.parse(v)),
      )
    )
      return null;
    const values = Object.fromEntries(
      statisticFields.map((key) => [
        key,
        validStatistic(key, row[key]) ? row[key] : null,
      ]),
    );
    if (values.shots !== null && values.shots_on_target > values.shots)
      values.shots_on_target = null;
    return {
      values,
      availableAt: Math.max(
        record.availableAt,
        Date.parse(row.created_at),
        Date.parse(row.updated_at),
      ),
    };
  };
  return predictionRecords(dataset).map((record) => ({
    ...record,
    statistics: {
      home: read(record, record.home),
      away: read(record, record.away),
    },
  }));
}
export function priorRecords(records, { cutoff, year, competitionId } = {}) {
  assertCutoff(cutoff);
  return records.filter(
    (r) =>
      r.year === Number(year) &&
      (!competitionId || r.competition === competitionId) &&
      r.availableAt < Date.parse(cutoff) &&
      r.date < day(cutoff),
  );
}
export function sideObservation(record, teamId, cutoff) {
  const home = record.home === teamId;
  const own = record.statistics?.[home ? "home" : "away"];
  const opponent = record.statistics?.[home ? "away" : "home"];
  const usable = (row) =>
    row && row.availableAt < Date.parse(cutoff) ? row.values : {};
  return {
    id: record.id,
    kickoff: record.kickoff,
    competition: record.competition,
    venue: home ? "home" : "away",
    opponentId: home ? record.away : record.home,
    goalsFor: home ? record.homeGoals : record.awayGoals,
    goalsAgainst: home ? record.awayGoals : record.homeGoals,
    for: usable(own),
    against: usable(opponent),
  };
}
export function coverageAudit(records, { cutoff, year } = {}) {
  const rows = priorRecords(records, { cutoff, year });
  const summarize = (selected, teamId) => ({
    matches: selected.length,
    detailed: selected.filter((r) => r.kind === "detailed").length,
    simplified: selected.filter((r) => r.kind === "simplified").length,
    fields: Object.fromEntries(
      statisticFields.map((key) => {
        const observations = selected.flatMap((r) =>
          teamId
            ? [sideObservation(r, teamId, cutoff)]
            : [
                sideObservation(r, r.home, cutoff),
                sideObservation(r, r.away, cutoff),
              ],
        );
        const n = observations.filter(
          (o) => o.for[key] !== null && o.for[key] !== undefined,
        ).length;
        return [
          key,
          {
            n,
            denominator: observations.length,
            coverage: observations.length ? n / observations.length : null,
          },
        ];
      }),
    ),
  });
  return {
    cutoff,
    year: Number(year),
    ...summarize(rows),
    competitions: [...new Set(rows.map((r) => r.competition))].map((id) => ({
      id,
      ...summarize(rows.filter((r) => r.competition === id)),
    })),
    teams: [...new Set(rows.flatMap((r) => [r.home, r.away]))].map((id) => ({
      id,
      ...summarize(
        rows.filter((r) => r.home === id || r.away === id),
        id,
      ),
    })),
  };
}
