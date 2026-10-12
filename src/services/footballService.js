import { manualAdapter } from "./manualAdapter.js";
import { teams, matches, demoCompetitions } from "../demoData.js";

export class FootballError extends Error {
  constructor(message, code = "UNAVAILABLE") {
    super(message);
    this.name = "FootballError";
    this.code = code;
  }
}
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
function safeImage(value) {
  if (value == null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function requireIdentity(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.name !== "string" ||
    !item.name
  )
    throw new FootballError(
      "Réponse du fournisseur incompatible : identité manquante.",
      "INVALID_DATA",
    );
}
export function normalizeTeam(team) {
  requireIdentity(team);
  return {
    id: team.id,
    name: team.name,
    short:
      typeof team.short === "string"
        ? team.short
        : team.name.slice(0, 3).toUpperCase(),
    logo: safeImage(team.logo),
    country: team.country ?? null,
    competitionId: team.competitionId ?? null,
    competitionName: team.competitionName ?? null,
    source: "real",
    score: null,
    season: Number.isInteger(team.season) ? team.season : null,
  };
}
function normalizeCompetition(item) {
  requireIdentity(item);
  return {
    id: item.id,
    name: item.name,
    country: item.country ?? null,
    seasons: Array.isArray(item.seasons)
      ? item.seasons.filter(Number.isInteger)
      : [],
  };
}
function normalizeMatch(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !["scheduled", "finished", "live", "postponed", "cancelled"].includes(
      item.status,
    ) ||
    !Number.isFinite(Date.parse(item.kickoff))
  )
    throw new FootballError(
      "Réponse du fournisseur incompatible : match invalide.",
      "INVALID_DATA",
    );
  return {
    id: item.id,
    home: normalizeTeam(item.home),
    away: normalizeTeam(item.away),
    competition: item.competition ?? null,
    kickoff: item.kickoff,
    status: item.status,
    goalsHome: isNumber(item.goalsHome) ? item.goalsHome : null,
    goalsAway: isNumber(item.goalsAway) ? item.goalsAway : null,
  };
}
function normalizeRecent(item) {
  const match = normalizeMatch(item);
  const stats = item.teamStats || {};
  return {
    ...match,
    teamStats: {
      shots: isNumber(stats.shots) ? stats.shots : null,
      bigChances: isNumber(stats.bigChances) ? stats.bigChances : null,
      rating: isNumber(stats.rating) ? stats.rating : null,
      bonuses:
        Array.isArray(stats.bonuses) && stats.bonuses.every(isNumber)
          ? stats.bonuses
          : null,
    },
    sourceReference:
      typeof item.sourceReference === "string" ? item.sourceReference : item.id,
  };
}
function normalizeStanding(row) {
  if (!row || !Number.isInteger(row.position) || row.position < 1)
    throw new FootballError(
      "Classement incompatible avec le contrat de données.",
      "INVALID_DATA",
    );
  const values = [
    "played",
    "won",
    "drawn",
    "lost",
    "goalsFor",
    "goalsAgainst",
    "points",
  ];
  return {
    position: row.position,
    group: typeof row.group === "string" ? row.group : null,
    season: Number.isInteger(row.season) ? row.season : null,
    team: normalizeTeam(row.team),
    ...Object.fromEntries(
      values.map((key) => [key, isNumber(row[key]) ? row[key] : null]),
    ),
  };
}
function normalizeStats(stats) {
  if (
    !stats ||
    typeof stats !== "object" ||
    !Number.isFinite(Date.parse(stats.periodStart)) ||
    !Number.isFinite(Date.parse(stats.periodEnd)) ||
    !Number.isInteger(stats.sampleSize) ||
    stats.sampleSize < 1
  )
    throw new FootballError(
      "Période et échantillon des statistiques manquants.",
      "INVALID_DATA",
    );
  return {
    periodStart: stats.periodStart,
    periodEnd: stats.periodEnd,
    sampleSize: stats.sampleSize,
    metrics: ["shotsPerMatch", "bigChancesPerMatch", "teamRating"].map(
      (key) => ({
        key,
        value: isNumber(stats[key]) && stats[key] >= 0 ? stats[key] : null,
      }),
    ),
  };
}
export function createProxyAdapter(baseUrl, { fetchImpl = fetch } = {}) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new FootballError(
      "Le backend doit utiliser une adresse HTTPS publique sans identifiant, clé ou paramètres.",
      "CONFIG",
    );
  const base = url.href.replace(/\/$/, "");
  async function request(path, params, normalize, list = true) {
    const target = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(params || {}))
      if (value != null && value !== "") target.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(target, {
        signal: AbortSignal.timeout(60000),
        credentials: "omit",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new FootballError(
        "Le service football est inaccessible ou a mis trop de temps à répondre. Réessayez plus tard.",
        "NETWORK",
      );
    }
    if (!response.ok) {
      let details = null;
      try {
        details = await response.json();
      } catch {
        /* Preserve the HTTP diagnosis. */
      }
      if (
        details?.code === "SEASON_ACCESS" &&
        Array.isArray(details.availableSeasons) &&
        details.availableSeasons.every(Number.isInteger)
      ) {
        throw new FootballError(
          `Votre offre API-Football permet les saisons ${details.availableSeasons.join(", ")}. Choisissez l’une de ces saisons.`,
          "SEASON_ACCESS",
        );
      }
      throw new FootballError(
        response.status === 429
          ? "Limite du fournisseur atteinte. Réessayez plus tard."
          : "Le service football ne peut pas fournir ces données.",
        String(response.status),
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new FootballError(
        "Réponse du fournisseur illisible.",
        "INVALID_DATA",
      );
    }
    if (
      typeof payload?.source?.name !== "string" ||
      !payload.source.name ||
      !Number.isFinite(Date.parse(payload.fetchedAt)) ||
      (list && !Array.isArray(payload.data))
    )
      throw new FootballError(
        "Source ou date des données manquante.",
        "INVALID_DATA",
      );
    return {
      data: list ? payload.data.map(normalize) : normalize(payload.data),
      source: { name: payload.source.name, url: safeImage(payload.source.url) },
      fetchedAt: payload.fetchedAt,
      mode: "real",
    };
  }
  return {
    mode: "real",
    competitions: () => request("competitions", {}, normalizeCompetition),
    teams: (params) => request("teams", params, normalizeTeam),
    team: (id) =>
      request(`teams/${encodeURIComponent(id)}`, {}, normalizeTeam, false),
    matches: (params) => request("matches", params, normalizeMatch),
    standings: (params) =>
      request(
        "standings",
        typeof params === "string" ? { competition: params } : params,
        normalizeStanding,
      ),
    recentMatches: (id) =>
      request(
        `teams/${encodeURIComponent(id)}/matches`,
        { status: "finished", limit: 5 },
        normalizeRecent,
      ),
    statistics: (id) =>
      request(
        `teams/${encodeURIComponent(id)}/statistics`,
        {},
        normalizeStats,
        false,
      ),
  };
}
const demoTeams = teams.map((t, i) => ({
  ...t,
  competitionId: i < 3 ? "horizon" : "coupe",
  competitionName: i < 3 ? "Ligue Horizon" : "Coupe des Clubs",
  source: "demo",
}));
const wrapDemo = (data) =>
  Promise.resolve({
    data,
    mode: "demo",
    source: { name: "Exemples fictifs CALCITO" },
    fetchedAt: null,
  });
export const demoAdapter = {
  mode: "demo",
  competitions: () => wrapDemo(demoCompetitions),
  teams: ({ search = "", competition = "" } = {}) =>
    wrapDemo(
      demoTeams.filter(
        (team) =>
          (!competition || team.competitionId === competition) &&
          team.name
            .toLocaleLowerCase("fr")
            .includes(search.toLocaleLowerCase("fr")),
      ),
    ),
  team: (id) => {
    const team = demoTeams.find((t) => t.id === id);
    return team
      ? wrapDemo(team)
      : Promise.reject(
          new FootballError("Cette équipe est introuvable.", "NOT_FOUND"),
        );
  },
  matches: ({ competition = "", view = "upcoming" } = {}) =>
    wrapDemo(
      matches
        .filter((match) => view !== "results")
        .filter(
          (match) =>
            !competition ||
            (match.competition === "Ligue Horizon" ? "horizon" : "coupe") ===
              competition,
        )
        .map((match) => ({
          ...match,
          source: "demo",
          status: "scheduled",
          kickoff: null,
          goalsHome: null,
          goalsAway: null,
        })),
    ),
  standings: () =>
    Promise.reject(
      new FootballError(
        "Aucun classement officiel en mode démonstration. Les indices fictifs de forme ne sont pas des points de championnat.",
      ),
    ),
  recentMatches: () => wrapDemo([]),
  statistics: () => wrapDemo(null),
};
export function createFootballService(
  adapter,
  { ttl = 60000, now = Date.now } = {},
) {
  const cache = new Map();
  const pending = new Map();
  let generation = 0;
  return {
    mode: adapter.mode,
    clearCache() {
      generation++;
      cache.clear();
      pending.clear();
    },
    async get(method, params) {
      if (typeof adapter[method] !== "function")
        throw new FootballError(
          "Fonction indisponible chez ce fournisseur.",
          "UNSUPPORTED",
        );
      const key = JSON.stringify([method, params]);
      const cached = cache.get(key);
      if (cached && now() - cached.time < ttl) return cached.value;
      if (pending.has(key)) return pending.get(key);
      const requestGeneration = generation;
      const task = Promise.resolve()
        .then(() => adapter[method](params))
        .then((value) => {
          if (requestGeneration === generation)
            cache.set(key, { time: now(), value });
          if (cache.size > 500) cache.delete(cache.keys().next().value);
          return value;
        })
        .finally(() => {
          if (pending.get(key) === task) pending.delete(key);
        });
      pending.set(key, task);
      return task;
    },
  };
}
export const footballService = createFootballService(manualAdapter);
