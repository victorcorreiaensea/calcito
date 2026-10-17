import { dynamicCoverage, dynamicForms } from "../engines/dynamicFormEngine.js";
import { DATE_ONLY_MARKER } from "../domain/matchImport.js";
import { databaseConfig } from "./supabaseClient.js";
import { getDataset } from "./manualRepository.js";
import {
  teamHistory,
  formCoverage,
  isTrackedLeague,
} from "../domain/simplified.js";
import { buildStandings } from "../domain/standings.js";

function latestYear(dataset) {
  return dataset.seasons.reduce(
    (year, season) => Math.max(year, season.start_year),
    Math.max(0, ...(dataset.simplified || []).map((r) => r.season_start_year)),
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
  const history = teamHistory(dataset, raw.id, year);
  const ids = new Set(
    (dynamicForms(dataset, year).histories.get(raw.id) || [])
      .slice(-5)
      .map((r) => r.matchId),
  );
  const selectedHistory = history.filter((m) => ids.has(m.id));
  const coverage = dynamicCoverage(
    dataset,
    raw.id,
    year,
    formCoverage(selectedHistory, form),
  );
  return {
    ...raw,
    short: raw.short,
    logo: raw.logo_url,
    color: "#2F8CFF",
    europeanCompetitions: dataset.seasons
      .filter(
        (s) =>
          s.start_year === year &&
          memberships.some((m) => m.season_id === s.id),
      )
      .map((s) => dataset.competitions.find((c) => c.id === s.competition_id))
      .filter((c) => c?.type === "european-cup")
      .map((c) => ({ id: c.id, name: c.name })),
    competitionId: comp?.id || null,
    competitionName: comp?.name || raw.domestic_league || null,
    season:
      memberships.some((member) =>
        dataset.seasons.some(
          (s) => s.id === member.season_id && s.start_year === year,
        ),
      ) || history.length
        ? year
        : null,
    score: coverage.score,
    coverage,
    source: "manual",
    formHistory: coverage.dynamicHistory,
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
      type: comp?.type,
      coefficient: comp?.form_coefficient,
    },
    season: season?.start_year,
    kickoff: match.kickoff,
    status: match.status,
    timeKnown: !(match.comment || "").includes(DATE_ONLY_MARKER),
    teamStatistics: {
      home:
        (dataset.stats || []).find(
          (s) => s.match_id === match.id && s.team_id === match.home_team_id,
        ) || null,
      away:
        (dataset.stats || []).find(
          (s) => s.match_id === match.id && s.team_id === match.away_team_id,
        ) || null,
    },
    goalsHome: match.goals_home,
    goalsAway: match.goals_away,
    source: "manual",
    verifiedAt: match.verified_at,
    dynamic:
      dynamicForms(dataset, season?.start_year).matches.get(match.id) || null,
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
  const simplified = (dataset.simplified || [])
    .filter(
      (row) =>
        row.is_published &&
        !row.converted_at &&
        teams.some((t) => t.id === row.team_id),
    )
    .map((row) => ({
      ...row,
      opponent_team_id: teams.some((t) => t.id === row.opponent_team_id)
        ? row.opponent_team_id
        : null,
    }));
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
    simplified,
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
      [...publicData.matches, ...publicData.stats, ...publicData.simplified]
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
  seasonYears: ({ competition } = {}) =>
    query((d) =>
      [
        ...new Set([
          ...d.seasons
            .filter((s) => !competition || s.competition_id === competition)
            .map((s) => s.start_year),
          ...(!competition ? d.simplified.map((r) => r.season_start_year) : []),
        ]),
      ].sort((a, b) => b - a),
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
            (!season ||
              d.members.some(
                (m) =>
                  m.team_id === team.id &&
                  d.seasons.some(
                    (s) =>
                      s.id === m.season_id && s.start_year === Number(season),
                  ),
              ) ||
              d.simplified.some(
                (r) =>
                  r.team_id === team.id &&
                  r.season_start_year === Number(season),
              )) &&
            (!competition ||
              d.members.some(
                (m) => m.team_id === team.id && m.season_id === selected?.id,
              )),
        )
        .map((team) => manualTeam(team, d, Number(season) || latestYear(d)));
    }),
  team: (params) =>
    query((d) => {
      const id = typeof params === "string" ? params : params.teamId;
      const year =
        typeof params === "string"
          ? latestYear(d)
          : Number(params.season) || latestYear(d);
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
                : (match.status === "scheduled" &&
                    Date.parse(match.kickoff) > Date.now()) ||
                  match.status === "live"))
          );
        })
        .sort((a, b) =>
          view === "upcoming"
            ? Date.parse(a.kickoff) - Date.parse(b.kickoff)
            : Date.parse(b.kickoff) - Date.parse(a.kickoff),
        )
        .map((match) => manualMatch(match, d)),
    ),
  standings: (params) =>
    query((d) => {
      const { competition, season: year } =
        typeof params === "string" ? { competition: params } : params;
      const season = selectedSeason(d, competition, year);
      const comp = d.competitions.find((c) => c.id === season?.competition_id);
      if (!isTrackedLeague(comp))
        return {
          rows: [],
          partial: true,
          unsupported: [],
          recordedMatches: 0,
          expectedMatches: null,
          season: null,
        };
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
  teamHistory: (params) =>
    query((d) => {
      const year = Number(params.season) || latestYear(d),
        ledger = dynamicForms(d, year);
      return teamHistory(d, params.teamId, year).map((m) => ({
        ...(m.entry_type === "simplified"
          ? manualSimplified(m, d)
          : manualMatch(m, d)),
        dynamic: ledger.matches.get(m.id) || null,
      }));
    }),
  recentMatches: (params) =>
    query((d) => {
      const id = typeof params === "string" ? params : params.teamId;
      const year =
        typeof params === "string"
          ? latestYear(d)
          : Number(params.season) || latestYear(d);
      const ledger = dynamicForms(d, year);
      const ids = new Set(
        (ledger.histories.get(id) || []).slice(-5).map((r) => r.matchId),
      );
      return teamHistory(d, id, year)
        .filter((m) => ids.has(m.id))
        .slice(0, 5)
        .map((m) => ({
          ...(m.entry_type === "simplified"
            ? manualSimplified(m, d)
            : manualMatch(m, d)),
          entry_type: m.entry_type,
          dynamic: ledger.matches.get(m.id)?.sides.find((r) => r.teamId === id),
          teamStats: {
            shots: m.stats?.shots ?? null,
            bigChances: m.stats?.big_chances ?? null,
            rating:
              m.stats?.team_rating == null ? null : Number(m.stats.team_rating),
            bonuses: m.stats?.bonuses ?? null,
          },
          manualStats: m.stats,
          sourceReference:
            m.entry_type === "simplified"
              ? "Résultat rapide · saisi manuellement"
              : m.source,
        }));
    }),
  formTimeline: ({ teamId, season } = {}) =>
    query((d) => {
      const year = Number(season) || latestYear(d);
      const ledger = dynamicForms(d, year);
      return {
        history: ledger.histories.get(teamId) || [],
        version: ledger.version,
        year,
        excluded: ledger.excluded.filter((e) => e.teamIds?.includes(teamId)),
        coverage: manualTeam(
          d.teams.find((t) => t.id === teamId),
          d,
          year,
        ).coverage,
      };
    }),
  statistics: (params) =>
    query((d) => {
      const id = typeof params === "string" ? params : params.teamId;
      const year =
        typeof params === "string"
          ? latestYear(d)
          : Number(params.season) || latestYear(d);
      const ids = new Set(
        (dynamicForms(d, year).histories.get(id) || [])
          .slice(-5)
          .map((r) => r.matchId),
      );
      const matches = teamHistory(d, id, year)
        .filter((m) => ids.has(m.id))
        .slice(0, 5);
      if (!matches.length) return null;
      const metrics = [
        ["shotsPerMatch", "shots"],
        ["shotsOnTargetPerMatch", "shots_on_target"],
        ["woodworkPerMatch", "woodwork"],
        ["bigChancesPerMatch", "big_chances"],
        ["teamRating", "team_rating"],
        ["xgPerMatch", "xg"],
        ["possessionAverage", "possession"],
        ["cornersPerMatch", "corners"],
        ["passesCompletedPerMatch", "passes_completed"],
        ["passesAttemptedPerMatch", "passes_attempted"],
        ["passAccuracyAverage", "pass_accuracy"],
        ["yellowCardsPerMatch", "yellow_cards"],
        ["redCardsPerMatch", "red_cards"],
      ].map(([key, field]) => {
        const values = matches.map((m) => m.stats?.[field]);
        return {
          key,
          value: values.every((v) => v != null)
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

export function manualSimplified(row, d) {
  const tracked = manualTeam(
    d.teams.find((t) => t.id === row.team_id),
    d,
    row.season_start_year,
  );
  // An optional link is shown only when that opponent's fiche is public.
  const linked = d.teams.find((t) => t.id === row.opponent_team_id);
  const opponent = linked
    ? manualTeam(linked, d, row.season_start_year)
    : {
        id: null,
        name: row.opponent_name,
        short: row.opponent_name.slice(0, 3),
        score: null,
      };
  const home = row.venue === "home";
  return {
    ...row,
    entry_type: "simplified",
    status: "finished",
    home: home ? tracked : opponent,
    away: home ? opponent : tracked,
    goalsHome: home ? row.goals_for : row.goals_against,
    goalsAway: home ? row.goals_against : row.goals_for,
    season: row.season_start_year,
    competition: { id: null, name: row.competition_name, coefficient: null },
    verifiedAt: null,
  };
}
