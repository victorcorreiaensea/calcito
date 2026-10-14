import {
  planMatchImport,
  parseImportDate,
  isFlashscoreSource,
} from "./matchImport.js";
import { statFields } from "./match.js";
const sizes = {
  "ligue-1": 9,
  "liga-portugal": 9,
  "premier-league": 10,
  laliga: 10,
  "serie-a": 10,
  bundesliga: 9,
};
export function suggestedMatchCount(competition, season, dataset) {
  if (competition?.type === "european-cup") return 18;
  const count = dataset.members.filter(
    (m) => m.season_id === season?.id,
  ).length;
  return count >= 2 && count % 2 === 0
    ? count / 2
    : sizes[competition?.slug] || 1;
}
export function createMatchdaySlots(count, date = "") {
  if (
    !Number.isInteger(Number(count)) ||
    Number(count) < 1 ||
    Number(count) > 40
  )
    throw new Error("Choisissez entre 1 et 40 matchs.");
  return Array.from({ length: Number(count) }, () => ({
    home_team: "",
    away_team: "",
    home_goals: "",
    away_goals: "",
    date,
    source_url: "",
    time: "",
    ...Object.fromEntries(
      statFields.flatMap(([key]) =>
        ["home", "away"].map((side) => [
          `${side}_${key === "team_rating" ? "rating" : key}`,
          "",
        ]),
      ),
    ),
  }));
}
export function planMatchday(slots, header, dataset) {
  if (header.future === true)
    return planScheduledMatchday(slots, header, dataset);
  const filled = slots
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      [
        "home_team",
        "away_team",
        "home_goals",
        "away_goals",
        "source_url",
        ...statFields.flatMap(([key]) =>
          ["home", "away"].map(
            (side) => `${side}_${key === "team_rating" ? "rating" : key}`,
          ),
        ),
      ].some((k) => row[k] !== "" && row[k] != null),
    );
  const rows = filled.map(({ row }) => ({
    ...row,
    competition: header.competition_id,
    season: header.season_id,
    round: header.round.trim(),
    source_url: row.source_url || header.source_url || "",
  }));
  const plan = planMatchImport(rows, dataset, {
    published: false,
    duplicates: "ignore",
    flashscoreConsent: header.flashscoreConsent === true,
  });
  const used = new Map();
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    item.slot = filled[i].index;
    if (!header.round.trim())
      item.errors.push("Indiquez la journée ou le tour.");
    for (const id of [item.row.home_team, item.row.away_team].filter(Boolean)) {
      const previous = used.get(id);
      if (previous !== undefined && previous !== i) {
        item.errors.push(
          "Une équipe apparaît plusieurs fois dans cette journée.",
        );
        plan[previous].errors.push(
          "Une équipe apparaît plusieurs fois dans cette journée.",
        );
      } else used.set(id, i);
      if (
        dataset.matches.some(
          (m) =>
            m.season_id === header.season_id &&
            m.round === header.round.trim() &&
            [m.home_team_id, m.away_team_id].includes(id) &&
            m.id !== item.existing?.id &&
            !item.existing,
        )
      )
        item.errors.push(
          "Une rencontre de cette journée est déjà enregistrée pour cette équipe.",
        );
    }
  }
  return plan;
}

export function planScheduledMatchday(
  slots,
  header,
  dataset,
  now = new Date(),
) {
  const filled = slots
    .map((row, slot) => ({ row, slot }))
    .filter(({ row }) => row.home_team || row.away_team || row.source_url);
  const seen = new Map();
  return filled.map(({ row, slot }) => {
    const errors = [];
    let kickoff = "";
    try {
      if (!row.date || !row.time)
        throw new Error("Date et heure réelles requises.");
      kickoff = parseImportDate(
        `${row.date}T${row.time}`,
        header.timezone || "Europe/Paris",
      ).iso;
      if (Date.parse(kickoff) <= now.getTime())
        throw new Error("Choisissez une rencontre future.");
    } catch (e) {
      errors.push(e.message);
    }
    const season = dataset.seasons.find((s) => s.id === header.season_id);
    const validTeam = (id) =>
      dataset.teams.some((t) => t.id === id) &&
      dataset.members.some(
        (m) => m.team_id === id && m.season_id === header.season_id,
      );
    if (!season || season.competition_id !== header.competition_id)
      errors.push("Saison et compétition requises.");
    if (
      season &&
      row.date &&
      (Number(row.date.slice(0, 4)) < season.start_year ||
        Number(row.date.slice(0, 4)) > season.end_year)
    )
      errors.push("La date doit appartenir à la saison.");
    if (!header.round.trim()) errors.push("Journée requise.");
    if (
      !validTeam(row.home_team) ||
      !validTeam(row.away_team) ||
      row.home_team === row.away_team
    )
      errors.push("Deux équipes participantes différentes requises.");
    for (const id of [row.home_team, row.away_team].filter(Boolean)) {
      if (seen.has(id)) {
        errors.push("Équipe répétée dans cette journée.");
        seen.get(id).push("Équipe répétée dans cette journée.");
      } else seen.set(id, errors);
    }
    const existing = dataset.matches.find(
      (m) =>
        m.season_id === header.season_id &&
        m.home_team_id === row.home_team &&
        m.away_team_id === row.away_team &&
        m.kickoff.slice(0, 10) === kickoff.slice(0, 10),
    );
    if (
      !existing &&
      dataset.matches.some(
        (m) =>
          m.season_id === header.season_id &&
          m.round === header.round.trim() &&
          [m.home_team_id, m.away_team_id].some((id) =>
            [row.home_team, row.away_team].includes(id),
          ),
      )
    )
      errors.push("Une équipe possède déjà une rencontre de cette journée.");
    const source = row.source_url || header.source_url || "";
    if (isFlashscoreSource(source) && !header.flashscoreConsent)
      errors.push(
        "Confirmez votre autorisation de réutilisation de la source Flashscore.",
      );
    if (source) {
      try {
        const u = new URL(source);
        if (u.protocol !== "https:" || u.username || u.password)
          throw new Error();
      } catch {
        errors.push("Source HTTPS valide requise.");
      }
    }
    return {
      slot,
      row,
      index: slot,
      errors,
      warnings: [],
      action: existing ? "ignore" : "insert",
      existing,
      payload: {
        id: crypto.randomUUID(),
        season_id: header.season_id,
        round: header.round.trim(),
        kickoff,
        home_team_id: row.home_team,
        away_team_id: row.away_team,
        status: "scheduled",
        goals_home: null,
        goals_away: null,
        source,
        verified_at: null,
        comment: `Heure saisie dans le fuseau ${header.timezone || "Europe/Paris"}.`,
        is_published: false,
        home_stats: {},
        away_stats: {},
      },
    };
  });
}
