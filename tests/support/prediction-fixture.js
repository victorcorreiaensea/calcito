export function predictionFixture() {
  const teams = Array.from({ length: 8 }, (_, i) => ({
    id: `club-${i}`,
    name: `Club ${i}`,
    is_published: true,
  }));
  const seasons = [
    {
      id: "season",
      competition_id: "league",
      start_year: 2026,
      is_published: true,
    },
  ];
  const competitions = [
    {
      id: "league",
      slug: "ligue-1",
      name: "Ligue 1",
      type: "league",
      is_published: true,
    },
  ];
  const matches = [];
  let rotation = teams.map((t) => t.id);
  for (let round = 0; round < 40; round++) {
    for (let i = 0; i < 4; i++) {
      const kickoff = new Date(
          Date.UTC(2026, 7, 1 + round, 15 + i),
        ).toISOString(),
        known = new Date(Date.parse(kickoff) + 3 * 3600000).toISOString();
      const pair = [rotation[i], rotation[7 - i]];
      if (round % 2) pair.reverse();
      matches.push({
        id: `r${round}-${i}`,
        season_id: "season",
        home_team_id: pair[0],
        away_team_id: pair[1],
        goals_home: (round + i) % 4,
        goals_away: (round * 3 + i) % 3,
        status: "finished",
        is_published: true,
        kickoff,
        verified_at: known,
        updated_at: known,
        source: "Fixture synthétique de test",
      });
    }
    rotation = [rotation[0], rotation[7], ...rotation.slice(1, 7)];
  }
  return {
    teams,
    seasons,
    competitions,
    members: teams.map((t) => ({ team_id: t.id, season_id: "season" })),
    matches,
    simplified: [],
  };
}
