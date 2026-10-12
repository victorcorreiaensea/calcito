// Server-only adapter. This module is never imported by the Vite application.
const HOST = "https://v3.football.api-sports.io";
const domesticCompetitions = new Set([
  "France:Ligue 1",
  "England:Premier League",
  "Spain:La Liga",
  "Italy:Serie A",
  "Germany:Bundesliga",
  "Portugal:Primeira Liga",
]);
const internationalCompetitions = new Set([
  "UEFA Champions League",
  "World Cup",
  "Euro Championship",
  "Copa America",
  "Africa Cup of Nations",
  "UEFA Nations League",
]);
export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function createApiFootballProvider({
  apiKey,
  fetchImpl = fetch,
  now = Date.now,
  ttl = 60000,
}) {
  const cache = new Map(),
    pending = new Map();
  async function get(path, params = {}) {
    if (!apiKey)
      throw new ProviderError("API-Football non configurée côté serveur.", 503);
    const url = new URL(`${HOST}/${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== "") url.searchParams.set(key, value);
    });
    const key = url.href;
    const cached = cache.get(key);
    if (cached && now() - cached.time < ttl) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { "x-apisports-key": apiKey },
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        throw new ProviderError("API-Football inaccessible.");
      }
      if (!response.ok)
        throw new ProviderError(
          response.status === 429
            ? "Quota API-Football atteint."
            : "Accès au fournisseur indisponible.",
          response.status === 429 ? 429 : 502,
        );
      let body;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError("Réponse API-Football illisible.");
      }
      if (
        !body ||
        Object.keys(body.errors || {}).length ||
        !Array.isArray(body.response)
      )
        throw new ProviderError(
          "API-Football ne peut pas fournir ces données : vérifiez les droits, la saison et le quota du compte.",
        );
      cache.set(key, { time: now(), value: body.response });
      // Bound long-running server memory, retaining the most recent entries.
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return body.response;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  function numericId(id) {
    if (typeof id !== "string" || !/^\d{1,10}$/.test(id))
      throw new ProviderError("Identifiant API-Football invalide.", 400);
    return id;
  }
  function team(raw) {
    if (!raw?.id || !raw.name)
      throw new ProviderError(
        "Identité d’équipe manquante chez le fournisseur.",
      );
    return {
      id: String(raw.id),
      name: raw.name,
      short: raw.code || raw.name.slice(0, 3).toUpperCase(),
      logo: raw.logo || null,
      country: raw.country || null,
    };
  }
  function fixture(raw) {
    const status = raw.fixture?.status?.short;
    const statuses = {
      FT: "finished",
      AET: "finished",
      PEN: "finished",
      NS: "scheduled",
      TBD: "scheduled",
      PST: "postponed",
      CANC: "cancelled",
      ABD: "cancelled",
      AWD: "cancelled",
      WO: "cancelled",
      SUSP: "postponed",
      INT: "postponed",
    };
    return {
      id: String(raw.fixture.id),
      kickoff: raw.fixture.date,
      status: statuses[status] || "live",
      home: team(raw.teams.home),
      away: team(raw.teams.away),
      competition: { id: String(raw.league.id), name: raw.league.name },
      goalsHome: raw.goals?.home ?? null,
      goalsAway: raw.goals?.away ?? null,
      sourceReference: `API-Football fixture ${raw.fixture.id}`,
    };
  }
  function leagueSeason(league) {
    const season = league?.seasons?.find((item) => item.current);
    if (!season)
      throw new ProviderError(
        "Saison courante indisponible pour cette compétition.",
        404,
      );
    return season.year;
  }
  async function competition(id) {
    const [league] = await get("leagues", {
      id: numericId(id),
      current: "true",
    });
    if (!league) throw new ProviderError("Compétition introuvable.", 404);
    return league;
  }
  async function competitions() {
    return (await get("leagues", { current: "true" }))
      .filter(
        (item) =>
          domesticCompetitions.has(
            `${item.country?.name}:${item.league.name}`,
          ) ||
          (item.country?.name === "World" &&
            internationalCompetitions.has(item.league.name)),
      )
      .map((item) => ({
        id: String(item.league.id),
        name: item.league.name,
        country: item.country?.name || null,
      }));
  }
  async function teamList({ search, competition: competitionId } = {}) {
    if (search) {
      if (search.trim().length < 3) return [];
      const list = await get("teams", { search: search.trim() });
      if (!competitionId) return list.map((item) => team(item.team));
      const league = await competition(competitionId);
      const members = await get("teams", {
        league: competitionId,
        season: leagueSeason(league),
      });
      const ids = new Set(members.map((item) => item.team.id));
      return list
        .filter((item) => ids.has(item.team.id))
        .map((item) => ({
          ...team(item.team),
          competitionId,
          competitionName: league.league.name,
        }));
    }
    // API-Football requires a league/season or a search. Use Ligue 1 as documented default.
    const id = competitionId || "61";
    const league = await competition(id);
    return (
      await get("teams", { league: id, season: leagueSeason(league) })
    ).map((item) => ({
      ...team(item.team),
      competitionId: id,
      competitionName: league.league.name,
    }));
  }
  async function teamDetail(id) {
    const [item] = await get("teams", { id: numericId(id) });
    if (!item) throw new ProviderError("Équipe introuvable.", 404);
    return team(item.team);
  }
  async function matches({ competition: id, view = "upcoming" } = {}) {
    if (!["upcoming", "results"].includes(view))
      throw new ProviderError("Filtre de calendrier invalide.", 400);
    const window =
      view === "results" ? { last: 20, status: "FT-AET-PEN" } : { next: 20 };
    if (id) {
      const league = await competition(id);
      return (
        await get("fixtures", {
          league: id,
          season: leagueSeason(league),
          ...window,
        })
      ).map(fixture);
    }
    const leagueList = await competitions();
    const selected = leagueList.slice(0, 8);
    const fixtures = await Promise.all(
      selected.map((league) =>
        get("fixtures", {
          league: league.id,
          ...(view === "results"
            ? { last: 5, status: "FT-AET-PEN" }
            : { next: 5 }),
        }),
      ),
    );
    return fixtures
      .flat()
      .map(fixture)
      .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  }
  async function recentMatches(id) {
    numericId(id);
    const recent = (
      await get("fixtures", { team: id, last: 5, status: "FT-AET-PEN" })
    )
      .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date))
      .slice(0, 5);
    return Promise.all(
      recent.map(async (raw) => {
        // A provider may not cover statistics; preserve that gap without losing the result.
        let rows = [],
          statisticsStatus = "available";
        try {
          rows = await get("fixtures/statistics", {
            fixture: raw.fixture.id,
            team: id,
          });
        } catch {
          statisticsStatus = "unavailable";
        }
        const stats =
          rows.find((row) => String(row.team.id) === id)?.statistics || [];
        const read = (type) => {
          const value = stats.find((stat) => stat.type === type)?.value;
          return typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
        };
        return {
          ...fixture(raw),
          statisticsStatus,
          teamStats: {
            shots: read("Total Shots"),
            bigChances: read("Big Chances"),
            rating: null,
            bonuses: null,
          },
        };
      }),
    );
  }
  async function statistics(id) {
    const recent = await recentMatches(id);
    if (!recent.length)
      throw new ProviderError(
        "Aucun match terminé disponible pour les statistiques.",
        404,
      );
    const mean = (key) =>
      recent.every((match) => Number.isFinite(match.teamStats[key]))
        ? recent.reduce((sum, match) => sum + match.teamStats[key], 0) /
          recent.length
        : null;
    return {
      periodStart: recent.at(-1).kickoff,
      periodEnd: recent[0].kickoff,
      sampleSize: recent.length,
      shotsPerMatch: mean("shots"),
      bigChancesPerMatch: mean("bigChances"),
      teamRating: null,
    };
  }
  async function standings(id) {
    const league = await competition(id);
    const response = await get("standings", {
      league: id,
      season: leagueSeason(league),
    });
    const groups = response[0]?.league?.standings || [];
    if (groups.length > 1)
      throw new ProviderError(
        "Classement à plusieurs groupes : présentation dédiée nécessaire. Aucun classement global n’est fabriqué.",
        422,
      );
    return (groups[0] || []).map((row) => ({
      position: row.rank,
      team: team(row.team),
      played: row.all?.played ?? null,
      won: row.all?.win ?? null,
      drawn: row.all?.draw ?? null,
      lost: row.all?.lose ?? null,
      goalsFor: row.all?.goals?.for ?? null,
      goalsAgainst: row.all?.goals?.against ?? null,
      points: row.points ?? null,
    }));
  }
  return {
    competitions,
    teams: teamList,
    team: teamDetail,
    matches,
    recentMatches,
    statistics,
    standings,
  };
}
