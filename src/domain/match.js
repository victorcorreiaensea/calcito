export const statFields = [
  ["shots", "Tirs", "integer"],
  ["shots_on_target", "Tirs cadrés", "integer"],
  ["woodwork", "Poteaux", "integer"],
  ["big_chances", "Grosses occasions", "integer"],
  ["team_rating", "Note / 10", "rating"],
  ["possession", "Possession %", "possession"],
  ["xg", "xG", "decimal"],
];
export function nullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : NaN;
}
export function validateMatch(input, published = input.is_published) {
  const errors = {};
  for (const field of ["season_id", "home_team_id", "away_team_id", "round"])
    if (!input[field]?.trim()) errors[field] = "Champ requis.";
  if (!Number.isFinite(Date.parse(input.kickoff)))
    errors.kickoff = "Date et heure requises.";
  if (input.home_team_id && input.home_team_id === input.away_team_id)
    errors.away_team_id = "Choisissez deux équipes différentes.";
  if (
    !["scheduled", "finished", "live", "postponed", "cancelled"].includes(
      input.status,
    )
  )
    errors.status = "Statut invalide.";
  for (const field of [
    "goals_home",
    "goals_away",
    "halftime_home",
    "halftime_away",
    "extra_home",
    "extra_away",
    "penalties_home",
    "penalties_away",
  ]) {
    const value = nullableNumber(input[field]);
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || value > 32767)
    )
      errors[field] = "Nombre entier positif ou nul requis.";
  }
  if (published && input.status === "finished")
    for (const field of ["goals_home", "goals_away"])
      if (nullableNumber(input[field]) === null)
        errors[field] = "Score requis pour publier un match terminé.";
  if (published && !input.source?.trim())
    errors.source = "Indiquez la source avant publication.";
  if (published && !Number.isFinite(Date.parse(input.verified_at)))
    errors.verified_at = "Date de vérification requise.";
  for (const side of ["home", "away"]) {
    const stats = input[`${side}_stats`] || {};
    for (const [field, , type] of statFields) {
      const value = nullableNumber(stats[field]);
      if (
        value !== null &&
        (!Number.isFinite(value) ||
          value < 0 ||
          (type === "integer" && (!Number.isInteger(value) || value > 32767)) ||
          (type === "rating" && value > 10) ||
          (type === "possession" && value > 100))
      )
        errors[`${side}_${field}`] = "Valeur invalide.";
    }
    const shots = nullableNumber(stats.shots),
      onTarget = nullableNumber(stats.shots_on_target);
    if (shots !== null && onTarget !== null && onTarget > shots)
      errors[`${side}_shots_on_target`] =
        "Les tirs cadrés ne peuvent pas dépasser les tirs.";
  }
  return errors;
}
export function matchPayload(form, published) {
  const result = { ...form, is_published: published };
  for (const field of [
    "goals_home",
    "goals_away",
    "halftime_home",
    "halftime_away",
    "extra_home",
    "extra_away",
    "penalties_home",
    "penalties_away",
  ])
    result[field] = nullableNumber(form[field]);
  for (const side of ["home", "away"])
    result[`${side}_stats`] = Object.fromEntries(
      statFields.map(([key]) => [
        key,
        nullableNumber(form[`${side}_stats`]?.[key]),
      ]),
    );
  return result;
}
export function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function blankMatch() {
  return {
    season_id: "",
    round: "",
    kickoff: localDateTime(),
    home_team_id: "",
    away_team_id: "",
    status: "finished",
    goals_home: "",
    goals_away: "",
    source: "",
    verified_at: localDateTime(),
    comment: "",
    home_stats: {},
    away_stats: {},
    is_published: false,
  };
}
export function completeness(match) {
  const fields = [
    match.goals_home,
    match.goals_away,
    match.source?.trim() || null,
    match.verified_at,
  ];
  for (const side of ["home_stats", "away_stats"])
    for (const key of [
      "shots",
      "shots_on_target",
      "woodwork",
      "big_chances",
      "team_rating",
    ])
      fields.push(match[side]?.[key]);
  const filled = fields.filter(
    (value) => value !== "" && value !== null && value !== undefined,
  ).length;
  return {
    filled,
    total: fields.length,
    percent: Math.round((filled / fields.length) * 100),
  };
}
