import { useFootball } from "../hooks/useFootball";
import { calculateCalcitoForm } from "../engines/calcitoEngine";
import { SourceCaption } from "./DataContext";
import { Results, Notice } from "./FootballUI";

export function useTeamAnalysis(id) {
  const recent = useFootball("recentMatches", id, { enabled: Boolean(id) });
  const statistics = useFootball("statistics", id, { enabled: false });
  const engine = calculateCalcitoForm({
    teamId: id,
    matches: recent.result?.data || [],
  });
  const results = [...engine.trace]
    .reverse()
    .map((match) => match.result || "?");
  return { recent, statistics, engine, results };
}
export function CalculationTrace({ analysis, demo }) {
  const { recent, engine } = analysis;
  return (
    <section className="analysis-panel">
      <h2>Derniers résultats disponibles</h2>
      <Notice>
        Les résultats ci-dessous proviennent des matchs fournis par l’API. Les
        éventuels indices simulés sont présentés séparément et n’utilisent pas
        les tirs ou les notes d’équipe.
      </Notice>
      {recent.loading ? (
        <p role="status">Chargement des matchs…</p>
      ) : recent.error ? (
        <div role="alert">
          <p>{recent.error.message}</p>
          <button className="button button-secondary" onClick={recent.retry}>
            Réessayer
          </button>
        </div>
      ) : !engine.trace.length ? (
        <p className="muted-text">
          Aucun résultat réel disponible pour cette équipe.
        </p>
      ) : (
        <>
          <Results results={analysis.results} demo={demo} />
          <div className="trace-list">
            {engine.trace.map((match) => (
              <div className="trace-match" key={match.matchId}>
                <header>
                  <strong>vs {match.opponent}</strong>
                  <span>
                    {new Date(match.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                    {match.result || "Résultat indisponible"}
                  </span>
                </header>
                <p className="result-score">
                  {match.goalsFor ?? "—"} – {match.goalsAgainst ?? "—"}
                </p>
              </div>
            ))}
          </div>
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
