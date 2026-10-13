import { normalizeClub } from "./simplified.js";

export function resolveCatalog(clubs, dataset, choices = {}) {
  return clubs.map((club) => {
    const choice = choices[club.sourceName];
    let matches;
    if (choice && choice !== "new")
      matches = dataset.teams.filter((t) => t.id === choice);
    else
      matches = dataset.teams.filter(
        (t) =>
          t.country === club.country &&
          (t.id === club.existingId ||
            normalizeClub(t.name) === normalizeClub(club.name) ||
            normalizeClub(t.name) === normalizeClub(club.sourceName)),
      );
    const existing = matches.length === 1 ? matches[0] : null;
    const collision = dataset.teams.some(
      (t) =>
        t.slug === club.slug ||
        normalizeClub(t.name) === normalizeClub(club.name),
    );
    const error =
      matches.length > 1
        ? "Plusieurs fiches possibles : choisissez la bonne."
        : choice && choice !== "new" && !existing
          ? "La fiche choisie n’existe plus."
          : existing && existing.country !== club.country
            ? "Le pays de cette fiche ne correspond pas."
            : !existing && !club.allowCreate
              ? "Associez une fiche existante ; les clubs français et portugais sont protégés."
              : !existing && collision
                ? "Une fiche similaire existe : associez-la avant de continuer."
                : null;
    return { club, existing, error, action: existing ? "reuse" : "create" };
  });
}

// Sequential, owner-only inserts. Existing teams and membership adjustments are untouched.
// On failure, stop: fresh catalog inspection is required before any retry.
export async function prepareSeasonCatalog(
  bundle,
  dataset,
  {
    choices = {},
    published = false,
    mutate,
    onProgress = () => {},
    uuid = () => crypto.randomUUID(),
  } = {},
) {
  const plan = resolveCatalog(bundle.clubs, dataset, choices);
  if (plan.some((row) => row.error))
    throw new Error(
      "Corrigez toutes les correspondances avant de préparer le catalogue.",
    );
  if (
    new Set(plan.filter((p) => p.existing).map((p) => p.existing.id)).size !==
    plan.filter((p) => p.existing).length
  )
    throw new Error(
      "Une fiche interne est associée à plusieurs clubs. Corrigez les correspondances.",
    );
  const mapping = {};
  const report = { teams: 0, seasons: 0, competitions: 0, members: 0 };
  for (const league of bundle.report) {
    let comp = dataset.competitions.find((c) => c.slug === league.slug);
    if (!comp) {
      comp = {
        id: uuid(),
        slug: league.slug,
        name: league.name,
        country: league.country,
        type: "league",
        is_published: published,
      };
      await mutate("competitions", "insert", comp);
      report.competitions++;
    } else if (comp.type !== "league")
      throw new Error(
        "Une compétition existante possède un type incompatible.",
      );
    else if (published && !comp.is_published)
      await mutate("competitions", "update", { is_published: true }, comp.id);
    let season = dataset.seasons.find(
      (s) => s.competition_id === comp.id && s.start_year === 2026,
    );
    if (!season) {
      season = {
        id: uuid(),
        competition_id: comp.id,
        label: "2026–2027",
        start_year: 2026,
        end_year: 2027,
        is_published: published,
        rules_confirmed: false,
        verified_complete: false,
      };
      await mutate("seasons", "insert", season);
      report.seasons++;
    } else if (season.end_year !== 2027)
      throw new Error("La saison existante ne correspond pas à 2026–2027.");
    else if (published && !season.is_published)
      await mutate("seasons", "update", { is_published: true }, season.id);
    for (const item of plan.filter((p) => p.club.league === league.slug)) {
      const { club } = item;
      let team = item.existing;
      if (!team) {
        team = {
          id: uuid(),
          slug: club.slug,
          name: club.name,
          short: club.short,
          country: club.country,
          logo_url: club.logo_url || null,
          is_published: published,
        };
        await mutate("teams", "insert", team);
        report.teams++;
      }
      if (
        !dataset.members.some(
          (m) => m.season_id === season.id && m.team_id === team.id,
        )
      ) {
        await mutate("season_teams", "insert", {
          season_id: season.id,
          team_id: team.id,
        });
        report.members++;
      }
      mapping[club.sourceName] = {
        id: team.id,
        name: team.name,
        competitionId: comp.id,
        competitionName: comp.name,
        seasonId: season.id,
      };
      onProgress({
        ...report,
        processed: Object.keys(mapping).length,
        total: plan.length,
      });
    }
  }
  return { report, mapping };
}

export function mappedSeasonRows(bundle, mapping, { ids = false } = {}) {
  const byName = new Map(
    bundle.clubs.map((c) => [
      `${c.leagueName}:${c.name}`,
      mapping[c.sourceName],
    ]),
  );
  return bundle.rows.map((row) => {
    const home = byName.get(`${row.competition}:${row.home_team}`),
      away = byName.get(`${row.competition}:${row.away_team}`);
    if (
      !home ||
      !away ||
      home.id === away.id ||
      home.competitionId !== away.competitionId ||
      home.seasonId !== away.seasonId
    )
      throw new Error("Correspondance incomplète ou incohérente.");
    return {
      ...row,
      home_team: ids ? home.id : home.name,
      away_team: ids ? away.id : away.name,
      competition: ids ? home.competitionId : home.competitionName,
      season: ids ? home.seasonId : row.season,
    };
  });
}
