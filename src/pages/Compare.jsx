import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { simulatedProfile } from "../services/simulation";
import { useFootball } from "../hooks/useFootball";
import { useTeamAnalysis, CalculationTrace } from "../components/TeamAnalysis";
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
function displayResults(team, analysis, demo) {
  if (demo)
    return {
      values: team.results || simulatedProfile(team.id).results,
      simulated: true,
    };
  if (analysis.results.length)
    return { values: analysis.results, simulated: false };
  return { values: simulatedProfile(team.id).results, simulated: true };
}
function TeamSummary({ team, analysis, demo }) {
  const results = displayResults(team, analysis, demo);
  return (
    <article className="comparison-team">
      <TeamBadge team={team} />
      <h2>{team.name}</h2>
      <p>{team.competitionName || "Équipe sélectionnée"}</p>
      <span className="eyebrow">FORME SIMULÉE</span>
      <FormValue score={team.score ?? simulatedProfile(team.id).score} demo />
      <p className="muted-text">
        {analysis.recent.loading && !demo
          ? "Chargement des résultats réels…"
          : results.simulated
            ? "5 résultats SIMULÉS · ancien → récent"
            : `${results.values.length} résultats API · ancien → récent`}
      </p>
      <Results results={results.values} demo={results.simulated} />
    </article>
  );
}
function StatisticalComparison({ left, right, leftTeam, rightTeam, demo }) {
  const a = displayResults(leftTeam, left, demo),
    b = displayResults(rightTeam, right, demo);
  return (
    <section className="analysis-panel">
      <h2>La dynamique en un coup d’œil</h2>
      <Notice>
        Les indices de forme sont simulés. Les résultats disponibles dans l’API
        sont conservés ; à défaut, un scénario de résultats est affiché avec la
        mention « simulé ». Aucun tir, bonus ou note n’est estimé.
      </Notice>
      <div className="comparison-result-sources">
        <span>
          {leftTeam.name} :{" "}
          {a.simulated ? "résultats SIMULÉS" : "résultats API"}
        </span>
        <span>
          {rightTeam.name} :{" "}
          {b.simulated ? "résultats SIMULÉS" : "résultats API"}
        </span>
      </div>
      {[
        ["V", "Victoires"],
        ["N", "Nuls"],
        ["D", "Défaites"],
      ].map(([key, label]) => {
        const countA = a.values.filter((result) => result === key).length,
          countB = b.values.filter((result) => result === key).length;
        return (
          <div className="comparison-metric" key={key}>
            <div>
              <strong>
                {countA} / {a.values.length}
              </strong>
              <span>{label}</span>
              <strong>
                {countB} / {b.values.length}
              </strong>
            </div>
            <div className="dual-result-bars" aria-hidden="true">
              <span style={{ width: `${(countA / a.values.length) * 100}%` }} />
              <span style={{ width: `${(countB / b.values.length) * 100}%` }} />
            </div>
          </div>
        );
      })}
      <p className="muted-text">
        Ces barres décrivent des résultats observés ou simulés, pas les chances
        de gagner le prochain match.
      </p>
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
                leftTeam={left.result.data}
                rightTeam={right.result.data}
                demo={left.result.mode === "demo"}
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
