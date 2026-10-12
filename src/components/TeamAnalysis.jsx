import { useFootball } from "../hooks/useFootball";
import { calculateCalcitoForm } from "../engines/calcitoEngine";
import { SourceCaption } from "./DataContext";
import { Results, Notice } from "./FootballUI";

export function useTeamAnalysis(id) {
  const recent = useFootball("recentMatches", id, { enabled: Boolean(id) });
  const statistics = useFootball("statistics", id, { enabled: Boolean(id) });
  const engine = calculateCalcitoForm({
    teamId: id,
    matches: recent.result?.data || [],
  });
  const results = [...engine.trace]
    .reverse()
    .map((match) => match.result || "?");
  return { recent, statistics, engine, results };
}
const fields = {
  shots: "Tirs",
  bigChances: "Grosses occasions",
  rating: "Note d’équipe",
  bonuses: "Bonus",
  coefficient: "Coefficient",
};
export function CalculationTrace({ analysis, demo }) {
  const { recent, engine } = analysis;
  return (
    <section className="analysis-panel">
      <div className="panel-heading">
        <h2>Traçabilité du calcul</h2>
        <span className="status-pill">Non calculé</span>
      </div>
      <Notice>
        {demo
          ? "Les indices affichés sont des valeurs d’illustration, sans calcul. Aucune statistique de match n’est fabriquée."
          : "La formule propriétaire et les coefficients applicables restent à fournir. Aucun indice définitif n’est calculé."}
      </Notice>
      {recent.loading ? (
        <p role="status">Chargement des cinq derniers matchs…</p>
      ) : recent.error ? (
        <div role="alert">
          <p>{recent.error.message}</p>
          <button className="button button-secondary" onClick={recent.retry}>
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <Results results={demo ? [] : analysis.results} demo={demo} />
          {engine.trace.length > 0 && (
            <div className="trace-list">
              {engine.trace.map((match) => (
                <div className="trace-match" key={match.matchId}>
                  <header>
                    <strong>vs {match.opponent}</strong>
                    <span>
                      {new Date(match.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                      {match.result || "Résultat manquant"}
                    </span>
                  </header>
                  <dl>
                    {Object.entries(fields).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>
                          {key === "coefficient"
                            ? (match.coefficient ?? "Non défini")
                            : Array.isArray(match.statistics[key])
                              ? match.statistics[key].length
                                ? match.statistics[key].join(", ")
                                : "Aucun bonus fourni"
                              : (match.statistics[key] ?? "Manquant")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    Référence source : {match.sourceReference || "Non fournie"}
                  </small>
                </div>
              ))}
            </div>
          )}
          <details className="missing-details">
            <summary>
              {engine.missing.length} prérequis manquant
              {engine.missing.length > 1 ? "s" : ""}
            </summary>
            <ul>
              {engine.missing.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p>Formule propriétaire : non intégrée.</p>
          </details>
          <SourceCaption result={recent.result} />
        </>
      )}
    </section>
  );
}
export const metricLabels = {
  shotsPerMatch: "Tirs par match",
  bigChancesPerMatch: "Grosses occasions par match",
  teamRating: "Note d’équipe",
};
export function TeamStatistics({ state }) {
  return (
    <section className="analysis-panel">
      <h2>Statistiques disponibles</h2>
      {state.loading ? (
        <p role="status">Chargement des statistiques…</p>
      ) : state.error ? (
        <div role="alert">
          <p>{state.error.message}</p>
          <button className="button button-secondary" onClick={state.retry}>
            Réessayer
          </button>
        </div>
      ) : !state.result?.data ? (
        <p className="muted-text">
          Données indisponibles. Aucune valeur n’est estimée.
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
                <dd>{metric.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <SourceCaption result={state.result} />
    </section>
  );
}
