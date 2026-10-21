// Inject a licensed backend adapter later; never put provider keys in GitHub Pages.
export const oddsSelections = Object.freeze({
  result: ["home", "draw", "away"],
  btts: ["btts_yes", "btts_no"],
  homeGoals: ["home_scores", "home_blank"],
  awayGoals: ["away_scores", "away_blank"],
  total15: ["over_1_5", "under_1_5"],
  total25: ["over_2_5", "under_2_5"],
  total35: ["over_3_5", "under_3_5"],
});
export function compareOdds(probability, decimal) {
  if (
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1 ||
    !Number.isFinite(decimal) ||
    decimal <= 1
  )
    return null;
  return {
    impliedProbability: 1 / decimal,
    theoreticalOdds:
      probability > 0 && Number.isFinite(1 / probability)
        ? 1 / probability
        : null,
    theoreticalValue: probability * decimal - 1,
  };
}
export function matchIdentity(match) {
  if (
    match?.timeKnown === false ||
    !match?.id ||
    !match.home?.id ||
    !match.away?.id ||
    !match.competition?.id ||
    !Number.isInteger(match.season) ||
    !Number.isFinite(Date.parse(match.kickoff))
  )
    return null;
  return {
    id: match.id,
    homeId: match.home.id,
    awayId: match.away.id,
    competitionId: match.competition.id,
    season: match.season,
    kickoff: new Date(match.kickoff).toISOString(),
  };
}
export function createExternalOddsService({
  provider = null,
  now = Date.now,
  maxAgeMs = 5 * 60 * 1000,
} = {}) {
  return {
    async getQuotes(match, { signal } = {}) {
      const identity = matchIdentity(match);
      if (!identity)
        return {
          status: "unavailable",
          quotes: [],
          reason: "Rencontre non identifiable.",
        };
      if (Date.parse(identity.kickoff) <= now())
        return {
          status: "unavailable",
          quotes: [],
          reason: "La rencontre a déjà commencé.",
        };
      if (!provider)
        return {
          status: "unconfigured",
          quotes: [],
          reason: "Aucun fournisseur de cotes connecté.",
        };
      const retrievedAt = new Date(now()).toISOString();
      try {
        const rows = await provider.getQuotes({ identity, signal });
        if (!Array.isArray(rows)) throw Error("Invalid odds response");
        const quotes = rows
          .filter((q) => {
            const stamp = Date.parse(q.quotedAt);
            return (
              q.match &&
              Object.entries(identity).every(([k, v]) => q.match[k] === v) &&
              typeof q.bookmaker === "string" &&
              q.bookmaker.trim() &&
              oddsSelections[q.market]?.includes(q.selection) &&
              Number.isFinite(q.decimal) &&
              q.decimal > 1 &&
              Number.isFinite(stamp) &&
              stamp <= now() &&
              now() - stamp <= maxAgeMs
            );
          })
          .map((q) => ({
            match: identity,
            bookmaker: q.bookmaker,
            market: q.market,
            selection: q.selection,
            decimal: q.decimal,
            quotedAt: q.quotedAt,
            retrievedAt,
            provider: provider.name || null,
          }));
        return {
          status: quotes.length ? "available" : "unavailable",
          quotes,
          retrievedAt,
          reason: quotes.length
            ? null
            : "Aucune cote récente pour cette rencontre exacte.",
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          status: "error",
          quotes: [],
          retrievedAt,
          reason: "Les cotes externes sont indisponibles.",
        };
      }
    },
  };
}
export const externalOdds = createExternalOddsService();
