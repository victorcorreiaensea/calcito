import { parseCSV } from "./csv.js";
import { normalizeClub } from "./simplified.js";
import { nullableNumber, validateMatch } from "./match.js";
import { parseImportDate, isFlashscoreSource } from "./matchImport.js";
export const europeanCompetitions = [
  { slug: "champions-league", name: "UEFA Champions League" },
  { slug: "europa-league", name: "UEFA Europa League" },
];
export const europeHeaders = [
  "competition",
  "season",
  "stage",
  "round",
  "date",
  "timezone",
  "home_team",
  "away_team",
  "home_goals",
  "away_goals",
  "status",
  "source_url",
  "home_country",
  "away_country",
  "home_domestic_league",
  "away_domestic_league",
  "home_identity_source_url",
  "away_identity_source_url",
  "home_external_provider",
  "away_external_provider",
  "home_external_id",
  "away_external_id",
  "home_logo_url",
  "away_logo_url",
  "home_logo_source_url",
  "away_logo_source_url",
  "comment",
];
const https = (v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};
const slugify = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const europeanRound = (value) =>
  /^(?:journ[eé]e\s*|j\s*)?([12])$/i.exec(String(value).trim())?.[1] || null;
export function readEuropeanCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length)
    throw new Error(
      "Le modèle est vide. Renseignez des rencontres vérifiées avant import.",
    );
  if (rows.length > 72)
    throw new Error("Maximum 72 rencontres par préparation.");
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, String(v ?? "").trim()]),
    ),
  );
}
export function planEuropeanPreparation(
  rows,
  dataset,
  { choices = {}, aliases = {}, flashscoreConsent = false } = {},
) {
  const clubs = new Map(),
    errors = [];
  const pairs = new Set();
  const planned = rows.map((row, index) => {
    const issues = [];
    const comp = europeanCompetitions.find(
      (c) => c.slug === row.competition || c.name === row.competition,
    );
    const round = europeanRound(row.round);
    if (!comp)
      issues.push(
        "Compétition : champions-league ou europa-league uniquement.",
      );
    if (row.season !== "2026-2027")
      issues.push("La saison doit être 2026-2027.");
    if (row.stage !== "league-phase")
      issues.push(
        "Phase de ligue requise (league-phase), pas les qualifications.",
      );
    if (!round) issues.push("Journée 1 ou 2 requise.");
    let kickoff = {};
    try {
      kickoff = parseImportDate(row.date, row.timezone || "Europe/Paris");
    } catch (e) {
      issues.push(e.message);
    }
    if (kickoff.error || kickoff.dateOnly)
      issues.push(
        "Date et heure précises requises ; aucune heure ne sera inventée.",
      );
    if (
      kickoff.iso &&
      (kickoff.iso < "2026-07-01" || kickoff.iso >= "2027-07-01")
    )
      issues.push("La date sort de la saison 2026-2027.");
    if (!https(row.source_url))
      issues.push("Source HTTPS de la rencontre requise.");
    if (isFlashscoreSource(row.source_url) && !flashscoreConsent)
      issues.push(
        "Confirmez que vous disposez des droits nécessaires pour ce relevé Flashscore.",
      );
    const sides = {};
    for (const side of ["home", "away"]) {
      const name = row[side + "_team"],
        key = normalizeClub(name);
      if (!key) {
        issues.push("Nom d’équipe manquant.");
        continue;
      }
      const target = choices[key];
      const candidates = dataset.teams.filter((t) =>
        target
          ? t.id === target
          : [key, normalizeClub(aliases[name])].includes(normalizeClub(t.name)),
      );
      if (candidates.length > 1)
        issues.push(
          `Plusieurs fiches pour ${name} : choisissez l’identifiant.`,
        );
      const existing = candidates.length === 1 ? candidates[0] : null;
      if (target && !existing)
        issues.push(`La fiche associée à ${name} n’existe plus.`);
      const club = {
        key,
        name,
        country: row[side + "_country"] || existing?.country || "",
        existing_id: existing?.id || null,
        slug: slugify(name),
        short: name.slice(0, 8),
        domestic_league: row[side + "_domestic_league"] || null,
        identity_source_url: row[side + "_identity_source_url"] || null,
        external_provider: row[side + "_external_provider"] || null,
        external_id: row[side + "_external_id"] || null,
        logo_url: row[side + "_logo_url"] || null,
        logo_source_url: row[side + "_logo_source_url"] || null,
      };
      if (!existing && (!club.country || !https(club.identity_source_url)))
        issues.push(
          `${name} : pays et source d’identité HTTPS requis pour créer une fiche.`,
        );
      if (
        club.logo_url &&
        (!https(club.logo_url) || !https(club.logo_source_url))
      )
        issues.push(`${name} : logo et source du logo HTTPS requis.`);
      if (
        club.logo_url?.includes("media.api-sports.io") &&
        (!club.external_provider ||
          !club.external_id ||
          !club.identity_source_url)
      )
        issues.push(
          `${name} : vérifiez l’identifiant API-Football avant d’associer cet écusson.`,
        );
      const previous = clubs.get(key);
      if (
        previous &&
        [
          "existing_id",
          "country",
          "external_provider",
          "external_id",
          "logo_url",
          "domestic_league",
          "identity_source_url",
          "logo_source_url",
        ].some((k) => previous[k] !== club[k])
      )
        issues.push(`Métadonnées contradictoires pour ${name}.`);
      clubs.set(key, club);
      sides[side] = club;
    }
    if (
      sides.home &&
      sides.away &&
      (sides.home.key === sides.away.key ||
        (sides.home.existing_id &&
          sides.home.existing_id === sides.away.existing_id))
    )
      issues.push("Les deux équipes doivent être différentes.");
    const key = [
      comp?.slug,
      sides.home?.existing_id || sides.home?.key,
      sides.away?.existing_id || sides.away?.key,
    ].join(":");
    if (pairs.has(key)) issues.push("Rencontre répétée dans le fichier.");
    pairs.add(key);
    const season = dataset.seasons.find(
      (s) =>
        s.start_year === 2026 &&
        dataset.competitions.find((c) => c.id === s.competition_id)?.slug ===
          comp?.slug,
    );
    const found = dataset.matches.filter(
      (m) =>
        season?.id === m.season_id &&
        m.home_team_id === sides.home?.existing_id &&
        m.away_team_id === sides.away?.existing_id,
    );
    if (found.length > 1)
      issues.push(
        "Plusieurs rencontres existantes : résolution manuelle nécessaire.",
      );
    const status = row.status || "finished";
    if (!["finished", "scheduled", "postponed", "cancelled"].includes(status))
      issues.push("Statut invalide.");
    const gh = nullableNumber(row.home_goals),
      ga = nullableNumber(row.away_goals);
    for (const n of [gh, ga])
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 32767))
        issues.push("Score invalide.");
    if ((gh === null) !== (ga === null))
      issues.push("Renseignez les deux scores, ou laissez les deux inconnus.");
    if (status !== "finished" && (gh !== null || ga !== null))
      issues.push("Un score final exige le statut terminé.");
    if (
      status === "finished" &&
      kickoff.iso &&
      Date.parse(kickoff.iso) > Date.now() &&
      gh !== null
    )
      issues.push("Résultat terminé daté dans le futur.");
    return {
      index,
      raw: row,
      errors: issues,
      existing: found[0] || null,
      action: found.length ? "existing" : "draft",
      payload: {
        season: row.season,
        stage: row.stage,
        competition: comp?.slug,
        round: Number(round),
        kickoff: kickoff.iso,
        home_key: sides.home?.key,
        away_key: sides.away?.key,
        goals_home: gh,
        goals_away: ga,
        status,
        source: row.source_url,
        comment: row.comment || null,
      },
      verifiedScore: gh !== null && ga !== null,
    };
  });
  const linked = [...clubs.values()]
    .filter((c) => c.existing_id)
    .map((c) => c.existing_id);
  if (new Set(linked).size !== linked.length)
    errors.push(
      "Plusieurs noms du relevé désignent la même fiche : harmonisez ces noms avant import.",
    );
  for (const comp of europeanCompetitions)
    for (const round of [1, 2]) {
      const selected = planned.filter(
        (p) => p.payload.competition === comp.slug && p.payload.round === round,
      );
      if (selected.length > 18)
        errors.push(`${comp.name} J${round} : plus de 18 rencontres.`);
      const teams = selected.flatMap((p) => [
        p.payload.home_key,
        p.payload.away_key,
      ]);
      if (new Set(teams).size !== teams.length)
        errors.push(`${comp.name} J${round} : une équipe joue plusieurs fois.`);
    }
  for (const comp of europeanCompetitions) {
    const own = planned.filter((p) => p.payload.competition === comp.slug);
    const keys = new Set(
      own.flatMap((p) => [p.payload.home_key, p.payload.away_key]),
    );
    if (keys.size > 36)
      errors.push(`${comp.name} : plus de 36 participants dans le relevé.`);
    if (
      planned.some(
        (p) =>
          p.payload.competition !== comp.slug &&
          [p.payload.home_key, p.payload.away_key].some((k) => keys.has(k)),
      )
    )
      errors.push(
        "Un même club figure dans les deux phases de ligue : vérifiez la compétition.",
      );
  }
  return {
    rows: planned,
    clubs: [...clubs.values()],
    errors,
    summary: {
      found: planned.length,
      verified: planned.filter((p) => !p.errors.length && p.verifiedScore)
        .length,
      existing: planned.filter((p) => p.existing).length,
      drafts: planned.filter((p) => !p.existing && !p.errors.length).length,
      knownClubs: [...clubs.values()].filter((c) => c.existing_id).length,
      newClubs: [...clubs.values()].filter((c) => !c.existing_id).length,
      logos: [...clubs.values()].filter(
        (c) => !c.existing_id && c.logo_url && https(c.logo_source_url),
      ).length,
    },
  };
}
export function europeanMatchForm(match, dataset) {
  return {
    ...match,
    home_stats:
      dataset.stats.find(
        (s) => s.match_id === match.id && s.team_id === match.home_team_id,
      ) || {},
    away_stats:
      dataset.stats.find(
        (s) => s.match_id === match.id && s.team_id === match.away_team_id,
      ) || {},
  };
}
export function publicationErrors(form, dataset) {
  const errors = Object.values(
    validateMatch({ ...form, verified_at: new Date().toISOString() }, true),
  );
  if (form.status !== "finished")
    errors.push("La publication de cette préparation exige un résultat final.");
  if (Date.parse(form.kickoff) > Date.now())
    errors.push("Résultat futur interdit.");
  if (
    dataset.matches.some(
      (m) =>
        m.id !== form.id &&
        m.season_id === form.season_id &&
        m.home_team_id === form.home_team_id &&
        m.away_team_id === form.away_team_id,
    )
  )
    errors.push("Doublon de rencontre.");
  const season = dataset.seasons.find((s) => s.id === form.season_id);
  if (
    !season?.is_published ||
    !dataset.competitions.find((c) => c.id === season.competition_id)
      ?.is_published ||
    [form.home_team_id, form.away_team_id].some(
      (id) => !dataset.teams.find((t) => t.id === id)?.is_published,
    )
  )
    errors.push(
      "Compétition, saison et fiches clubs doivent être publiques avant validation.",
    );
  return errors;
}
