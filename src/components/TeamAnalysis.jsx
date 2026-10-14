import { useFootball } from "../hooks/useFootball";
import { calculateCalcitoForm } from "../engines/calcitoEngine";
import { calcitoModel } from "../config/calcitoModel";
import { SourceCaption } from "./DataContext";
import { formCoverage, simplifiedModel } from "../domain/simplified";
import { Results, Notice } from "./FootballUI";

export function useTeamAnalysis(id, season = "") {
  const params = { teamId: id, season };
  const recent = useFootball("recentMatches", params, { enabled: Boolean(id) });
  const statistics = useFootball("statistics", params, {
    enabled: Boolean(id),
  });
  const engine = calculateCalcitoForm(
    {
      teamId: id,
      matches: recent.result?.data || [],
      competitionCoefficients: {
        ...calcitoModel.competitionCoefficients,
        ...Object.fromEntries(
          (recent.result?.data || [])
            .filter(
              (match) =>
                Number.isFinite(Number(match.competition.coefficient)) &&
                match.competition.coefficient != null,
            )
            .map((match) => [
              match.competition.id,
              Number(match.competition.coefficient),
            ]),
        ),
      },
    },
    { formula: calcitoModel.formula, formulaVersion: calcitoModel.version },
  );
  const results = [...engine.trace]
    .reverse()
    .map((match) => match.result || "?");
  const coverage = formCoverage(
    (recent.result?.data || []).map((m) => ({
      entry_type: m.entry_type || "complete",
      stats: m.manualStats,
      venue: m.home.id === id ? "home" : "away",
      goals_for: m.home.id === id ? m.goalsHome : m.goalsAway,
      goals_against: m.home.id === id ? m.goalsAway : m.goalsHome,
    })),
  );
  const shownEngine =
    engine.score == null && coverage.score != null
      ? {
          ...engine,
          score: coverage.score,
          status: "provisional",
          indexVariant: "provisional",
          formulaVersion: simplifiedModel.version,
        }
      : engine;
  return { recent, statistics, engine: shownEngine, results, coverage };
}
export function CalculationTrace({ analysis }) {
  const { recent, engine } = analysis;
  return (
    <section className="analysis-panel">
      <h2>Sources et données des cinq matchs</h2>
      <Notice>
        {engine.trace.length} / 5 matchs publiés dans la saison sélectionnée.
        {analysis.coverage.label}.
      </Notice>
      {analysis.coverage.status === "provisional" && (
        <Notice>
          Forme provisoire v2 : résultats, buts marqués et encaissés, bonus de
          terrain. Sur ces cinq matchs : {analysis.coverage.points} points sur
          15, {analysis.coverage.goalsFor} buts marqués et{" "}
          {analysis.coverage.goalsAgainst} encaissés. Les points sont un repère,
          pas la formule de l’indice. Les statistiques avancées absentes restent
          inconnues.
          {analysis.coverage.venueKnown < 5 &&
            " Terrain inconnu sur certains matchs : aucun bonus de terrain pour ces matchs."}
        </Notice>
      )}
      {recent.loading ? (
        <p role="status">Chargement des matchs…</p>
      ) : recent.error ? (
        <p role="alert">{recent.error.message}</p>
      ) : !engine.trace.length ? (
        <p className="muted-text">Aucun résultat publié pour cette équipe.</p>
      ) : (
        <>
          <Results results={analysis.results} demo={false} />
          <details className="missing-details">
            <summary>Consulter les résultats et leurs sources</summary>
            <div className="trace-list">
              {engine.trace.map((match) => (
                <div className="trace-match" key={match.matchId}>
                  <header>
                    <strong>vs {match.opponent}</strong>
                    <span>
                      {new Date(match.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                      {match.result || "Résultat indisponible"} ·{" "}
                      {match.venue === "home" ? "Domicile" : "Extérieur"}
                      {match.entryType === "simplified"
                        ? " · Résultat rapide"
                        : ""}
                    </span>
                  </header>
                  <p className="result-score">
                    {match.goalsFor ?? "—"} – {match.goalsAgainst ?? "—"}
                  </p>
                  <small>
                    Source : {match.sourceReference || "Non renseignée"}
                  </small>
                </div>
              ))}
            </div>
          </details>
          <details className="missing-details">
            <summary>Données attendues pour l’indice propriétaire</summary>
            <ul>
              {engine.missing.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            {!calcitoModel.formula && (
              <p>Formule propriétaire : non intégrée.</p>
            )}
            {engine.trace.map((match) => (
              <div key={match.matchId}>
                <strong>{match.opponent}</strong>
                <dl className="trace-source-stats">
                  {Object.entries({
                    shots: "Tirs",
                    bigChances: "Grosses occasions",
                    rating: "Note d’équipe",
                    bonuses: "Bonus fournis",
                  }).map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        {Array.isArray(match.statistics[key])
                          ? match.statistics[key].join(", ") ||
                            "Aucun bonus fourni"
                          : (match.statistics[key] ?? "Non renseigné")}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt>Coefficient de compétition</dt>
                    <dd>{match.coefficient ?? "Non défini"}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </details>
          <SourceCaption result={recent.result} />
        </>
      )}
    </section>
  );
}
export const metricLabels = {
  shotsPerMatch: "Tirs / match",
  shotsOnTargetPerMatch: "Tirs cadrés / match",
  woodworkPerMatch: "Poteaux / match",
  bigChancesPerMatch: "Grosses occasions / match",
  teamRating: "Note d’équipe",
};
export function TeamStatistics({ state }) {
  return (
    <section className="analysis-panel">
      <h2>Statistiques renseignées</h2>
      {state.loading ? (
        <p role="status">Chargement…</p>
      ) : state.error ? (
        <p role="alert">Statistiques indisponibles pour le moment.</p>
      ) : !state.result?.data ? (
        <p className="muted-text">
          Aucune statistique publiée. Une donnée manquante ne devient pas zéro.
        </p>
      ) : (
        <>
          <p className="muted-text">
            {state.result.data.sampleSize} matchs ·{" "}
            {new Date(state.result.data.periodStart).toLocaleDateString(
              "fr-FR",
            )}{" "}
            —{" "}
            {new Date(state.result.data.periodEnd).toLocaleDateString("fr-FR")}
          </p>
          <dl className="stat-grid">
            {state.result.data.metrics.map((metric) => (
              <div key={metric.key}>
                <dt>{metricLabels[metric.key]}</dt>
                <dd>
                  {metric.value === null
                    ? "—"
                    : Number(metric.value.toFixed(2))}
                </dd>
                <small>
                  {metric.available} / {state.result.data.sampleSize} valeurs
                  renseignées
                </small>
              </div>
            ))}
          </dl>
          <Notice>
            Une moyenne n’est affichée que lorsque toutes les valeurs de
            l’échantillon sont disponibles.
          </Notice>
        </>
      )}
      <SourceCaption result={state.result} />
    </section>
  );
}
