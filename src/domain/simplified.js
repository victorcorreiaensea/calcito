import { calcitoModel } from "../config/calcitoModel.js";
import { nullableNumber } from "./match.js";
export const trackedLeagueSlugs = [
  "ligue-1",
  "premier-league",
  "laliga",
  "serie-a",
  "bundesliga",
  "liga-portugal",
];
export const isTrackedLeague = (c) =>
  c?.type === "league" && trackedLeagueSlugs.includes(c.slug);
export const normalizeClub = (value) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function resultLetter(gf, ga) {
  if (gf == null || ga == null || gf === "" || ga === "") return null;
  return Number(gf) > Number(ga) ? "V" : Number(gf) === Number(ga) ? "N" : "D";
}
// Only infer a season from one unambiguous season the team actually participates in.
// Calendar-year competitions remain possible; an administrator confirms the fallback.
export function inferSeason(dataset, teamId, date) {
  const year = Number(date?.slice(0, 4));
  const eligible = dataset.seasons.filter(
    (s) =>
      dataset.members.some(
        (m) => m.team_id === teamId && m.season_id === s.id,
      ) &&
      year >= s.start_year &&
      year <= s.end_year,
  );
  const pairs = [
    ...new Map(
      eligible.map((s) => [
        `${s.start_year}-${s.end_year}`,
        [s.start_year, s.end_year],
      ]),
    ).values(),
  ];
  return pairs.length === 1
    ? { start: pairs[0][0], end: pairs[0][1], inferred: true }
    : {
        start: year || new Date().getFullYear(),
        end: year || new Date().getFullYear(),
        inferred: false,
      };
}
export function validateSimplified(form, now = new Date()) {
  const errors = {};
  if (!form.team_id) errors.team_id = "Choisissez une équipe suivie.";
  for (const key of ["opponent_name", "competition_name"])
    if (!form[key]?.trim() || form[key].trim().length > 160)
      errors[key] = "Nom requis, 160 caractères maximum.";
  const date = Date.parse(`${form.date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(form.date || "") ||
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== form.date ||
    form.date > now.toISOString().slice(0, 10)
  )
    errors.date = "Choisissez une date réelle, pas une date future.";
  for (const key of ["goals_for", "goals_against"]) {
    const n = nullableNumber(form[key]);
    if (n === null || !Number.isInteger(n) || n < 0 || n > 32767)
      errors[key] = "Score entier positif ou nul requis.";
  }
  const start = Number(form.season_start_year),
    end = Number(form.season_end_year),
    year = Number(form.date?.slice(0, 4));
  if (
    !Number.isInteger(start) ||
    start < 1900 ||
    start > 2200 ||
    !Number.isInteger(end) ||
    end < start ||
    end > start + 1 ||
    year < start ||
    year > end
  )
    errors.season_start_year = "La saison doit contenir la date du match.";
  if (!["home", "away"].includes(form.venue)) errors.venue = "Terrain requis.";
  if (form.opponent_team_id === form.team_id)
    errors.opponent_name = "Choisissez un adversaire différent.";
  return errors;
}
export function simplifiedPayload(form, published) {
  return {
    ...form,
    kickoff: `${form.date}T12:00:00Z`,
    goals_for: nullableNumber(form.goals_for),
    goals_against: nullableNumber(form.goals_against),
    season_start_year: Number(form.season_start_year),
    season_end_year: Number(form.season_end_year),
    opponent_team_id: form.opponent_team_id || null,
    is_published: published,
  };
}
export function teamHistory(
  dataset,
  teamId,
  year,
  { publishedOnly = true, limit = Infinity } = {},
) {
  const complete = (dataset.matches || [])
    .filter(
      (m) =>
        m.status === "finished" &&
        m.goals_home != null &&
        m.goals_away != null &&
        (!publishedOnly || m.is_published) &&
        [m.home_team_id, m.away_team_id].includes(teamId) &&
        (!year ||
          dataset.seasons.find((s) => s.id === m.season_id)?.start_year ===
            Number(year)),
    )
    .map((m) => {
      const home = m.home_team_id === teamId,
        stats =
          (dataset.stats || []).find(
            (s) => s.match_id === m.id && s.team_id === teamId,
          ) || null;
      return {
        ...m,
        entry_type: "complete",
        team_id: teamId,
        goals_for: home ? m.goals_home : m.goals_away,
        goals_against: home ? m.goals_away : m.goals_home,
        stats,
      };
    });
  const quick = (dataset.simplified || [])
    .filter(
      (r) =>
        r.team_id === teamId &&
        !r.converted_at &&
        (!publishedOnly || r.is_published) &&
        (!year || r.season_start_year === Number(year)),
    )
    .map((r) => ({ ...r, status: "finished", stats: null }));
  return [...complete, ...quick]
    .sort(
      (a, b) =>
        Date.parse(b.kickoff) - Date.parse(a.kickoff) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
// Results-only benchmark: standard football points, never the proprietary model.
export const simplifiedModel = Object.freeze({
  version: "results-points-v1",
  formula: (points) => (100 * points) / 15,
  compatibilityGroup: "results-points-v1",
});
export function calculateSimplifiedForm(input = []) {
  const history = Array.isArray(input)
    ? input
    : (input.trace || []).map((m) => ({
        goals_for: m.goalsFor,
        goals_against: m.goalsAgainst,
      }));
  const recent = history.slice(0, 5);
  if (
    recent.length !== 5 ||
    recent.some((m) =>
      [m.goals_for, m.goals_against].some(
        (n) =>
          n == null ||
          (typeof n !== "number" && typeof n !== "string") ||
          String(n).trim() === "" ||
          !Number.isInteger(Number(n)) ||
          Number(n) < 0,
      ),
    )
  )
    return {
      score: null,
      status: "unavailable",
      reason: "Cinq résultats valides nécessaires",
    };
  const points = recent.reduce(
    (total, m) =>
      total +
      (Number(m.goals_for) > Number(m.goals_against)
        ? 3
        : Number(m.goals_for) === Number(m.goals_against)
          ? 1
          : 0),
    0,
  );
  return {
    score: simplifiedModel.formula(points),
    status: "provisional",
    points,
    goalsFor: recent.reduce((n, m) => n + Number(m.goals_for), 0),
    goalsAgainst: recent.reduce((n, m) => n + Number(m.goals_against), 0),
    formulaVersion: simplifiedModel.version,
  };
}
export function formCoverage(
  history,
  snapshot = null,
  { completeModel = calcitoModel, provisionalModel = simplifiedModel } = {},
) {
  const recent = history.slice(0, 5),
    simplified = recent.filter((m) => m.entry_type === "simplified").length;
  const required = [
    "shots",
    "shots_on_target",
    "big_chances",
    "team_rating",
    "bonuses",
  ];
  const detailed = recent.filter(
    (m) =>
      m.entry_type === "complete" &&
      required.every((k) => m.stats?.[k] != null),
  ).length;
  const variant = simplified ? "provisional" : "complete";
  const eligible =
    recent.length === 5 &&
    (simplified ? detailed + simplified === 5 : detailed === 5);
  const method = simplified ? provisionalModel : completeModel;
  // Stored outputs require an explicitly defined method with the exact same version.
  const valid =
    eligible &&
    !(
      variant === "provisional" && method.version === simplifiedModel.version
    ) &&
    snapshot?.is_valid &&
    snapshot?.is_published &&
    (snapshot.index_variant || "complete") === variant &&
    typeof method.formula === "function" &&
    Boolean(method.version) &&
    method.version === snapshot.model_version &&
    snapshot.score != null &&
    snapshot.score !== "" &&
    Number.isFinite(Number(snapshot.score)) &&
    Number(snapshot.score) >= 0 &&
    Number(snapshot.score) <= 100;
  const provisional =
    provisionalModel.version === simplifiedModel.version &&
    typeof provisionalModel.formula === "function"
      ? calculateSimplifiedForm(recent)
      : { score: null };
  const fallback = !valid && provisional.score != null;
  const advancedAvailable = recent.some((m) =>
    ["shots", "shots_on_target", "big_chances", "team_rating"].some(
      (key) => m.stats?.[key] != null,
    ),
  );
  const dataMode =
    detailed === 5 ? "complet" : advancedAvailable ? "mixte" : "simplifié";
  return {
    dataMode,
    points: fallback ? provisional.points : null,
    goalsFor: fallback ? provisional.goalsFor : null,
    goalsAgainst: fallback ? provisional.goalsAgainst : null,
    sampleSize: recent.length,
    missingMatches: 5 - recent.length,
    simplified: recent.length - detailed,
    quickEntries: simplified,
    detailed,
    variant: fallback ? "provisional" : variant,
    status: valid ? variant : fallback ? "provisional" : "unavailable",
    score: valid ? Number(snapshot.score) : fallback ? provisional.score : null,
    compatibilityGroup: valid
      ? snapshot.compatibility_group || `${variant}:${snapshot.model_version}`
      : fallback
        ? simplifiedModel.compatibilityGroup
        : null,
    label: fallback
      ? `Indice résultats provisoire · couverture ${{ complet: "complète", mixte: "mixte", simplifié: "simplifiée" }[dataMode]}`
      : valid
        ? simplified
          ? "Indice provisoire"
          : "Indice complet"
        : recent.length < 5
          ? "Moins de cinq résultats"
          : simplified
            ? "Méthode provisoire à définir"
            : detailed < 5
              ? "Statistiques partielles"
              : "Méthode de calcul à définir",
    results: [...recent]
      .reverse()
      .map((m) => resultLetter(m.goals_for, m.goals_against)),
  };
}
export function coverageRows(dataset, year) {
  return dataset.teams
    .map((team) => {
      const history = teamHistory(dataset, team.id, year, {
        publishedOnly: false,
      });
      const publicHistory = teamHistory(dataset, team.id, year);
      const snapshot = (dataset.forms || []).find(
        (f) =>
          f.team_id === team.id &&
          f.season_start_year === Number(year) &&
          f.is_valid &&
          f.is_published,
      );
      return {
        team,
        ...formCoverage(publicHistory, snapshot),
        recorded: Math.min(5, history.length),
        missingToEnter: Math.max(0, 5 - history.length),
        drafts: history.filter((m) => !m.is_published).length,
      };
    })
    .sort(
      (a, b) =>
        b.missingToEnter - a.missingToEnter ||
        a.team.name.localeCompare(b.team.name),
    );
}
