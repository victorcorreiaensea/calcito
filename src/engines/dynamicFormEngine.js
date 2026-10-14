import { dynamicFormModel as model } from "../config/dynamicFormModel.js";
import { calculateResultsForm } from "./resultsFormEngine.js";
import { DATE_ONLY_MARKER } from "../domain/matchImport.js";
const validGoal = (n) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 32767;
const clamp = (n) => Math.max(0, Math.min(100, n));
export function calculateSurprise({
  ownBefore,
  opponentBefore,
  goalsFor,
  goalsAgainst,
  venue,
  reliable = false,
}) {
  if (
    ![ownBefore, opponentBefore].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 100,
    ) ||
    !validGoal(goalsFor) ||
    !validGoal(goalsAgainst) ||
    !["home", "away"].includes(venue)
  )
    return { expected: null, surprise: null, adjustment: null, label: null };
  const expected =
    1 /
    (1 +
      Math.exp(
        -(
          ownBefore -
          opponentBefore +
          (venue === "home" ? model.homeAdvantage : -model.homeAdvantage)
        ) / model.expectationScale,
      ));
  const actual =
    goalsFor > goalsAgainst ? 1 : goalsFor === goalsAgainst ? 0.5 : 0;
  const surprise = actual - expected;
  const gap = opponentBefore - ownBefore;
  let label = null;
  if (
    reliable &&
    actual === 1 &&
    gap >= model.exploitGap &&
    surprise >= model.exploitSurprise
  )
    label = "Exploit Calcito";
  else if (
    reliable &&
    actual === 1 &&
    gap >= model.performanceGap &&
    surprise >= model.performanceSurprise
  )
    label = "Belle performance";
  else if (
    reliable &&
    actual === 0.5 &&
    gap >= model.drawGap &&
    surprise >= model.drawSurprise
  )
    label = "Nul arraché";
  return {
    expected,
    surprise,
    adjustment: model.surpriseLimit * surprise,
    label,
  };
}
function stateScore(rows = []) {
  const recent = rows.slice(-model.window);
  return (
    (recent.reduce((n, r) => n + r.performance, 0) +
      (model.window - recent.length) * model.initial) /
    model.window
  );
}
export function reconstructDynamicForms(
  dataset,
  year,
  { asOf = Date.now(), modelVersion = model.version } = {},
) {
  if (![model.version, model.intrinsicVersion].includes(modelVersion))
    throw new Error("Version de formule non prise en charge");
  const seasonIds = new Set(
    dataset.seasons
      .filter((s) => s.start_year === Number(year))
      .map((s) => s.id),
  );
  const entries = [];
  const excluded = [];
  for (const m of dataset.matches || []) {
    if (
      !seasonIds.has(m.season_id) ||
      !m.is_published ||
      m.status !== "finished"
    )
      continue;
    if (
      !validGoal(m.goals_home) ||
      !validGoal(m.goals_away) ||
      !Number.isFinite(Date.parse(m.kickoff)) ||
      m.home_team_id === m.away_team_id
    ) {
      excluded.push({
        id: m.id,
        teamIds: [m.home_team_id, m.away_team_id].filter(Boolean),
        reason: "Résultat incomplet ou invalide",
      });
      continue;
    }
    if (
      (m.comment || "").includes(DATE_ONLY_MARKER)
        ? m.kickoff.slice(0, 10) > new Date(asOf).toISOString().slice(0, 10)
        : Date.parse(m.kickoff) > asOf
    ) {
      excluded.push({
        id: m.id,
        teamIds: [m.home_team_id, m.away_team_id].filter(Boolean),
        reason: "Rencontre datée dans le futur",
      });
      continue;
    }
    entries.push({
      id: m.id,
      kickoff: m.kickoff,
      dateOnly: (m.comment || "").includes(DATE_ONLY_MARKER),
      home: m.home_team_id,
      away: m.away_team_id,
      gf: m.goals_home,
      ga: m.goals_away,
      quick: false,
    });
  }
  for (const r of dataset.simplified || []) {
    if (
      !r.is_published ||
      r.converted_at ||
      r.season_start_year !== Number(year)
    )
      continue;
    if (
      !validGoal(r.goals_for) ||
      !validGoal(r.goals_against) ||
      !Number.isFinite(Date.parse(r.kickoff)) ||
      !["home", "away"].includes(r.venue)
    ) {
      excluded.push({
        id: r.id,
        teamIds: [r.team_id],
        reason: "Résultat rapide incomplet",
      });
      continue;
    }
    if (r.kickoff.slice(0, 10) > new Date(asOf).toISOString().slice(0, 10)) {
      excluded.push({
        id: r.id,
        teamIds: [r.team_id],
        reason: "Rencontre datée dans le futur",
      });
      continue;
    }
    entries.push({
      id: r.id,
      kickoff: r.kickoff,
      dateOnly: true,
      quick: true,
      tracked: r.team_id,
      opponent: r.opponent_team_id || null,
      opponentName: r.opponent_name,
      venue: r.venue,
      gf: r.goals_for,
      ga: r.goals_against,
    });
  }
  const impreciseDays = new Set(
    entries.filter((e) => e.dateOnly).map((e) => e.kickoff.slice(0, 10)),
  );
  for (const e of entries)
    e.batch = impreciseDays.has(e.kickoff.slice(0, 10))
      ? `${e.kickoff.slice(0, 10)}T00:00:00.000Z`
      : new Date(e.kickoff).toISOString();
  entries.sort(
    (a, b) => a.batch.localeCompare(b.batch) || a.id.localeCompare(b.id),
  );
  const histories = new Map(),
    matches = new Map();
  for (let start = 0; start < entries.length;) {
    let end = start + 1;
    while (end < entries.length && entries[end].batch === entries[start].batch)
      end++;
    const batch = entries.slice(start, end),
      counts = new Map();
    for (const e of batch)
      for (const id of e.quick ? [e.tracked] : [e.home, e.away])
        counts.set(id, (counts.get(id) || 0) + 1);
    const pending = [];
    // Every performance in the batch reads the same frozen, previous ledger.
    for (const e of batch) {
      const affected = e.quick ? [e.tracked] : [e.home, e.away];
      if (affected.some((id) => counts.get(id) > 1)) {
        excluded.push({
          id: e.id,
          teamIds: affected,
          reason:
            "Plusieurs rencontres pour une équipe sans ordre chronologique fiable",
        });
        continue;
      }
      const sides = e.quick
        ? [
            {
              id: e.tracked,
              opponent: e.opponent,
              gf: e.gf,
              ga: e.ga,
              venue: e.venue,
            },
          ]
        : [
            { id: e.home, opponent: e.away, gf: e.gf, ga: e.ga, venue: "home" },
            { id: e.away, opponent: e.home, gf: e.ga, ga: e.gf, venue: "away" },
          ];
      const record = {
        id: e.id,
        kickoff: e.kickoff,
        dateOnly: e.dateOnly,
        conservativeDay: impreciseDays.has(e.kickoff.slice(0, 10)),
        version: modelVersion,
        sides: [],
      };
      for (const s of sides) {
        const prior = histories.get(s.id) || [],
          opp = s.opponent ? histories.get(s.opponent) || [] : null;
        const before = stateScore(prior),
          opponentBefore = opp ? stateScore(opp) : null;
        const initialized = prior.length < model.window,
          opponentInitialized = opp ? opp.length < model.window : null;
        const intrinsicModel = calculateResultsForm(
          Array(5).fill({
            goals_for: s.gf,
            goals_against: s.ga,
            venue: s.venue,
          }),
        );
        const intrinsic = intrinsicModel.score;
        const surprise =
          modelVersion === model.intrinsicVersion
            ? { expected: null, surprise: null, adjustment: null, label: null }
            : calculateSurprise({
                ownBefore: before,
                opponentBefore,
                goalsFor: s.gf,
                goalsAgainst: s.ga,
                venue: s.venue,
                reliable: !initialized && opponentInitialized === false,
              });
        const performance = clamp(intrinsic + (surprise.adjustment ?? 0));
        const appliedAdjustment =
          surprise.adjustment === null ? null : performance - intrinsic;
        const row = {
          matchId: e.id,
          teamId: s.id,
          opponentId: s.opponent,
          opponentName:
            dataset.teams?.find((t) => t.id === s.opponent)?.name ||
            e.opponentName ||
            null,
          kickoff: e.kickoff,
          batch: e.batch,
          dateOnly: e.dateOnly,
          conservativeDay: record.conservativeDay,
          goalsFor: s.gf,
          goalsAgainst: s.ga,
          venue: s.venue,
          before,
          opponentBefore,
          beforeInitialized: initialized,
          opponentInitialized,
          intrinsic,
          intrinsicBreakdown: intrinsicModel.breakdown[0],
          ...surprise,
          appliedAdjustment,
          performance,
          after: stateScore([...prior, { performance }]),
          sampleSize: Math.min(5, prior.length + 1),
          afterInitialized: prior.length + 1 < 5,
          version: modelVersion,
        };
        row.delta = row.after - row.before;
        pending.push(row);
        record.sides.push(row);
      }
      for (const row of record.sides) {
        const other = record.sides.find((r) => r.teamId !== row.teamId);
        row.opponentAfter = other?.after ?? null;
        row.opponentAfterInitialized = other?.afterInitialized ?? null;
      }
      matches.set(e.id, record);
    }
    for (const r of pending)
      histories.set(r.teamId, [...(histories.get(r.teamId) || []), r]);
    start = end;
  }
  return {
    version: modelVersion,
    year: Number(year),
    histories,
    matches,
    excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
const cache = new WeakMap();
export function dynamicForms(dataset, year) {
  let years = cache.get(dataset);
  if (!years) {
    years = new Map();
    cache.set(dataset, years);
  }
  if (!years.has(Number(year)))
    years.set(Number(year), reconstructDynamicForms(dataset, year));
  return years.get(Number(year));
}
export function dynamicCoverage(dataset, teamId, year, coverage) {
  const result = dynamicForms(dataset, year),
    history = result.histories.get(teamId) || [],
    last = history.at(-1);
  const score = last && !last.afterInitialized ? last.after : null;
  return {
    ...coverage,
    score,
    status: score === null ? "unavailable" : "provisional",
    variant: "provisional",
    compatibilityGroup: score === null ? null : result.version,
    breakdown: history.slice(-5),
    dynamic: true,
    dynamicHistory: history,
    modelVersion: result.version,
    sampleSize: Math.min(5, history.length),
    missingMatches: Math.max(0, 5 - history.length),
    relativeKnown: history.slice(-5).filter((r) => r.surprise !== null).length,
    relativeReliable: history
      .slice(-5)
      .filter((r) => !r.beforeInitialized && r.opponentInitialized === false)
      .length,
    label:
      score === null
        ? "Cinq résultats chronologiques nécessaires"
        : "Indice dynamique provisoire",
    excluded: result.excluded.filter((e) => e.teamIds?.includes(teamId)).length,
  };
}
