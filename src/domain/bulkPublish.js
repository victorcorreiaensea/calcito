import { validateMatch } from "./match.js";
import { validateSimplified } from "./simplified.js";

export function planDraftPublication(dataset, now = new Date()) {
  const entries = [
    ...dataset.matches.map((m) => ({ ...m, table: "matches" })),
    ...(dataset.simplified || [])
      .filter((m) => !m.converted_at)
      .map((m) => ({ ...m, table: "simplified_results" })),
  ];
  return entries
    .filter((m) => !m.is_published)
    .map((match) => {
      const quick = match.table === "simplified_results";
      const errors = [];
      const team = (id) => dataset.teams.find((t) => t.id === id);
      const season = dataset.seasons.find((s) => s.id === match.season_id);
      const competition = dataset.competitions.find(
        (c) => c.id === season?.competition_id,
      );
      const patch = quick
        ? { is_published: true }
        : { is_published: true, verified_at: now.toISOString() };
      if (!match.updated_at)
        errors.push("Version manquante : rechargez les données.");
      if (quick) {
        errors.push(
          ...Object.values(
            validateSimplified(
              { ...match, date: match.kickoff?.slice(0, 10) },
              now,
            ),
          ),
        );
        if (!team(match.team_id)?.is_published)
          errors.push("Publiez d’abord la fiche de l’équipe.");
        if (
          match.opponent_team_id &&
          !team(match.opponent_team_id)?.is_published
        )
          errors.push("La fiche de l’adversaire est privée.");
      } else {
        errors.push(
          ...Object.values(validateMatch({ ...match, ...patch }, true)),
        );
        if (
          match.status === "finished" &&
          Date.parse(match.kickoff) > now.getTime()
        )
          errors.push("Un résultat terminé est daté dans le futur.");
        if (!competition?.is_published || !season?.is_published)
          errors.push("Publiez d’abord la compétition et la saison.");
        if (
          !team(match.home_team_id)?.is_published ||
          !team(match.away_team_id)?.is_published
        )
          errors.push("Publiez d’abord les fiches des deux équipes.");
        for (const id of [match.home_team_id, match.away_team_id])
          if (
            !dataset.members.some(
              (m) => m.season_id === match.season_id && m.team_id === id,
            )
          )
            errors.push("Une équipe n’est pas inscrite à cette saison.");
      }
      return {
        id: match.id,
        table: match.table,
        expectedUpdatedAt: match.updated_at,
        patch,
        errors,
        label: quick
          ? `${team(match.team_id)?.name || "Équipe"} – ${match.opponent_name}`
          : `${team(match.home_team_id)?.name || "Équipe"} – ${team(match.away_team_id)?.name || "Équipe"}`,
        date: match.kickoff,
        source: quick ? "Résultat saisi manuellement" : match.source,
      };
    });
}

export async function executeDraftPublication(
  plan,
  { publish, onProgress = () => {} },
) {
  const report = {
    published: 0,
    blocked: plan.filter((p) => p.errors.length).length,
    stale: 0,
    failed: 0,
    uncertain: 0,
    remaining: 0,
    rows: plan
      .filter((p) => p.errors.length)
      .map((p) => ({ ...p, outcome: "Bloqué : " + p.errors.join(" ") })),
  };
  const ready = plan.filter((p) => !p.errors.length);
  for (let i = 0; i < ready.length; i++) {
    const item = ready[i];
    try {
      const ids = await publish(item);
      if (ids.length === 1 && ids[0] === item.id) {
        report.published++;
        report.rows.push({ ...item, outcome: "Publié" });
      } else if (ids.length === 0) {
        report.stale++;
        report.rows.push({
          ...item,
          outcome: "Modifié ou déjà publié : recharger",
        });
      } else throw new Error("Unexpected publication response");
    } catch (error) {
      if (error.code) {
        report.failed++;
        report.rows.push({ ...item, outcome: "Échec : " + error.message });
      } else {
        report.uncertain++;
        report.rows.push({
          ...item,
          outcome: "Publication à vérifier avant toute nouvelle tentative",
        });
      }
      // Stop after a failed request: no blind retries, including lost responses.
      report.remaining = ready.length - i - 1;
      report.rows.push(
        ...ready.slice(i + 1).map((p) => ({ ...p, outcome: "Non traité" })),
      );
      break;
    }
    onProgress({ ...report, processed: i + 1, total: ready.length });
  }
  return report;
}
