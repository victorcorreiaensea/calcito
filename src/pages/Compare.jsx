import FormEvolution from "../components/FormEvolution";
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
import { SourceCaption, SeasonSelect } from "../components/DataContext";
import CalcitoMascot from "../components/CalcitoMascot";

export function TeamPicker({ label, value, onChange, excluded, season }) {
  const [search, setSearch] = useState("");
  const state = useFootball("teams", { search, season });
  return (
    <div className="team-picker">
      <label>
        {label}
        <input
          type="search"
          placeholder="Rechercher une équipe publiée"
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
          {value && !state.result?.data.some((t) => t.id === value) && (
            <option value={value}>Sélection actuelle</option>
          )}
          {state.result?.data.map((team) => (
            <option
              key={team.id}
              value={team.id}
              disabled={team.id === excluded}
            >
              {team.name}
              {team.competitionName ? ` · ${team.competitionName}` : ""}
            </option>
          ))}
        </select>
      </label>
      {state.loading && <span role="status">Recherche…</span>}
      {state.error && (
        <span className="field-error">
          Les équipes ne sont pas encore disponibles.{" "}
          <button onClick={state.retry}>Réessayer</button>
        </span>
      )}
    </div>
  );
}
function TeamSummary({ team, analysis, season }) {
  return (
    <article className="comparison-team">
      <TeamBadge team={team} />
      <h2>{team.name}</h2>
      <p>{team.competitionName || team.country}</p>
      <span className="eyebrow">FORME CALCITO</span>
      <FormValue
        variant={team.coverage?.variant || analysis.coverage?.variant}
        score={
          season && Number(season) !== team.season
            ? null
            : (team.score ?? analysis.engine.score)
        }
      />
      <p className="muted-text">
        {analysis.results.length} résultats publiés · ancien → récent
      </p>
      {analysis.recent.loading ? (
        <p role="status">Chargement…</p>
      ) : (
        <Results results={analysis.results} demo={false} />
      )}
    </article>
  );
}
export function ComparativeStatistics({ left, right, leftTeam, rightTeam }) {
  const a = left.statistics.result?.data,
    b = right.statistics.result?.data;
  return (
    <section className="analysis-panel">
      <h2>Statistiques comparatives</h2>
      <p className="muted-text">
        {leftTeam.name} : {a?.sampleSize || 0} matchs · {rightTeam.name} :{" "}
        {b?.sampleSize || 0} matchs. Les fenêtres de dates sont propres à chaque
        équipe.
      </p>
      {Object.entries(metricLabels).map(([key, label]) => {
        const av = a?.metrics.find((item) => item.key === key)?.value,
          bv = b?.metrics.find((item) => item.key === key)?.value;
        const available = av != null && bv != null;
        return (
          <div className="comparison-metric" key={key}>
            <div>
              <strong>{av == null ? "—" : Number(av.toFixed(2))}</strong>
              <span>{label}</span>
              <strong>{bv == null ? "—" : Number(bv.toFixed(2))}</strong>
            </div>
            {available && av + bv > 0 && (
              <div
                className="split-bar"
                role="img"
                aria-label={`${label} : ${av} contre ${bv}`}
              >
                <span style={{ width: `${(av / (av + bv)) * 100}%` }} />
              </div>
            )}
          </div>
        );
      })}
      <Notice>
        Les valeurs absentes restent indisponibles. Ces barres comparent des
        statistiques descriptives ; elles ne représentent pas des probabilités
        de victoire.
      </Notice>
      <h3>Forces et faiblesses</h3>
      <p className="muted-text">
        L’analyse qualitative attend des critères validés. Aucun diagnostic ni
        statistique n’est inventé.
      </p>
      <SourceCaption result={left.statistics.result} />
      <SourceCaption result={right.statistics.result} />
    </section>
  );
}
export default function Compare() {
  const [params, setParams] = useSearchParams();
  const leftId = params.get("team") || "",
    rightId = params.get("against") || "",
    year = params.get("season") || "";
  const left = useFootball(
      "team",
      { teamId: leftId, season: year },
      { enabled: Boolean(leftId) },
    ),
    right = useFootball(
      "team",
      { teamId: rightId, season: year },
      { enabled: Boolean(rightId) },
    );
  const a = useTeamAnalysis(left.result?.data.id, year),
    b = useTeamAnalysis(right.result?.data.id, year);
  function set(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <section className="container page-content">
      <PageHeading
        label="DEUX ÉQUIPES. UNE LECTURE PLUS CLAIRE."
        title="Comparateur"
        description="Comparez les résultats et statistiques publiés, même entre deux championnats. Les saisons restent séparées et les données manquantes visibles."
      />
      <div className="filter-bar">
        <SeasonSelect value={year} onChange={(value) => set("season", value)} />
      </div>
      <div className="picker-grid">
        <TeamPicker
          label="Équipe A"
          value={leftId}
          onChange={(value) => set("team", value)}
          excluded={rightId}
          season={year}
        />
        <button
          className="swap-button"
          aria-label="Permuter les équipes"
          disabled={!leftId || !rightId}
          onClick={() =>
            setParams(
              { ...Object.fromEntries(params), team: rightId, against: leftId },
              { replace: true },
            )
          }
        >
          <ArrowLeftRight size={20} />
        </button>
        <TeamPicker
          label="Équipe B"
          value={rightId}
          onChange={(value) => set("against", value)}
          excluded={leftId}
          season={year}
        />
      </div>
      {leftId && leftId === rightId ? (
        <Notice>Choisissez deux équipes différentes.</Notice>
      ) : !leftId || !rightId ? (
        <CalcitoMascot
          variant="compare"
          title="Le contexte fait la différence."
          message="Choisissez deux équipes et une saison. Je vous aide à lire leurs performances, sans inventer les données manquantes."
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
              {left.result.data.coverage?.compatibilityGroup &&
                right.result.data.coverage?.compatibilityGroup &&
                left.result.data.coverage.compatibilityGroup !==
                  right.result.data.coverage.compatibilityGroup && (
                  <Notice>
                    Ces indices proviennent de variantes ou de méthodes
                    distinctes. Ils ne peuvent pas être comparés directement ;
                    les résultats et statistiques restent consultables.
                  </Notice>
                )}
              <div className="comparison-summaries">
                <TeamSummary
                  team={left.result.data}
                  analysis={a}
                  season={year}
                />
                <span className="comparison-vs">VS</span>
                <TeamSummary
                  team={right.result.data}
                  analysis={b}
                  season={year}
                />
              </div>
              <FormEvolution
                title="Deux équipes, une même ligne du temps"
                loading={a.timeline.loading || b.timeline.loading}
                error={a.timeline.error || b.timeline.error}
                series={[
                  {
                    team: left.result.data,
                    history: a.timeline.result?.data.history || [],
                    teams: (a.recent.result?.data || []).flatMap((m) => [
                      m.home,
                      m.away,
                    ]),
                  },
                  {
                    team: right.result.data,
                    history: b.timeline.result?.data.history || [],
                    teams: (b.recent.result?.data || []).flatMap((m) => [
                      m.home,
                      m.away,
                    ]),
                  },
                ]}
              />
              <ComparativeStatistics
                left={a}
                right={b}
                leftTeam={left.result.data}
                rightTeam={right.result.data}
              />
              <div className="detail-grid">
                <CalculationTrace analysis={a} />
                <CalculationTrace analysis={b} />
              </div>
            </>
          )}
        </DataState>
      )}
    </section>
  );
}
