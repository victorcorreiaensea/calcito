import { databaseConfig } from "./supabaseClient.js";
import { getDataset } from "./manualRepository.js";
import { buildStandings } from "../domain/standings.js";

function latestYear(dataset) {
  return dataset.seasons.reduce(
    (year, season) => Math.max(year, season.start_year),
    0,
  );
}
export function manualTeam(raw, dataset, year = latestYear(dataset)) {
  const memberships = dataset.members.filter(
    (member) => member.team_id === raw.id,
  );
  const season = dataset.seasons.find(
    (item) =>
      item.start_year === year &&
      memberships.some((member) => member.season_id === item.id) &&
      dataset.competitions.find((comp) => comp.id === item.competition_id)
        ?.type === "league",
  );
  const comp = dataset.competitions.find(
    (item) => item.id === season?.competition_id,
  );
  const form = dataset.forms.find(
    (item) =>
      item.team_id === raw.id &&
      item.season_start_year === year &&
      item.is_valid &&
      item.is_published,
  );
  return {
    ...raw,
    short: raw.short,
    logo: raw.logo_url,
    color: "#2F8CFF",
    competitionId: comp?.id || null,
    competitionName: comp?.name || null,
    season: memberships.some(member=>dataset.seasons.some(s=>s.id===member.season_id&&s.start_year===year))?year:null,
    score: form?.score == null ? null : Number(form.score),
    source: "manual",
    formHistory: dataset.forms
      .filter(
        (item) =>
          item.team_id === raw.id &&
          item.season_start_year === year &&
          item.is_valid &&
          item.is_published,
      )
      .map((item) => ({
        score: Number(item.score),
        calculatedAt: item.calculated_at,
        version: item.model_version,
      })),
  };
}
function selectedSeason(dataset, competitionId, year) {
  return dataset.seasons.find(
    (item) =>
      (!competitionId || item.competition_id === competitionId) &&
      (!year || item.start_year === Number(year)),
  );
}
export function manualMatch(match, dataset) {
  const season = dataset.seasons.find((item) => item.id === match.season_id);
  const comp = dataset.competitions.find(
    (item) => item.id === season?.competition_id,
  );
  return {
    ...match,
    id: match.id,
    home: manualTeam(
      dataset.teams.find((t) => t.id === match.home_team_id),
      dataset,
      season?.start_year,
    ),
    away: manualTeam(
      dataset.teams.find((t) => t.id === match.away_team_id),
      dataset,
      season?.start_year,
    ),
    competition: {
      id: comp?.id,
      name: comp?.name,
      coefficient: comp?.form_coefficient,
    },
    season: season?.start_year,
    kickoff: match.kickoff,
    status: match.status,
    goalsHome: match.goals_home,
    goalsAway: match.goals_away,
    source: "manual",
    verifiedAt: match.verified_at,
  };
}
export function publicDataset(dataset) {
  const competitions = dataset.competitions.filter((row) => row.is_published);
  const seasons = dataset.seasons.filter(
    (row) =>
      row.is_published &&
      competitions.some((comp) => comp.id === row.competition_id),
  );
  const teams = dataset.teams.filter((row) => row.is_published);
  const members = dataset.members.filter(
    (row) =>
      seasons.some((s) => s.id === row.season_id) &&
      teams.some((t) => t.id === row.team_id),
  );
  const matches = dataset.matches.filter(
    (row) =>
      row.is_published &&
      seasons.some((s) => s.id === row.season_id) &&
      teams.some((t) => t.id === row.home_team_id) &&
      teams.some((t) => t.id === row.away_team_id),
  );
  const stats = dataset.stats.filter((row) =>
    matches.some((m) => m.id === row.match_id),
  );
  const forms = dataset.forms.filter(
    (row) =>
      row.is_published &&
      row.is_valid &&
      teams.some((t) => t.id === row.team_id) &&
      seasons.some(
        (s) =>
          s.start_year === row.season_start_year &&
          members.some(
            (m) => m.season_id === s.id && m.team_id === row.team_id,
          ),
      ),
  );
  const predictions = dataset.predictions.filter(
    (row) =>
      row.is_published &&
      matches.some(
        (m) =>
          m.id === row.match_id &&
          Date.parse(row.predicted_at) < Date.parse(m.kickoff),
      ),
  );
  return {
    competitions,
    seasons,
    teams,
    members,
    matches,
    stats,
    forms,
    predictions,
  };
}
async function query(compute) {
  if (!databaseConfig.configured) {
    const error = new Error(
      "Les résultats sont en préparation. Ils apparaîtront après leur publication.",
    );
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const dataset = await getDataset();
  const publicData = publicDataset(dataset);
  const result = compute(publicData);
  return {
    data: result,
    mode: "manual",
    source: { name: "Saisie manuelle · matchs publiés" },
    fetchedAt: new Date().toISOString(),
    updatedAt:
      [...publicData.matches, ...publicData.stats]
        .map((row) => row.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
  };
}
export const manualAdapter = {
  mode: "manual",
  competitions: () =>
    query((d) =>
      d.competitions.map((comp) => ({
        ...comp,
        seasons: d.seasons
          .filter((s) => s.competition_id === comp.id)
          .map((s) => s.start_year),
        hasSeasons: d.seasons.some((s) => s.competition_id === comp.id),
      })),
    ),
  teams: ({ search = "", competition = "", season } = {}) =>
    query((d) => {
      const selected = competition
        ? selectedSeason(d, competition, season)
        : null;
      return d.teams
        .filter(
          (team) =>
            team.name
              .toLocaleLowerCase("fr")
              .includes(search.toLocaleLowerCase("fr")) &&
            (!season || d.members.some(m=>m.team_id===team.id&&d.seasons.some(s=>s.id===m.season_id&&s.start_year===Number(season)))) &&
            (!competition ||
              d.members.some(
                (m) => m.team_id === team.id && m.season_id === selected?.id,
              )),
        )
        .map((team) => manualTeam(team, d, Number(season) || latestYear(d)));
    }),
  team: (params) =>
    query((d) => {
      const id=typeof params==="string"?params:params.teamId;
      const year=typeof params==="string"?latestYear(d):Number(params.season)||latestYear(d);
      const raw = d.teams.find((t) => t.id === id);
      if (!raw)
        throw new Error("Cette équipe n’est pas publiée ou n’existe pas.");
      return manualTeam(raw, d, year);
    }),
  matches: ({ competition = "", season, view } = {}) =>
    query((d) =>
      d.matches
        .filter((match) => {
          const selected = d.seasons.find((s) => s.id === match.season_id);
          return (
            (!competition || selected?.competition_id === competition) &&
            selected?.start_year === (Number(season) || latestYear(d)) &&
            (!view ||
              (view === "results"
                ? match.status === "finished"
                : match.status !== "finished"))
          );
        })
        .map((match) => manualMatch(match, d)),
    ),
  standings: (params) =>
    query((d) => {
      const { competition, season: year } =
        typeof params === "string" ? { competition: params } : params;
      const season = selectedSeason(d, competition, year);
      if (!season)
        return {
          rows: [],
          partial: true,
          recordedMatches: 0,
          expectedMatches: null,
          season: null,
        };
      const table = buildStandings({
        season,
        teams: d.teams,
        members: d.members,
        matches: d.matches,
      });
      return {
        ...table,
        rows: table.rows.map((row) => ({
          ...row,
          team: manualTeam(row.team, d, season.start_year),
          season: season.start_year,
        })),
        season,
      };
    }),
  recentMatches: (params) =>
    query((d) => {
      const id = typeof params === "string" ? params : params.teamId;
      const year =
        typeof params === "string"
          ? latestYear(d)
          : Number(params.season) || latestYear(d);
      return d.matches
        .filter(
          (match) =>
            match.status === "finished" &&
            [match.home_team_id, match.away_team_id].includes(id) &&
            d.seasons.find((s) => s.id === match.season_id)?.start_year ===
              year,
        )
        .slice(0, 5)
        .map((match) => {
          const stats = d.stats.find(
            (item) => item.match_id === match.id && item.team_id === id,
          );
          return {
            ...manualMatch(match, d),
            teamStats: {
              shots: stats?.shots ?? null,
              bigChances: stats?.big_chances ?? null,
              rating:
                stats?.team_rating == null ? null : Number(stats.team_rating),
              bonuses: stats?.bonuses ?? null,
            },
            sourceReference: match.source,
            manualStats: stats || null,
          };
        });
    }),
  statistics: (params) =>
    query((d) => {
      const id = typeof params === "string" ? params : params.teamId;
      const year =
        typeof params === "string"
          ? latestYear(d)
          : Number(params.season) || latestYear(d);
      const matches = d.matches
        .filter(
          (match) =>
            match.status === "finished" &&
            [match.home_team_id, match.away_team_id].includes(id) &&
            d.seasons.find((s) => s.id === match.season_id)?.start_year ===
              year,
        )
        .slice(0, 5);
      if (!matches.length) return null;
      const metrics = [
        ["shotsPerMatch", "shots"],
        ["shotsOnTargetPerMatch", "shots_on_target"],
        ["woodworkPerMatch", "woodwork"],
        ["bigChancesPerMatch", "big_chances"],
        ["teamRating", "team_rating"],
      ].map(([key, field]) => {
        const values = matches.map(
          (match) =>
            d.stats.find((s) => s.match_id === match.id && s.team_id === id)?.[
              field
            ],
        );
        return {
          key,
          value: values.every((v) => v !== null && v !== undefined)
            ? values.reduce((sum, v) => sum + Number(v), 0) / values.length
            : null,
          available: values.filter((v) => v != null).length,
        };
      });
      return {
        metrics,
        sampleSize: matches.length,
        periodStart: matches.at(-1).kickoff,
        periodEnd: matches[0].kickoff,
      };
    }),
  dataset: () => query((d) => d),
};
