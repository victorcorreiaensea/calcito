// Descriptive views of the real ledger; these never replace the main V4 index.
export function recentInsight(matches = [], teamId, asOf = Date.now()) {
  const rows = matches
    .filter(
      (m) =>
        m.status === "finished" &&
        Date.parse(m.kickoff) <= asOf &&
        m.goalsHome >= 0 &&
        m.goalsAway >= 0 &&
        Number.isInteger(m.goalsHome) &&
        Number.isInteger(m.goalsAway) &&
        [m.home?.id, m.away?.id].includes(teamId),
    )
    .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))
    .slice(0, 5);
  const values = rows.map((m) => {
    const home = m.home.id === teamId;
    return {
      venue: home ? "home" : "away",
      gf: home ? m.goalsHome : m.goalsAway,
      ga: home ? m.goalsAway : m.goalsHome,
      performance: m.dynamic?.performance,
    };
  });
  const lastThree = values.slice(0, 3);
  const instant =
    lastThree.length === 3 &&
    lastThree.every((r) => Number.isFinite(r.performance))
      ? lastThree.reduce((n, r) => n + r.performance, 0) / 3
      : null;
  return {
    rows,
    values,
    instant,
    goalsFor: values.reduce((n, r) => n + r.gf, 0),
    goalsAgainst: values.reduce((n, r) => n + r.ga, 0),
    wins: values.filter((r) => r.gf > r.ga).length,
  };
}
export function insightText(name, insight) {
  if (!insight.rows.length)
    return `Je n’ai pas encore de résultat exploitable pour ${name} dans cette saison.`;
  return `${name} : ${insight.wins} victoire${insight.wins > 1 ? "s" : ""} sur ${insight.rows.length} matchs publiés, ${insight.goalsFor} buts marqués et ${insight.goalsAgainst} encaissés. ${insight.goalsAgainst === 0 ? "Une défense invaincue sur cet échantillon." : "La couverture des rencontres reste à prendre en compte."}`;
}
export function compareInsights(left, right, a, b) {
  const sentences = [];
  if (Number.isFinite(left.score) && Number.isFinite(right.score)) {
    sentences.push(
      left.score === right.score
        ? "Les deux clubs ont le même indice général."
        : `${left.score > right.score ? left.name : right.name} présente l’indice général le plus élevé.`,
    );
  } else
    sentences.push(
      "Un des indices généraux manque : la comparaison reste partielle.",
    );
  if (a.instant != null && b.instant != null)
    sentences.push(
      a.instant === b.instant
        ? "Leurs trois dernières performances ont la même moyenne."
        : `${a.instant > b.instant ? left.name : right.name} affiche la meilleure moyenne sur les trois dernières performances.`,
    );
  else
    sentences.push(
      "La lecture sur trois matchs n’est pas disponible pour les deux équipes.",
    );
  sentences.push(
    "Les adversaires et les dates des échantillons peuvent différer. Ces repères ne sont pas des probabilités de victoire.",
  );
  return sentences.join(" ");
}
