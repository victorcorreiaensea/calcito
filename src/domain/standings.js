import { isTrackedLeague } from "./simplified.js";

export const isStandingsCompetition = (competition) =>
  isTrackedLeague(competition) ||
  (competition?.type === "european-cup" &&
    ["champions-league", "europa-league"].includes(competition.slug));

const knownRules = new Set([
  "points",
  "goalDifference",
  "goalsFor",
  "wins",
  "headToHeadPoints",
  "headToHeadGoalDifference",
]);
export function buildStandings({
  season,
  teams,
  members,
  matches,
  competition,
}) {
  const table = new Map(
    members
      .filter((member) => member.season_id === season.id)
      .map((member) => [
        member.team_id,
        {
          team: teams.find((t) => t.id === member.team_id),
          id: member.team_id,
          group: member.group_name || null,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          points: member.point_adjustment || 0,
          adjustment: member.point_adjustment || 0,
          adjustmentReason: member.adjustment_reason,
          results: [],
        },
      ])
      .filter(([, row]) => row.team),
  );
  const finished = matches
    .filter(
      (m) =>
        m.season_id === season.id &&
        (competition?.type !== "european-cup" ||
          /phase de ligue|league phase/i.test(m.round || "")) &&
        m.is_published &&
        m.status === "finished" &&
        Number.isInteger(m.goals_home) &&
        Number.isInteger(m.goals_away),
    )
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  for (const match of finished) {
    const home = table.get(match.home_team_id),
      away = table.get(match.away_team_id);
    if (!home || !away) continue;
    for (const [row, goalsFor, goalsAgainst] of [
      [home, match.goals_home, match.goals_away],
      [away, match.goals_away, match.goals_home],
    ]) {
      row.played++;
      row.goalsFor += goalsFor;
      row.goalsAgainst += goalsAgainst;
      const result =
        goalsFor > goalsAgainst ? "V" : goalsFor === goalsAgainst ? "N" : "D";
      row[result === "V" ? "won" : result === "N" ? "drawn" : "lost"]++;
      row.points +=
        result === "V"
          ? season.win_points
          : result === "N"
            ? season.draw_points
            : season.loss_points;
      row.results.push(result);
    }
  }
  const rules = Array.isArray(season.tie_breakers)
    ? season.tie_breakers
    : ["points"];
  const unsupported = rules.filter((rule) => !knownRules.has(rule));
  const rows = [...table.values()].map((row) => ({
    ...row,
    goalDifference: row.goalsFor - row.goalsAgainst,
    results: row.results.slice(-5),
  }));
  function miniStats(row, candidates) {
    const ids = new Set(candidates.map((item) => item.id));
    let points = 0,
      diff = 0;
    for (const match of finished) {
      if (
        !ids.has(match.home_team_id) ||
        !ids.has(match.away_team_id) ||
        ![match.home_team_id, match.away_team_id].includes(row.id)
      )
        continue;
      const home = match.home_team_id === row.id,
        gf = home ? match.goals_home : match.goals_away,
        ga = home ? match.goals_away : match.goals_home;
      diff += gf - ga;
      points +=
        gf > ga
          ? season.win_points
          : gf === ga
            ? season.draw_points
            : season.loss_points;
    }
    return { headToHeadPoints: points, headToHeadGoalDifference: diff };
  }
  // Apply criteria to whole tie groups, never a pairwise mini-table (which can be non-transitive).
  function rankGroup(group, index = 0) {
    if (group.length < 2 || index >= rules.length)
      return group
        .sort((a, b) => a.team.name.localeCompare(b.team.name))
        .map((row) => ({ ...row, tieKey: row._tieKey || "" }));
    const criterion = rules[index];
    const value = (row) =>
      criterion.startsWith("headToHead")
        ? miniStats(row, group)[criterion]
        : criterion === "wins"
          ? row.won
          : (row[criterion] ?? 0);
    const buckets = new Map();
    for (const row of group) {
      const score = value(row);
      if (!buckets.has(score)) buckets.set(score, []);
      buckets
        .get(score)
        .push({ ...row, _tieKey: `${row._tieKey || ""}/${score}` });
    }
    return [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .flatMap(([, items]) => rankGroup(items, index + 1));
  }
  const groups = [...new Set(rows.map((row) => row.group))];
  const ranked = groups.flatMap((group) => {
    let previous = null,
      position = 0;
    return rankGroup(rows.filter((row) => row.group === group)).map(
      (row, index) => {
        if (previous !== row.tieKey) {
          position = index + 1;
          previous = row.tieKey;
        }
        return { ...row, position };
      },
    );
  });
  const complete = Boolean(
    season.rules_confirmed &&
    !unsupported.length &&
    season.verified_complete &&
    season.expected_matches &&
    finished.length === season.expected_matches &&
    finished.every((m) => m.source && m.verified_at),
  );
  return {
    rows: ranked,
    partial: !complete,
    unsupported,
    recordedMatches: finished.length,
    expectedMatches: season.expected_matches || null,
  };
}
