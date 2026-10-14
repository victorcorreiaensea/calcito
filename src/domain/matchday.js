import { planMatchImport } from "./matchImport.js";
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
