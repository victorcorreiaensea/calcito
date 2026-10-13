import { isTrackedLeague, teamHistory, formCoverage } from "./simplified.js";
export function europeanRows(dataset, year) {
  const seasons = dataset.seasons.filter((s) => s.start_year === Number(year));
  return dataset.teams.flatMap((team) => {
    const affiliations = dataset.members
      .filter(
        (m) =>
          m.team_id === team.id && seasons.some((s) => s.id === m.season_id),
      )
      .map((m) =>
        dataset.competitions.find(
          (c) =>
            c.id === seasons.find((s) => s.id === m.season_id)?.competition_id,
        ),
      )
      .filter(Boolean);
    const league = affiliations.find(isTrackedLeague);
    const european = affiliations.some((c) => c.type === "european-cup");
    if (!league && !european) return [];
    const history = teamHistory(dataset, team.id, year, { limit: 5 });
    const snapshot = dataset.forms.find(
      (f) =>
        f.team_id === team.id &&
        f.season_start_year === Number(year) &&
        f.is_valid &&
        f.is_published,
    );
    return [
      {
        team: { ...team, logo: team.logo_url },
        league,
        extra: !league,
        origin:
          league?.name || team.domestic_league || "Championnat non renseigné",
        ...formCoverage(history, snapshot),
      },
    ];
  });
}
export function compatibleRankingGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key =
      row.score == null
        ? "unavailable"
        : `${row.variant}:${row.compatibilityGroup}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups]
    .sort(([a], [b]) =>
      a === "unavailable" ? 1 : b === "unavailable" ? -1 : a.localeCompare(b),
    )
    .map(([key, items]) => {
      const sorted = [...items].sort(
        (a, b) =>
          (b.score ?? -1) - (a.score ?? -1) ||
          a.team.name.localeCompare(b.team.name),
      );
      let rank = 0,
        previous = null;
      return {
        key,
        label:
          key === "unavailable"
            ? "Indices indisponibles"
            : sorted[0].variant === "provisional"
              ? "Indices provisoires — groupe compatible"
              : "Indices complets — groupe compatible",
        rows: sorted.map((row, i) => {
          if (row.score !== previous) rank = i + 1;
          previous = row.score;
          return { ...row, rank: row.score == null ? null : rank };
        }),
      };
    });
}
