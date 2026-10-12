import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  useTeamAnalysis,
  metricLabels,
  CalculationTrace,
} from "../components/TeamAnalysis";
import {
  PageHeading,
  DataState,
  TeamBadge,
  FormValue,
  Results,
  Notice,
} from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";
import CalcitoMascot from "../components/CalcitoMascot";

function TeamPicker({ label, value, onChange, excluded }) {
  const [search, setSearch] = useState("");
  const state = useFootball("teams", { search });
  return (
    <div className="team-picker">
      <label>
        {label}
        <input
          type="search"
          placeholder="Rechercher dans tous les championnats"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <label className="picker-select">
        Équipe sélectionnée
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Sélectionner une équipe</option>
          {value && !state.result?.data.some((team) => team.id === value) && (
            <option value={value}>Sélection actuelle</option>
          )}
          {state.result?.data.map((team) => (
            <option
              disabled={team.id === excluded}
              key={team.id}
              value={team.id}
            >
              {team.name}
              {team.competitionName ? ` · ${team.competitionName}` : ""}
            </option>
          ))}
        </select>
      </label>
      {state.loading && <span role="status">Recherche…</span>}
      {state.error && (
        <span className="field-error" role="alert">
          {state.error.message} <button onClick={state.retry}>Réessayer</button>
        </span>
      )}
    </div>
  );
}
function TeamSummary({ team, analysis, demo }) {
  return (
    <article className="comparison-team">
      <TeamBadge team={team} />
      <h2>{team.name}</h2>
      <p>{team.competitionName || "Compétition non renseignée"}</p>
      <span className="eyebrow">FORME CALCITO</span>
      <FormValue
        score={demo ? team.score : analysis.engine.score}
        demo={demo}
      />
      <p className="muted-text">Cinq derniers résultats · ancien → récent</p>
      {analysis.recent.loading && !demo ? (
        <p role="status">Chargement…</p>
      ) : analysis.recent.error ? (
        <p role="alert">{analysis.recent.error.message}</p>
      ) : (
        <Results results={demo ? team.results : analysis.results} demo={demo} />
      )}
    </article>
  );
}
function StatisticalComparison({ left, right }) {
  const a = left.statistics.result?.data,
    b = right.statistics.result?.data;
  const compatible =
    a &&
    b &&
    Date.parse(a.periodStart) === Date.parse(b.periodStart) &&
    Date.parse(a.periodEnd) === Date.parse(b.periodEnd) &&
    a.sampleSize === b.sampleSize;
  return (
    <section className="analysis-panel">
      <h2>Statistiques comparatives</h2>
      {left.statistics.loading || right.statistics.loading ? (
        <p role="status">Chargement des statistiques…</p>
      ) : (
        <>
          {[left.statistics, right.statistics].some((state) => state.error) && (
            <div role="alert">
              <p>Les statistiques d’au moins une équipe sont indisponibles.</p>
              <button
                className="button button-secondary"
                onClick={() => {
                  left.statistics.retry();
                  right.statistics.retry();
                }}
              >
                Réessayer les statistiques
              </button>
            </div>
          )}
          {!compatible ? (
            <Notice>
              Données comparables indisponibles : une même période et un même
              nombre de matchs sont nécessaires. Aucune force ou faiblesse n’est
              déduite de statistiques manquantes.
            </Notice>
          ) : (
            <>
              <p className="muted-text">
                Même période · {a.sampleSize} matchs par équipe
              </p>
              {a.metrics.map((metric) => {
                const other = b.metrics.find(
                  (item) => item.key === metric.key,
                )?.value;
                const comparable = metric.value != null && other != null;
                const total = comparable ? metric.value + other : 0;
                return (
                  <div className="comparison-metric" key={metric.key}>
                    <div>
                      <strong>{metric.value ?? "—"}</strong>
                      <span>{metricLabels[metric.key]}</span>
                      <strong>{other ?? "—"}</strong>
                    </div>
                    {comparable && total > 0 && (
                      <div
                        className="split-bar"
                        role="img"
                        aria-label={`${metricLabels[metric.key]} : ${metric.value} contre ${other}`}
                      >
                        <span
                          style={{ width: `${(metric.value / total) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="muted-text">
                Les barres représentent la part de chaque valeur dans leur
                total, pas une probabilité de victoire.
              </p>
            </>
          )}
          <h3>Forces et faiblesses</h3>
          <p className="muted-text">
            L’analyse qualitative reste en développement. Aucun diagnostic
            automatique n’est produit sans critères validés.
          </p>
        </>
      )}
      <SourceCaption result={left.statistics.result} />
      <SourceCaption result={right.statistics.result} />
    </section>
  );
}
export default function Compare() {
  const [params, setParams] = useSearchParams();
  const leftId = params.get("team") || "",
    rightId = params.get("against") || "";
  const left = useFootball("team", leftId, { enabled: Boolean(leftId) });
  const right = useFootball("team", rightId, { enabled: Boolean(rightId) });
  const leftAnalysis = useTeamAnalysis(left.result?.data.id),
    rightAnalysis = useTeamAnalysis(right.result?.data.id);
  function setTeam(key, id) {
    const next = new URLSearchParams(params);
    if (id) next.set(key, id);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  const identical = Boolean(leftId && leftId === rightId);
  return (
    <section className="container page-content">
      <PageHeading
        label="DEUX ÉQUIPES. UN MÊME REPÈRE."
        title="Comparateur"
        description="Sélectionnez deux équipes, même de championnats différents. Comparez les dynamiques en gardant le contexte des données."
      />
      <div className="picker-grid">
        <TeamPicker
          label="Équipe A"
          value={leftId}
          onChange={(id) => setTeam("team", id)}
          excluded={rightId}
        />
        <button
          className="swap-button"
          aria-label="Permuter les équipes"
          disabled={!leftId || !rightId}
          onClick={() =>
            setParams({ team: rightId, against: leftId }, { replace: true })
          }
        >
          <ArrowLeftRight size={20} />
        </button>
        <TeamPicker
          label="Équipe B"
          value={rightId}
          onChange={(id) => setTeam("against", id)}
          excluded={leftId}
        />
      </div>
      {identical ? (
        <Notice>Choisissez deux équipes différentes pour les comparer.</Notice>
      ) : !leftId || !rightId ? (
        <CalcitoMascot
          variant="compare"
          title="Le contexte fait la différence."
          message="Choisissez vos deux équipes ci-dessus. L’indice de forme sera présenté séparément des statistiques et des futurs pronostics."
        />
      ) : (
        <DataState
          loading={left.loading || right.loading}
          error={left.error || right.error}
          retry={() => {
            left.retry();
            right.retry();
          }}
        >
          {left.result && right.result && (
            <>
              <div className="comparison-summaries">
                <TeamSummary
                  team={left.result.data}
                  analysis={leftAnalysis}
                  demo={left.result.mode === "demo"}
                />
                <span className="comparison-vs">VS</span>
                <TeamSummary
                  team={right.result.data}
                  analysis={rightAnalysis}
                  demo={right.result.mode === "demo"}
                />
              </div>
              <StatisticalComparison
                left={leftAnalysis}
                right={rightAnalysis}
              />
              <div className="detail-grid">
                <CalculationTrace
                  analysis={leftAnalysis}
                  demo={left.result.mode === "demo"}
                />
                <CalculationTrace
                  analysis={rightAnalysis}
                  demo={right.result.mode === "demo"}
                />
              </div>
              <SourceCaption result={left.result} />
              <SourceCaption result={right.result} />
            </>
          )}
        </DataState>
      )}
    </section>
  );
}
