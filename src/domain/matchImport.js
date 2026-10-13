import { parseCSV } from "./csv.js";
import {
  matchPayload,
  nullableNumber,
  statFields,
  validateMatch,
} from "./match.js";
import { normalizeClub } from "./simplified.js";
export const matchImportHeaders = [
  "date",
  "competition",
  "season",
  "home_team",
  "away_team",
  "home_goals",
  "away_goals",
  "home_shots",
  "away_shots",
  "home_shots_on_target",
  "away_shots_on_target",
  "home_big_chances",
  "away_big_chances",
  "home_rating",
  "away_rating",
  "source_url",
];
export const DATE_ONLY_MARKER = "Heure non renseignée (date seule).";
const core = [
  "date",
  "competition",
  "season",
  "home_team",
  "away_team",
  "home_goals",
  "away_goals",
];
const clean = (v) => String(v ?? "").trim();
export function canonicalImportRow(raw) {
  const row = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, clean(v)]),
  );
  for (const [target, legacy] of [
    ["date", "kickoff"],
    ["home_team", "home"],
    ["away_team", "away"],
    ["home_goals", "goals_home"],
    ["away_goals", "goals_away"],
    ["home_rating", "home_team_rating"],
    ["away_rating", "away_team_rating"],
    ["source_url", "source"],
  ])
    if (row[target] === undefined) row[target] = row[legacy] ?? "";
  return row;
}
export function readMatchCSV(text) {
  const records = parseCSV(text);
  if (!records.length)
    throw new Error(
      "Le fichier ne contient aucun match. Le modèle vide doit être rempli avant import.",
    );
  if (records.length > 500)
    throw new Error("Import limité à 500 matchs par fichier.");
  const rows = records.map(canonicalImportRow);
  const missing = core.filter(
    (k) =>
      !(k in records[0]) &&
      !(
        {
          date: "kickoff",
          home_team: "home",
          away_team: "away",
          home_goals: "goals_home",
          away_goals: "goals_away",
        }[k] in records[0]
      ),
  );
  if (missing.length)
    throw new Error(`Colonnes requises manquantes : ${missing.join(", ")}.`);
  return rows;
}
export function safeSourceURL(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
function partsAt(time, zone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(time))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
}
const utcParts = (p) =>
  Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour || 0,
    p.minute || 0,
    p.second || 0,
  );
export function parseImportDate(value, zone = "Europe/Paris") {
  let text = clean(value),
    match;
  if ((match = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(text)))
    text = `${match[3]}-${match[2]}-${match[1]}${match[4]}`;
  match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      text,
    );
  if (!match)
    throw new Error(
      "Date attendue : AAAA-MM-JJ, JJ/MM/AAAA, ou date et heure avec fuseau.",
    );
  const [, y, m, d, h, min, sec, suffix] = match;
  const parts = {
    year: Number(y),
    month: Number(m),
    day: Number(d),
    hour: h == null ? 12 : Number(h),
    minute: Number(min || 0),
    second: Number(sec || 0),
  };
  const target = utcParts(parts),
    check = new Date(target);
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    throw new Error("Date ou heure impossible.");
  if (parts.year < 1900 || parts.year > 2200)
    throw new Error("Année hors des limites autorisées.");
  if (h == null)
    return { iso: check.toISOString(), dateOnly: true, day: `${y}-${m}-${d}` };
  if (suffix) {
    if (
      suffix !== "Z" &&
      (Number(suffix.slice(1, 3)) > 14 ||
        Number(suffix.slice(4)) > 59 ||
        (Number(suffix.slice(1, 3)) === 14 && Number(suffix.slice(4)) !== 0))
    )
      throw new Error("Fuseau horaire invalide.");
    const time = Date.parse(
      `${y}-${m}-${d}T${h}:${min}:${sec || "00"}${suffix}`,
    );
    if (!Number.isFinite(time)) throw new Error("Date et fuseau invalides.");
    return {
      iso: new Date(time).toISOString(),
      dateOnly: false,
      day: `${y}-${m}-${d}`,
    };
  }
  // Find all offsets around the selected day; reject DST gaps and ambiguous repeated hours.
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map((hours) => {
      const time = target + hours * 3600000;
      return utcParts(partsAt(time, zone)) - time;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .filter((time) => {
      const p = partsAt(time, zone);
      return ["year", "month", "day", "hour", "minute", "second"].every(
        (k) => p[k] === parts[k],
      );
    });
  if (candidates.length !== 1)
    throw new Error(
      "Heure ambiguë ou inexistante au changement d’heure : ajoutez Z ou un décalage explicite (+01:00).",
    );
  return {
    iso: new Date(candidates[0]).toISOString(),
    dateOnly: false,
    day: `${y}-${m}-${d}`,
  };
}
function mappedRecord(raw, records, mapping) {
  const chosen = mapping?.[raw];
  if (chosen) return records.find((r) => r.id === chosen) || null;
  const name = normalizeClub(raw);
  if (!name) return null;
  const exact = records.filter(
    (r) =>
      r.id === raw ||
      normalizeClub(r.slug) === name ||
      normalizeClub(r.name) === name,
  );
  return exact.length === 1 ? exact[0] : null;
}
function matchSeason(raw, competition, d) {
  const key = clean(raw).replace(/[–—/]/g, "-").replace(/\s/g, "");
  const found = d.seasons.filter(
    (s) =>
      s.competition_id === competition?.id &&
      (s.id === raw ||
        String(s.start_year) === key ||
        `${s.start_year}-${s.end_year}` === key ||
        clean(s.label).replace(/[–—/]/g, "-").replace(/\s/g, "") === key),
  );
  return found.length === 1 ? found[0] : null;
}
export function importMappings(rows, d, mapping = {}) {
  return {
    teams: [...new Set(rows.flatMap((r) => [r.home_team, r.away_team]))].filter(
      (name) => name && !mappedRecord(name, d.teams, mapping.teams),
    ),
    competitions: [...new Set(rows.map((r) => r.competition))].filter(
      (name) =>
        name && !mappedRecord(name, d.competitions, mapping.competitions),
    ),
  };
}
function quickDuplicate(d, home, away, day) {
  return (d.simplified || []).find(
    (r) =>
      !r.converted_at &&
      r.kickoff.slice(0, 10) === day &&
      ((r.team_id === home?.id &&
        (r.opponent_team_id === away?.id ||
          normalizeClub(r.opponent_name) === normalizeClub(away?.name))) ||
        (r.team_id === away?.id &&
          (r.opponent_team_id === home?.id ||
            normalizeClub(r.opponent_name) === normalizeClub(home?.name)))),
  );
}
export function planMatchImport(
  rows,
  d,
  {
    mapping = {},
    duplicates = "ignore",
    published = false,
    verified = false,
    timeZone = "Europe/Paris",
    now = new Date(),
  } = {},
) {
  const seen = new Map();
  return rows.map((original, index) => {
    const row = canonicalImportRow(original),
      errors = [],
      warnings = [];
    const home = mappedRecord(row.home_team, d.teams, mapping.teams),
      away = mappedRecord(row.away_team, d.teams, mapping.teams),
      competition = mappedRecord(
        row.competition,
        d.competitions,
        mapping.competitions,
      ),
      season = matchSeason(row.season, competition, d);
    let date = null;
    try {
      date = parseImportDate(row.date, timeZone);
    } catch (e) {
      errors.push(e.message);
    }
    if (!home)
      errors.push("Équipe domicile non reconnue : associez-la à une fiche.");
    if (!away)
      errors.push("Équipe extérieure non reconnue : associez-la à une fiche.");
    if (!competition) errors.push("Compétition non reconnue.");
    if (!season) errors.push("Saison non reconnue pour cette compétition.");
    if (
      date &&
      (date.dateOnly
        ? date.day > now.toISOString().slice(0, 10)
        : Date.parse(date.iso) > now.getTime())
    )
      errors.push("Un résultat terminé ne peut pas être daté dans le futur.");
    if (date && season) {
      const year = Number(date.iso.slice(0, 4));
      if (year < season.start_year || year > season.end_year)
        errors.push("La date ne correspond pas à la saison.");
    }
    if (
      season &&
      [home, away].some(
        (t) =>
          t &&
          !d.members.some(
            (m) => m.season_id === season.id && m.team_id === t.id,
          ),
      )
    )
      errors.push("Équipe absente des participants de cette saison.");
    if (!safeSourceURL(row.source_url))
      errors.push("La source doit être une URL HTTPS sans identifiants.");
    const day = date?.iso.slice(0, 10);
    const exact = d.matches.find(
      (m) =>
        m.season_id === season?.id &&
        m.home_team_id === home?.id &&
        m.away_team_id === away?.id &&
        m.kickoff.slice(0, 10) === day,
    );
    const cross = d.matches.find(
      (m) =>
        m.season_id !== season?.id &&
        m.home_team_id === home?.id &&
        m.away_team_id === away?.id &&
        m.kickoff.slice(0, 10) === day,
    );
    const quick = quickDuplicate(d, home, away, day);
    const existing = exact || cross || quick;
    const signature =
      season && home && away && day
        ? [season.id, home.id, away.id, day].join("|")
        : null;
    const inFile = signature ? seen.get(signature) : null;

    let action =
      inFile || (existing && duplicates === "ignore")
        ? "ignore"
        : existing
          ? "update"
          : "insert";
    if (action === "update" && (cross || quick)) {
      errors.push(
        quick
          ? "Un résultat rapide existe : convertissez-le en match complet avant cet import."
          : "Un match existe dans une autre saison ou compétition : corrigez la correspondance.",
      );
    }
    const publish =
      action === "update" && exact ? exact.is_published : published;
    const source = row.source_url || exact?.source || "";
    const verifiedAt = verified
      ? now.toISOString()
      : row.verified_at || exact?.verified_at || null;
    if (publish && !verified)
      errors.push(
        "Confirmez la vérification des sources et résultats avant publication ou mise à jour publique.",
      );
    const comment = row.comment || exact?.comment || "";
    const preserveKnownTime =
      date?.dateOnly &&
      exact &&
      !(exact.comment || "").includes(DATE_ONLY_MARKER);
    if (preserveKnownTime && Date.parse(exact.kickoff) > now.getTime())
      errors.push("Un résultat terminé ne peut pas être daté dans le futur.");
    const payload = {
      season_id: season?.id || "",
      round: row.round || exact?.round || "Non renseignée",
      kickoff: preserveKnownTime ? exact.kickoff : date?.iso || "",
      home_team_id: home?.id || "",
      away_team_id: away?.id || "",
      status: "finished",
      goals_home: row.home_goals,
      goals_away: row.away_goals,
      source,
      verified_at: verifiedAt,
      comment:
        date?.dateOnly && !preserveKnownTime
          ? [comment.replace(DATE_ONLY_MARKER, "").trim(), DATE_ONLY_MARKER]
              .filter(Boolean)
              .join(" ")
          : comment.replace(DATE_ONLY_MARKER, "").trim(),
      is_published: publish,
      home_stats: {},
      away_stats: {},
    };
    for (const side of ["home", "away"]) {
      const old = exact
        ? d.stats.find(
            (s) =>
              s.match_id === exact.id && s.team_id === exact[`${side}_team_id`],
          )
        : null;
      for (const [field] of statFields) {
        const alias = field === "team_rating" ? "rating" : field;
        const raw = row[`${side}_${alias}`];
        payload[`${side}_stats`][field] =
          clean(raw) === "" ? (old?.[field] ?? null) : nullableNumber(raw);
      }
      payload[`${side}_stats`].bonuses = old?.bonuses ?? null;
    }
    for (const field of [
      "halftime_home",
      "halftime_away",
      "extra_home",
      "extra_away",
      "penalties_home",
      "penalties_away",
    ])
      payload[field] =
        row[field] === "" || row[field] == null
          ? (exact?.[field] ?? null)
          : nullableNumber(row[field]);
    if (action === "update" && exact) {
      payload.id = exact.id;
      payload.expected_updated_at = exact.updated_at;
    }
    const validation = validateMatch(payload, publish);
    errors.push(
      ...Object.entries(validation).map(
        ([field, message]) => `${field} : ${message}`,
      ),
    );
    for (const field of ["goals_home", "goals_away"])
      if (nullableNumber(payload[field]) === null)
        errors.push("Les deux scores finaux sont requis.");
    if (date?.dateOnly)
      warnings.push(
        preserveKnownTime
          ? "Date seule : heure déjà connue conservée."
          : "Date seule : heure non renseignée.",
      );
    if (
      !competition?.is_published ||
      !season?.is_published ||
      !home?.is_published ||
      !away?.is_published
    ) {
      if (publish && action !== "ignore")
        errors.push(
          "Publiez d’abord la compétition, la saison et les deux équipes pour importer un match public.",
        );
      else
        warnings.push(
          "Une fiche ou la saison est privée : le match ne sera pas visible publiquement.",
        );
    }
    if (exact && action === "update")
      warnings.push(
        "Les champs statistiques vides conservent les valeurs déjà connues. Le statut de publication existant est conservé.",
      );
    if (cross || quick) warnings.push("Doublon entre modes ou compétitions.");
    if (signature && !seen.has(signature) && errors.length === 0)
      seen.set(signature, index + 2);
    const available = [
      "shots",
      "shots_on_target",
      "big_chances",
      "team_rating",
    ].reduce(
      (sum, k) =>
        sum +
        ["home", "away"].filter((side) => payload[`${side}_stats`][k] != null)
          .length,
      0,
    );
    const normalizedPayload = matchPayload(payload, publish);
    for (const side of ["home", "away"])
      if (payload[`${side}_stats`].bonuses != null)
        normalizedPayload[`${side}_stats`].bonuses =
          payload[`${side}_stats`].bonuses;
    return {
      line: index + 2,
      row,
      home,
      away,
      competition,
      season,
      date,
      existing,
      inFile,
      action,
      errors: [...new Set(errors)],
      warnings,
      available,
      totalStats: 8,
      payload: normalizedPayload,
    };
  });
}
export async function executeMatchImport(
  plan,
  { save, duplicates = "ignore", onProgress = () => {} },
) {
  const report = {
    imported: 0,
    updated: 0,
    ignored: 0,
    rejected: 0,
    uncertain: 0,
    unprocessed: 0,
    rows: [],
  };
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    let outcome,
      attemptedId = null;
    if (item.errors.length) {
      report.rejected++;
      outcome = {
        line: item.line,
        status: "rejected",
        message: item.errors.join(" "),
      };
    } else if (item.action === "ignore") {
      report.ignored++;
      outcome = {
        line: item.line,
        status: "ignored",
        message: item.inFile
          ? `Doublon du fichier, ligne ${item.inFile}.`
          : "Doublon déjà enregistré.",
      };
    } else
      try {
        const payload = {
          ...item.payload,
          id: item.payload.id || globalThis.crypto.randomUUID(),
        };
        attemptedId = payload.id;
        const id = await save(payload);
        if (id !== payload.id)
          throw new Error(
            "Le serveur n’a pas confirmé l’identifiant du match.",
          );
        if (item.action === "update") report.updated++;
        else report.imported++;
        outcome = {
          line: item.line,
          status: item.action === "update" ? "updated" : "imported",
          id,
          message:
            item.action === "update"
              ? "Match mis à jour."
              : "Match enregistré.",
        };
      } catch (e) {
        if (e.code === "23505" && duplicates === "ignore") {
          report.ignored++;
          outcome = {
            line: item.line,
            status: "ignored",
            message: "Doublon détecté au moment de la sauvegarde.",
          };
        } else if (
          [
            "23505",
            "23503",
            "23514",
            "23502",
            "22P02",
            "22003",
            "P0001",
            "40001",
          ].includes(e.code)
        ) {
          report.rejected++;
          outcome = { line: item.line, status: "rejected", message: e.message };
        } else if (["42501", "PGRST301"].includes(e.code)) {
          report.rejected++;
          report.unprocessed = plan.length - i - 1;
          outcome = {
            line: item.line,
            status: "rejected",
            message: "Import arrêté : " + e.message,
          };
          report.rows.push(outcome);
          onProgress({ ...report, rows: [...report.rows] });
          break;
        } else {
          report.uncertain++;
          report.unprocessed = plan.length - i - 1;
          outcome = {
            line: item.line,
            status: "uncertain",
            id: attemptedId,
            message:
              "La sauvegarde ne peut pas être confirmée. Vérifiez la base avant de réimporter. " +
              e.message,
          };
          report.rows.push(outcome);
          onProgress({ ...report, rows: [...report.rows] });
          break;
        }
      }
    report.rows.push(outcome);
    onProgress({ ...report, rows: [...report.rows] });
  }
  return report;
}
