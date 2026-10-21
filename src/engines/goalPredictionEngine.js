import { validateProbabilities, theoreticalOdds } from "./predictionEngine.js";

export const goalModel = Object.freeze({
  version: "poisson-comparator-v1",
  recentMatches: 5,
  minimumPool: 30,
  mix: 0.5,
  minimumValidation: 30,
});
const keys = ["home", "draw", "away"];
const validGoals = (n) => Number.isInteger(n) && n >= 0;
const day = (date) => new Date(date).toISOString().slice(0, 10);
const finiteDate = (date) => Number.isFinite(Date.parse(date));
const mean = (rows, get) =>
  rows.reduce((sum, r) => sum + get(r), 0) / rows.length;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const fairOdd = (p) =>
  typeof p === "number" && p > 0 && p <= 1 && Number.isFinite(1 / p)
    ? 1 / p
    : null;

// One observation per encounter; detailed records take priority over mirrored quick entries.
export function predictionRecords(dataset = {}) {
  const seasons = new Map(
    (dataset.seasons || []).filter((s) => s.is_published).map((s) => [s.id, s]),
  );
  const clubs = new Set(
    (dataset.teams || []).filter((t) => t.is_published).map((t) => t.id),
  );
  const competitions = new Map(
    (dataset.competitions || [])
      .filter((c) => c.is_published)
      .map((c) => [c.id, c]),
  );
  const rows = [];
  for (const r of dataset.matches || []) {
    const s = seasons.get(r.season_id);
    if (
      !r.is_published ||
      r.status !== "finished" ||
      !s ||
      !competitions.has(s.competition_id) ||
      !clubs.has(r.home_team_id) ||
      !clubs.has(r.away_team_id) ||
      r.home_team_id === r.away_team_id ||
      !r.source ||
      !finiteDate(r.verified_at) ||
      !finiteDate(r.kickoff) ||
      !validGoals(r.goals_home) ||
      !validGoals(r.goals_away)
    )
      continue;
    const availableAt = Math.max(
      Date.parse(r.verified_at),
      finiteDate(r.updated_at) ? Date.parse(r.updated_at) : 0,
      Date.parse(r.kickoff),
    );
    rows.push({
      id: r.id,
      home: r.home_team_id,
      away: r.away_team_id,
      homeGoals: r.goals_home,
      awayGoals: r.goals_away,
      kickoff: r.kickoff,
      availableAt,
      year: s.start_year,
      competition: s.competition_id,
      kind: "detailed",
    });
  }
  const normalize = (v) =>
    (v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  for (const r of dataset.simplified || []) {
    if (
      !r.is_published ||
      r.converted_at ||
      !clubs.has(r.team_id) ||
      !clubs.has(r.opponent_team_id) ||
      r.team_id === r.opponent_team_id ||
      !["home", "away"].includes(r.venue) ||
      !finiteDate(r.kickoff) ||
      !finiteDate(r.updated_at) ||
      !validGoals(r.goals_for) ||
      !validGoals(r.goals_against)
    )
      continue;
    const candidates = [...competitions.values()].filter(
      (c) =>
        c.type === "league" &&
        normalize(c.name) === normalize(r.competition_name),
    );
    if (candidates.length !== 1) continue;
    const comp = candidates[0];
    const s = [...seasons.values()].find(
      (s) =>
        s.competition_id === comp.id && s.start_year === r.season_start_year,
    );
    if (!s) continue;
    const home = r.venue === "home";
    rows.push({
      id: r.id,
      home: home ? r.team_id : r.opponent_team_id,
      away: home ? r.opponent_team_id : r.team_id,
      homeGoals: home ? r.goals_for : r.goals_against,
      awayGoals: home ? r.goals_against : r.goals_for,
      kickoff: r.kickoff,
      availableAt: Math.max(Date.parse(r.updated_at), Date.parse(r.kickoff)),
      year: s.start_year,
      competition: comp.id,
      kind: "simplified",
    });
  }
  const groups = new Map();
  for (const r of rows) {
    const key = [r.competition, r.year, day(r.kickoff), r.home, r.away].join(
      ":",
    );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()]
    .flatMap((group) => {
      const candidates = group.some((r) => r.kind === "detailed")
        ? group.filter((r) => r.kind === "detailed")
        : group;
      // Conflicting mirrors must be resolved by the owner, never silently averaged.
      if (
        candidates.some(
          (r) =>
            r.homeGoals !== candidates[0].homeGoals ||
            r.awayGoals !== candidates[0].awayGoals,
        )
      )
        return [];
      return [
        {
          ...candidates[0],
          availableAt: Math.max(...candidates.map((r) => r.availableAt)),
          date: day(candidates[0].kickoff),
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
        a.id.localeCompare(b.id),
    );
}
function before(rows, cutoff, year) {
  const stamp = Date.parse(cutoff),
    date = day(cutoff);
  return rows.filter(
    (r) =>
      r.year === year &&
      r.availableAt < stamp &&
      (r.date || day(r.kickoff)) < date,
  );
}
function pool(rows, competition) {
  const selected = rows.filter((r) => r.competition === competition);
  if (selected.length < goalModel.minimumPool) return null;
  return {
    count: selected.length,
    home: mean(selected, (r) => r.homeGoals),
    away: mean(selected, (r) => r.awayGoals),
  };
}
function recent(rows, id) {
  return rows
    .filter((r) => r.home === id || r.away === id)
    .slice(-goalModel.recentMatches);
}
function rates(rows, id) {
  return {
    attack: mean(rows, (r) => (r.home === id ? r.homeGoals : r.awayGoals)),
    defence: mean(rows, (r) => (r.home === id ? r.awayGoals : r.homeGoals)),
  };
}
function sideRates(rows, id, base) {
  const own = recent(rows, id),
    raw = rates(own, id);
  // Opponent correction is available only from five strictly earlier observations.
  let adjusted = 0;
  const corrected = own.map((r) => {
    const opponent = r.home === id ? r.away : r.home;
    const previous = before(rows, r.kickoff, r.year),
      history = recent(previous, opponent);
    if (history.length < goalModel.recentMatches)
      return {
        gf: r.home === id ? r.homeGoals : r.awayGoals,
        ga: r.home === id ? r.awayGoals : r.homeGoals,
      };
    const strength = rates(history, opponent),
      average = (base.home + base.away) / 2;
    if (average <= 0)
      return {
        gf: r.home === id ? r.homeGoals : r.awayGoals,
        ga: r.home === id ? r.awayGoals : r.homeGoals,
      };
    adjusted++;
    return {
      gf:
        (r.home === id ? r.homeGoals : r.awayGoals) /
        clamp((strength.defence + average) / (2 * average), 0.5, 2),
      ga:
        (r.home === id ? r.awayGoals : r.homeGoals) /
        clamp((strength.attack + average) / (2 * average), 0.5, 2),
    };
  });
  return {
    attack: mean(corrected, (r) => r.gf),
    defence: mean(corrected, (r) => r.ga),
    raw,
    adjusted,
    sample: own.length,
    ids: own.map((r) => r.id),
  };
}
export function poissonMarkets(homeRate, awayRate) {
  if (
    ![homeRate, awayRate].every((n) => Number.isFinite(n) && n >= 0 && n <= 6)
  )
    throw Error("Intensités de buts invalides (0 à 6).");
  const distribution = (lambda) => {
    const p = [Math.exp(-lambda)];
    for (let i = 1; i <= 40; i++) p.push((p[i - 1] * lambda) / i);
    return p;
  };
  const h = distribution(homeRate),
    a = distribution(awayRate);
  const sum = {
    home: 0,
    draw: 0,
    away: 0,
    btts_yes: 0,
    home_scores: 0,
    away_scores: 0,
    over_1_5: 0,
    over_2_5: 0,
    over_3_5: 0,
  };
  let norm = 0;
  for (let i = 0; i < h.length; i++)
    for (let j = 0; j < a.length; j++) {
      const p = h[i] * a[j];
      norm += p;
      sum[i > j ? "home" : i === j ? "draw" : "away"] += p;
      if (i && j) sum.btts_yes += p;
      if (i) sum.home_scores += p;
      if (j) sum.away_scores += p;
      for (const n of [1, 2, 3]) if (i + j > n) sum[`over_${n}_5`] += p;
    }
  for (const k of Object.keys(sum)) sum[k] /= norm;
  for (const [yes, no] of [
    ["btts_yes", "btts_no"],
    ["home_scores", "home_blank"],
    ["away_scores", "away_blank"],
    ["over_1_5", "under_1_5"],
    ["over_2_5", "under_2_5"],
    ["over_3_5", "under_3_5"],
  ])
    sum[no] = 1 - sum[yes];
  const probabilities = validateProbabilities(
    Object.fromEntries(keys.map((k) => [k, sum[k]])),
  );
  return { probabilities, markets: sum, odds: theoreticalOdds(probabilities) };
}
export function estimateGoals({
  dataset,
  records = predictionRecords(dataset),
  homeId,
  awayId,
  year,
  cutoff = new Date().toISOString(),
  venue = "home",
  competitionId,
}) {
  const unavailable = (reason) => ({
    status: "unavailable",
    reason,
    modelVersion: goalModel.version,
    probabilities: null,
    markets: null,
  });
  if (
    !homeId ||
    !awayId ||
    homeId === awayId ||
    !finiteDate(cutoff) ||
    !["home", "away", "neutral"].includes(venue)
  )
    return unavailable("Choisissez deux clubs distincts et un terrain valide.");
  const eligible = before(records, cutoff, Number(year)),
    hr = recent(eligible, homeId),
    ar = recent(eligible, awayId);
  if (hr.length < 5 || ar.length < 5)
    return unavailable(
      `Cinq résultats antérieurs exploitables par équipe sont requis (${hr.length}/5 et ${ar.length}/5).`,
    );
  const origin = (id) =>
    (dataset.seasons || []).find(
      (s) =>
        s.start_year === Number(year) &&
        (dataset.members || []).some(
          (m) => m.season_id === s.id && m.team_id === id,
        ) &&
        (dataset.competitions || []).some(
          (c) => c.id === s.competition_id && c.type === "league",
        ),
    )?.competition_id;
  const common = pool(eligible, competitionId),
    hp = common || pool(eligible, origin(homeId)),
    ap = common || pool(eligible, origin(awayId));
  if (!hp || !ap)
    return unavailable(
      "Au moins 30 résultats antérieurs du championnat de référence sont requis pour chaque club.",
    );
  const h = sideRates(eligible, homeId, hp),
    a = sideRates(eligible, awayId, ap),
    neutralH = (hp.home + hp.away) / 2,
    neutralA = (ap.home + ap.away) / 2;
  const baseH =
      venue === "neutral" ? neutralH : venue === "away" ? hp.away : hp.home,
    baseA =
      venue === "neutral" ? neutralA : venue === "away" ? ap.home : ap.away;
  // Same shrinkage structure as _arena_probs: population prior + recent attack/opponent defence.
  const lambdaH = clamp(
      (1 - goalModel.mix) * baseH +
        (goalModel.mix * (h.attack + a.defence)) / 2,
      0.05,
      6,
    ),
    lambdaA = clamp(
      (1 - goalModel.mix) * baseA +
        (goalModel.mix * (a.attack + h.defence)) / 2,
      0.05,
      6,
    );
  return {
    status: "estimated",
    modelVersion: goalModel.version,
    ...poissonMarkets(lambdaH, lambdaA),
    expectedGoals: { home: lambdaH, away: lambdaA },
    quality: {
      home: h.sample,
      away: a.sample,
      poolHome: hp.count,
      poolAway: ap.count,
      opponentAdjusted: h.adjusted + a.adjusted,
      cutoff,
      historyIds: [...new Set([...h.ids, ...a.ids])],
      crossCompetition: origin(homeId) !== origin(awayId),
    },
    secondary: {
      corners: "Modèle de corners non calibré.",
      shotsOnTarget: "Modèle de tirs cadrés non calibré.",
      playerShots: "Données individuelles et compositions indisponibles.",
    },
  };
}
export function evaluateGoals(
  dataset,
  { cutoff = new Date().toISOString(), year, limit = 60 } = {},
) {
  const records = predictionRecords(dataset),
    eligible = before(records, cutoff, Number(year)).slice(
      -Math.min(120, Math.max(1, limit)),
    );
  const bins = Array.from({ length: 10 }, (_, index) => ({
    from: index / 10,
    to: (index + 1) / 10,
    count: 0,
    predicted: 0,
    observed: 0,
  }));
  let total = 0,
    brier = 0,
    baselineBrier = 0,
    binaryBrier = 0,
    binaryCount = 0;
  for (const r of eligible) {
    const forecast = estimateGoals({
      dataset,
      records,
      homeId: r.home,
      awayId: r.away,
      year: r.year,
      cutoff: r.kickoff,
      competitionId: r.competition,
    });
    if (forecast.status !== "estimated") continue;
    const previous = before(records, r.kickoff, r.year).filter(
      (x) => x.competition === r.competition,
    );
    if (previous.length < goalModel.minimumPool) continue;
    const frequencies = { home: 0, draw: 0, away: 0 };
    for (const x of previous)
      frequencies[
        x.homeGoals > x.awayGoals
          ? "home"
          : x.homeGoals === x.awayGoals
            ? "draw"
            : "away"
      ]++;
    const outcome =
      r.homeGoals > r.awayGoals
        ? "home"
        : r.homeGoals === r.awayGoals
          ? "draw"
          : "away";
    for (const k of keys) {
      const p = forecast.probabilities[k],
        y = Number(k === outcome),
        bucket = bins[Math.min(9, Math.floor(p * 10))];
      brier += (p - y) ** 2;
      baselineBrier += (frequencies[k] / previous.length - y) ** 2;
      bucket.count++;
      bucket.predicted += p;
      bucket.observed += y;
    }
    const events = {
      btts_yes: r.homeGoals > 0 && r.awayGoals > 0,
      home_scores: r.homeGoals > 0,
      away_scores: r.awayGoals > 0,
      over_1_5: r.homeGoals + r.awayGoals > 1,
      over_2_5: r.homeGoals + r.awayGoals > 2,
      over_3_5: r.homeGoals + r.awayGoals > 3,
    };
    for (const [key, y] of Object.entries(events)) {
      binaryBrier += (forecast.markets[key] - Number(y)) ** 2;
      binaryCount++;
    }
    total++;
  }
  return {
    status: total >= goalModel.minimumValidation ? "evaluated" : "insufficient",
    sample: total,
    minimum: goalModel.minimumValidation,
    brier: total ? brier / total : null,
    baselineBrier: total ? baselineBrier / total : null,
    binaryBrier: binaryCount ? binaryBrier / binaryCount : null,
    bins: bins.map((b) => ({
      ...b,
      predicted: b.count ? b.predicted / b.count : null,
      observed: b.count ? b.observed / b.count : null,
    })),
    scope:
      "Rejeu chronologique, paramètres fixes ; ce résultat ne certifie pas une calibration hors échantillon.",
  };
}
// Largest remainder allocation keeps displayed tenths at exactly 100.0%.
export function displayProbabilities(probabilities) {
  validateProbabilities(probabilities);
  const units = keys.map((k) => Math.floor(probabilities[k] * 1000));
  const order = keys
    .map((k, i) => ({ i, remainder: probabilities[k] * 1000 - units[i] }))
    .sort((a, b) => b.remainder - a.remainder);
  const remaining = 1000 - units.reduce((a, b) => a + b, 0);
  for (let n = 0; n < remaining; n++) units[order[n].i]++;
  return Object.fromEntries(keys.map((k, i) => [k, units[i] / 10]));
}
