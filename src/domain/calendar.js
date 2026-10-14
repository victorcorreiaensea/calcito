import { parseImportDate } from "./matchImport.js";

export const calendarLeagues = [
  { code: "fr", slug: "ligue-1", name: "Ligue 1", timezone: "Europe/Paris" },
  {
    code: "en",
    slug: "premier-league",
    name: "Premier League",
    timezone: "Europe/London",
  },
  { code: "es", slug: "laliga", name: "LaLiga", timezone: "Europe/Madrid" },
  { code: "it", slug: "serie-a", name: "Serie A", timezone: "Europe/Rome" },
  {
    code: "de",
    slug: "bundesliga",
    name: "Bundesliga",
    timezone: "Europe/Berlin",
  },
  {
    code: "pt",
    slug: "liga-portugal",
    name: "Liga Portugal",
    timezone: "Europe/Lisbon",
  },
];
export function localDate(iso, timezone = "Europe/Paris") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function planCalendar(bundle, dataset, now = new Date()) {
  const rows = [],
    issues = [],
    coverage = [];
  const unique = new Set();
  for (const league of calendarLeagues) {
    const feed = bundle.feeds.find((f) => f.code === league.code);
    const competition = dataset.competitions.find(
      (c) => c.slug === league.slug && c.type === "league",
    );
    const season = dataset.seasons.find(
      (s) => s.competition_id === competition?.id && s.start_year === 2026,
    );
    const clubs = dataset.members
      .filter((m) => m.season_id === season?.id)
      .map((m) => dataset.teams.find((t) => t.id === m.team_id))
      .filter(Boolean);
    if (
      !feed ||
      !season ||
      !season.is_published ||
      !competition?.is_published
    ) {
      issues.push({
        league: league.name,
        reason: !feed ? "Source inaccessible." : "Saison 2026–2027 absente.",
      });
      continue;
    }
    if (!Array.isArray(feed.matches) || feed.matches.length > 500) {
      issues.push({
        league: league.name,
        reason: "Format de calendrier invalide.",
      });
      continue;
    }
    const lookup = (name) => {
      const map = bundle.clubs.find(
        (c) => c.league === league.slug && c.sourceName === name,
      );
      const found = clubs.filter((t) => t.name === (map?.name || name));
      return found.length === 1 ? found[0] : null;
    };
    const parsed = feed.matches.map((m) => {
      let kickoff = null,
        error = "";
      try {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(m.date) ||
          !/^\d{2}:\d{2}$/.test(m.time || "")
        )
          throw new Error("Horaire non confirmé dans la source.");
        kickoff = parseImportDate(`${m.date}T${m.time}`, league.timezone).iso;
      } catch (e) {
        error = e.message;
      }
      const h = lookup(m.team1),
        a = lookup(m.team2),
        external_key = `${league.code}:2026:${m.round}:${m.team1}:${m.team2}`;
      if (!h || !a)
        error =
          "Club non reconnu ou non participant : " + (!h ? m.team1 : m.team2);
      if (h && a && (!h.is_published || !a.is_published))
        error = "Publier les deux fiches de clubs avant de synchroniser.";
      if (m.score && m.date >= localDate(now, league.timezone))
        error =
          "Score contradictoire pour une rencontre future : vérifier la source.";
      if (
        m.date < "2026-07-01" ||
        m.date > "2027-06-30" ||
        !m.round ||
        h?.id === a?.id
      )
        error = "Saison, journée ou participants invalides.";
      return { m, h, a, kickoff, error, external_key };
    });
    const byIdentity = new Map();
    for (const r of parsed) {
      const prior = byIdentity.get(r.external_key);
      if (
        prior &&
        (prior.m.date !== r.m.date ||
          prior.m.time !== r.m.time ||
          prior.m.status !== r.m.status)
      ) {
        prior.error =
          "Calendrier contradictoire : même rencontre avec plusieurs horaires ou statuts.";
      } else if (!prior) byIdentity.set(r.external_key, r);
    }
    for (const club of clubs) {
      const candidates = [...byIdentity.values()]
        .filter(
          (r) =>
            (r.h?.id === club.id || r.a?.id === club.id) &&
            r.m.status !== "cancelled" &&
            (r.kickoff
              ? Date.parse(r.kickoff) > now.getTime()
              : r.m.date >= localDate(now, league.timezone)),
        )
        .sort((a, b) =>
          (a.kickoff || a.m.date + "T00:00:00Z").localeCompare(
            b.kickoff || b.m.date + "T00:00:00Z",
          ),
        )
        .slice(0, 2);
      coverage.push({
        league: league.name,
        club: club.name,
        found: candidates.filter((r) => !r.error && r.m.status !== "postponed")
          .length,
      });
      for (const r of candidates) {
        if (unique.has(r.external_key)) continue;
        unique.add(r.external_key);
        if (r.error) {
          issues.push({
            league: league.name,
            home: r.m.team1,
            away: r.m.team2,
            date: r.m.date,
            reason: r.error,
          });
          continue;
        }
        const old = dataset.matches.filter(
          (m) =>
            m.season_id === season.id &&
            m.home_team_id === r.h.id &&
            m.away_team_id === r.a.id,
        );
        if (old.length > 1) {
          issues.push({
            league: league.name,
            reason: `Plusieurs rencontres existantes : ${r.h.name} — ${r.a.name}.`,
          });
          continue;
        }
        if (old[0] && ["finished", "live"].includes(old[0].status)) {
          issues.push({
            league: league.name,
            reason: `Résultat/en cours conservé : ${r.h.name} — ${r.a.name}.`,
          });
          continue;
        }
        if (!old[0] && r.m.status === "postponed") {
          issues.push({
            league: league.name,
            reason: `Rencontre reportée : ${r.h.name} — ${r.a.name}.`,
          });
          continue;
        }
        rows.push({
          external_key: r.external_key,
          season_id: season.id,
          home_team_id: r.h.id,
          away_team_id: r.a.id,
          home: r.h.name,
          away: r.a.name,
          league: league.name,
          round: r.m.round,
          kickoff: r.kickoff,
          timezone: league.timezone,
          status: r.m.status === "postponed" ? "postponed" : "scheduled",
          source: feed.source,
          existing_id: old[0]?.id || null,
          expected_updated_at: old[0]?.updated_at || null,
          action: old[0]
            ? old[0].kickoff === r.kickoff &&
              old[0].status === (r.m.status || "scheduled") &&
              old[0].is_published
              ? "unchanged"
              : "update"
            : "insert",
        });
      }
    }
    // Never infer a cancellation from disappearance. Only explicit source statuses update known fixtures.
    for (const r of parsed.filter((r) =>
      ["cancelled", "postponed"].includes(r.m.status),
    )) {
      if (!r.h || !r.a || rows.some((x) => x.external_key === r.external_key))
        continue;
      const old = dataset.matches.filter(
        (m) =>
          m.season_id === season.id &&
          m.home_team_id === r.h.id &&
          m.away_team_id === r.a.id &&
          m.status !== "finished" &&
          m.status !== "live",
      );
      if (old.length !== 1) continue;
      rows.push({
        external_key: r.external_key,
        season_id: season.id,
        home_team_id: r.h.id,
        away_team_id: r.a.id,
        home: r.h.name,
        away: r.a.name,
        league: league.name,
        round: r.m.round,
        kickoff: old[0].kickoff,
        timezone: league.timezone,
        status: r.m.status,
        source: feed.source,
        existing_id: old[0].id,
        expected_updated_at: old[0].updated_at,
        action: "update",
      });
    }
  }
  return {
    rows,
    issues,
    coverage,
    fetchedAt: bundle.fetchedAt,
    sourceCommit: bundle.sourceCommit,
  };
}
