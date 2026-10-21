import { useEffect, useMemo, useState } from "react";
import {
  estimateGoals,
  evaluateGoals,
  fairOdd,
  displayProbabilities,
} from "../engines/goalPredictionEngine";
import { externalOdds, compareOdds } from "../services/externalOdds";

const percent = (p) =>
  `${(p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const odd = (p) =>
  fairOdd(p)?.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) || "—";
function marketGroups(home, away) {
  return [
    {
      label: "Les deux équipes marquent",
      keys: [
        ["btts_yes", "Oui"],
        ["btts_no", "Non"],
      ],
    },
    {
      label: `${home} marque`,
      keys: [
        ["home_scores", "Oui"],
        ["home_blank", "Non"],
      ],
    },
    {
      label: `${away} marque`,
      keys: [
        ["away_scores", "Oui"],
        ["away_blank", "Non"],
      ],
    },
    ...[1, 2, 3].map((n) => ({
      label: `Total de buts · ${n},5`,
      keys: [
        [`over_${n}_5`, `Plus de ${n},5`],
        [`under_${n}_5`, `Moins de ${n},5`],
      ],
    })),
  ];
}
export default function ComparatorForecast({
  dataset,
  home,
  away,
  year,
  venue,
  match,
  cutoff,
  mode,
}) {
  const [all, setAll] = useState(false),
    [odds, setOdds] = useState(null);
  const result = useMemo(
    () =>
      estimateGoals({
        dataset,
        homeId: home.id,
        awayId: away.id,
        year,
        venue,
        cutoff,
        competitionId: match?.competition.id,
      }),
    [dataset, home.id, away.id, year, venue, cutoff, match?.competition.id],
  );
  const validation = useMemo(
    () => evaluateGoals(dataset, { cutoff, year }),
    [dataset, cutoff, year],
  );
  const identity = match?.id;
  useEffect(() => {
    setAll(false);
    setOdds(null);
    if (mode !== "real" || !match) return;
    let active = true;
    const controller = new AbortController();
    externalOdds
      .getQuotes(match, { signal: controller.signal })
      .then((value) => {
        if (active) setOdds({ id: identity, ...value });
      })
      .catch(() => {
        if (active)
          setOdds({
            id: identity,
            status: "error",
            quotes: [],
            reason: "Cotes externes indisponibles.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    identity,
    mode,
    home.id,
    away.id,
    match?.kickoff,
    match?.competition.id,
    match?.season,
    match?.timeKnown,
  ]);
  const currentOdds = odds?.id === identity ? odds : null;
  if (result.status !== "estimated")
    return (
      <section className="comparator-forecast" aria-labelledby="forecast-title">
        <h2 id="forecast-title">Probabilités indisponibles</h2>
        <p role="status">{result.reason}</p>
        {mode === "real" && (
          <div className="comparator-external">
            <h3>Cotes bookmakers</h3>
            <p role="status">
              {currentOdds?.reason ||
                (currentOdds?.status === "available"
                  ? "Cotes externes actualisées."
                  : "Vérification des cotes externes…")}
            </p>
          </div>
        )}
        <p className="muted-text">
          Seuls les résultats publiés, identifiés et disponibles avant la date
          d’analyse sont utilisés.
        </p>
      </section>
    );
  const shown = displayProbabilities(result.probabilities),
    groups = marketGroups(home.name, away.name);
  const highlights = groups
    .map((g) => {
      const [key, label] = [...g.keys].sort(
        (a, b) => result.markets[b[0]] - result.markets[a[0]],
      )[0];
      return {
        group: g.label,
        key,
        label,
        p: result.markets[key],
        family:
          key.startsWith("over_") || key.startsWith("under_")
            ? "total"
            : g.label,
      };
    })
    .sort((a, b) => b.p - a.p)
    .filter(
      (item, index, items) =>
        items.findIndex((other) => other.family === item.family) === index,
    )
    .slice(0, 3);
  return (
    <section className="comparator-forecast" aria-labelledby="forecast-title">
      <header className="comparator-forecast-heading">
        <h2 id="forecast-title">
          {mode === "simulation"
            ? "Probabilités théoriques"
            : "Probabilités du match"}
        </h2>
        <span className="status-pill">Modèle expérimental</span>
      </header>
      <p className="comparator-note">
        Estimation Poisson, distincte de l’indice de forme et sans garantie de
        résultat.
      </p>
      <div className="comparator-probabilities" aria-label="Issue du match">
        {[
          ["home", home.name],
          ["draw", "Match nul"],
          ["away", away.name],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>
              {shown[key].toLocaleString("fr-FR", { minimumFractionDigits: 1 })}{" "}
              %
            </strong>
            <div
              className="comparator-probability-track"
              role="img"
              aria-label={`${label} : ${shown[key]} %`}
            >
              <span style={{ width: `${shown[key]}%` }} />
            </div>
            <small>Cote théorique {odd(result.probabilities[key])}</small>
          </div>
        ))}
      </div>
      <h3>À retenir</h3>
      <div className="comparator-highlights">
        {highlights.map((h) => (
          <div key={h.key}>
            <span>{h.group}</span>
            <strong>
              {h.label} <b>{percent(h.p)}</b>
            </strong>
            <small>Cote théorique {odd(h.p)}</small>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-link comparator-disclosure"
        onClick={() => setAll(!all)}
        aria-expanded={all}
        aria-controls="all-goal-markets"
      >
        {all ? "Réduire les prédictions" : "Voir toutes les prédictions"}{" "}
        {all ? "−" : "+"}
      </button>
      {all && (
        <div id="all-goal-markets" className="comparator-market-list">
          {groups.map((g) => (
            <div key={g.label}>
              <h3>{g.label}</h3>
              {g.keys.map(([key, label]) => (
                <div className="comparator-market-row" key={key}>
                  <span>{label}</span>
                  <strong>{percent(result.markets[key])}</strong>
                  <small>Cote théorique {odd(result.markets[key])}</small>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {mode === "real" && (
        <div className="comparator-external">
          <h3>Cotes bookmakers</h3>
          <p role="status">
            {currentOdds?.reason ||
              (currentOdds?.status === "available"
                ? "Cotes externes actualisées."
                : "Vérification des cotes externes…")}
          </p>
          {currentOdds?.quotes?.map((q, i) => {
            const values = compareOdds(result.markets[q.selection], q.decimal);
            return (
              <div className="comparator-market-row" key={i}>
                <span>
                  {q.bookmaker} · {q.selection}
                </span>
                <strong>{q.decimal.toFixed(2)}</strong>
                <small>
                  Implicite brute {percent(values.impliedProbability)} · écart
                  estimé {percent(values.theoreticalValue)}
                </small>
              </div>
            );
          })}
        </div>
      )}
      <details className="comparator-validation">
        <summary>Historique utilisé et validation</summary>
        <p>
          {result.quality.home}/5 matchs pour {home.name} ·{" "}
          {result.quality.away}/5 pour {away.name} · références :{" "}
          {result.quality.poolHome} et {result.quality.poolAway} résultats.
        </p>
        <p>
          Buts attendus par le modèle : {result.expectedGoals.home.toFixed(2)} /{" "}
          {result.expectedGoals.away.toFixed(2)} · correction des adversaires :{" "}
          {result.quality.opponentAdjusted}/10 observations.
        </p>
        {result.quality.crossCompetition && (
          <p>
            Comparaison entre compétitions : leur différence de niveau n’est pas
            calibrée.
          </p>
        )}
        <p>
          Arrêt des données : {new Date(cutoff).toLocaleString("fr-FR")} ; les
          rencontres du même jour sont exclues par prudence.
        </p>
        <p>
          {validation.sample} rencontres rejouées chronologiquement ·{" "}
          {validation.brier == null
            ? "Brier indisponible"
            : `Brier 1/N/2 : ${validation.brier.toFixed(3)} (0 à 2), référence fréquences : ${validation.baselineBrier.toFixed(3)}`}
          .
        </p>
        <p>
          {validation.status === "insufficient"
            ? `Au moins ${validation.minimum} rencontres évaluables sont requises ; la validation est insuffisante.`
            : validation.scope}
        </p>
        {validation.sample > 0 &&
          validation.brier >= validation.baselineBrier && (
            <p>
              Sur cet échantillon, le modèle n’améliore pas la référence des
              fréquences historiques.
            </p>
          )}
        {validation.binaryBrier != null && (
          <p>
            Brier moyen des six événements binaires :{" "}
            {validation.binaryBrier.toFixed(3)} (0 à 1).
          </p>
        )}
        {validation.sample > 0 && (
          <div className="table-scroll">
            <table className="official-table">
              <caption>Calibration 1/N/2 par tranche</caption>
              <thead>
                <tr>
                  <th>Probabilité annoncée</th>
                  <th>Fréquence observée</th>
                  <th>Effectif</th>
                </tr>
              </thead>
              <tbody>
                {validation.bins
                  .filter((b) => b.count)
                  .map((b) => (
                    <tr key={b.from}>
                      <td>{percent(b.predicted)}</td>
                      <td>{percent(b.observed)}</td>
                      <td>{b.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          Version {result.modelVersion} · indépendance des buts supposée ; ni
          blessures ni compositions intégrées.
        </p>
      </details>
      <details className="comparator-validation">
        <summary>Autres marchés</summary>
        <ul>
          <li>Corners : {result.secondary.corners}</li>
          <li>Tirs cadrés par équipe : {result.secondary.shotsOnTarget}</li>
          <li>Tirs cadrés par joueur : {result.secondary.playerShots}</li>
        </ul>
      </details>
    </section>
  );
}
