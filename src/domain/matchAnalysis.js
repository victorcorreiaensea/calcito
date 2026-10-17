const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : null;
const format = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
export function comparativeStat(home, away) {
  const h = number(home),
    a = number(away);
  const total = h !== null && a !== null ? h + a : null;
  return {
    home: h,
    away: a,
    complete: total !== null,
    homeShare: total > 0 ? (h / total) * 100 : 0,
    awayShare: total > 0 ? (a / total) * 100 : 0,
  };
}
export function analyzeMatchStatistics(match) {
  const stats = match.teamStatistics || {},
    home = stats.home || {},
    away = stats.away || {},
    hn = match.home?.name || "L’équipe à domicile",
    an = match.away?.name || "L’équipe à l’extérieur";
  const pair = (key) => comparativeStat(home[key], away[key]);
  const shots = pair("shots"),
    target = pair("shots_on_target"),
    xg = pair("xg"),
    possession = pair("possession"),
    corners = pair("corners");
  const text = [];
  if (shots.complete) {
    if (shots.home !== shots.away) {
      const leader = shots.home > shots.away ? "home" : "away",
        other = leader === "home" ? "away" : "home";
      text.push(
        `${leader === "home" ? hn : an} a tenté ${format(shots[leader])} tirs${target.complete ? `, dont ${format(target[leader])} cadrés` : ""}, contre ${format(shots[other])}${target.complete ? ` tirs et ${format(target[other])} cadrés` : " tirs"} pour ${other === "home" ? hn : an}.`,
      );
    } else
      text.push(
        `Les deux équipes ont tenté ${format(shots.home)} tirs chacune.`,
      );
  }
  if (xg.complete) {
    if (xg.home !== xg.away) {
      const leader = xg.home > xg.away ? "home" : "away",
        other = leader === "home" ? "away" : "home";
      text.push(
        `${possession.complete && possession[leader] < possession[other] ? `Avec ${format(possession[leader])} % de possession, ` : ""}${leader === "home" ? hn : an} a produit ${format(xg[leader])} xG, contre ${format(xg[other])} pour ${other === "home" ? hn : an}.`,
      );
    } else
      text.push(
        `Les xG sont identiques : ${format(xg.home)} pour chaque équipe.`,
      );
  }
  if (!text.length && target.complete)
    text.push(
      `${hn} a cadré ${format(target.home)} tirs, contre ${format(target.away)} pour ${an}.`,
    );
  if (!text.length && possession.complete)
    text.push(
      `La possession se répartit entre ${hn} (${format(possession.home)} %) et ${an} (${format(possession.away)} %).`,
    );
  if (!text.length && corners.complete)
    text.push(
      `${hn} a obtenu ${format(corners.home)} corners, contre ${format(corners.away)} pour ${an}.`,
    );
  return text.length
    ? text.join(" ")
    : "Les statistiques disponibles ne suffisent pas à comparer les performances de ces deux équipes.";
}
