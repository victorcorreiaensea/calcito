export const arenaMarkets = {
  home: "Victoire domicile",
  draw: "Match nul",
  away: "Victoire extérieur",
  "1x": "Domicile ou nul",
  12: "Pas de nul",
  x2: "Nul ou extérieur",
  over_1_5: "Plus de 1,5 buts",
  under_1_5: "Moins de 1,5 buts",
  over_2_5: "Plus de 2,5 buts",
  under_2_5: "Moins de 2,5 buts",
  over_3_5: "Plus de 3,5 buts",
  under_3_5: "Moins de 3,5 buts",
  btts_yes: "Les deux équipes marquent",
  btts_no: "Au moins une équipe ne marque pas",
  home_cs: "Clean sheet domicile",
  away_cs: "Clean sheet extérieur",
  ...Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      `home_goals_${i}`,
      `${i} but(s) à domicile`,
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      `away_goals_${i}`,
      `${i} but(s) à l’extérieur`,
    ]),
  ),
};
export const levels = [
  { name: "Débutant", xp: 0 },
  { name: "Amateur", xp: 10000 },
  { name: "Analyste", xp: 50000 },
  { name: "Expert", xp: 150000 },
  { name: "Stratège", xp: 400000 },
  { name: "Maître Calcito", xp: 1000000 },
];
export const formatCoins = (cents) =>
  Number.isFinite(Number(cents))
    ? (Number(cents) / 100).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
export function parseCoins(value) {
  const m = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(String(value).trim());
  return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : null;
}
export function maxStake(available) {
  return Math.max(0, Math.min(1000, Math.floor(Number(available) / 20)));
}
export function levelFor(xp) {
  return [...levels].reverse().find((l) => xp >= l.xp) || levels[0];
}
export const missions = [
  {
    id: "daily_coach",
    title: "Le réflexe du coach",
    type: "Quotidienne",
    reward: 200,
    question: "La limite de 5 % garantit-elle des gains ?",
    key: "risk",
    answers: [
      ["limit", "Non, c’est une limite de prudence"],
      ["guarantee", "Oui, elle garantit un gain"],
    ],
  },
  {
    id: "weekly_probability",
    title: "Comprendre les probabilités",
    type: "Hebdomadaire",
    reward: 500,
    question: "Une estimation de 80 % signifie…",
    key: "certainty",
    answers: [
      ["none", "Une incertitude demeure"],
      ["sure", "Une victoire certaine"],
    ],
  },
  {
    id: "form_discovery",
    title: "Décrypter la forme",
    type: "Permanente",
    reward: 1000,
    question: "Un indice de 80 / 100 vaut-il 80 % de chances de gagner ?",
    key: "form",
    answers: [
      ["not_probability", "Non, ce sont deux modèles distincts"],
      ["yes", "Oui, directement"],
    ],
  },
  {
    id: "first_ticket",
    title: "Premier pronostic",
    type: "Permanente",
    reward: 200,
  },
  {
    id: "three_wins",
    title: "Trois tickets réussis",
    type: "Permanente",
    reward: 500,
  },
  {
    id: "combination",
    title: "Premier combiné réussi",
    type: "Permanente",
    reward: 500,
  },
];
function ratio(value) {
  if (!/^\d+(?:[.,]\d{1,20})?$/.test(String(value)))
    throw new Error("Cote invalide");
  const [whole, decimal = ""] = String(value).replace(",", ".").split(".");
  return { n: BigInt(whole + decimal), d: 10n ** BigInt(decimal.length) };
}
export function ticketNumbers(legs, stake, mode = "challenge", offer = "") {
  let n = 1n,
    d = 1n;
  const prices = mode === "bookmaker" ? [offer] : legs.map((l) => l.odds);
  try {
    for (const price of prices) {
      const r = ratio(price);
      n *= r.n;
      d *= r.d;
    }
    if (n <= d || !Number.isInteger(stake) || stake < 0) return null;
    const gross = Number((BigInt(stake) * n) / d);
    return {
      odds: Number(n) / Number(d),
      probability: legs.reduce((p, l) => p * Number(l.probability), 1),
      gross,
      net: gross - stake,
      userRisk: mode === "bookmaker" ? gross - stake : stake,
      botRisk: mode === "bookmaker" ? stake : gross - stake,
      n,
      d,
    };
  } catch {
    return null;
  }
}
