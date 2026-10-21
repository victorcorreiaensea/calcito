import StatisticalResearch from "../components/StatisticalResearch";
import { recentInsight, compareInsights } from "../domain/teamInsight";
import { PredictionHistory } from "./Predictions";
import RecentMetrics from "../components/RecentMetrics";
import ClubSnapshot from "../components/ClubSnapshot";
import MatchForecast from "../components/MatchForecast";
import { Link } from "react-router-dom";
import FormEvolution from "../components/FormEvolution";
import { useState, useEffect, useMemo } from "react";
import ComparatorForecast from "../components/ComparatorForecast";
import { TeamBadge } from "../components/FootballUI";
import "./Compare.css";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  useTeamAnalysis,
  metricLabels,
  CalculationTrace,
} from "../components/TeamAnalysis";
import { PageHeading, DataState, Notice } from "../components/FootballUI";
import { SourceCaption, SeasonSelect } from "../components/DataContext";
import CalcitoIdentityPanel from "../components/CalcitoIdentityPanel";
import { createStatisticalReport } from "../services/predictionService";

export function TeamPicker({ label, value, onChange, excluded, season }) {
  const [search, setSearch] = useState("");
  const state = useFootball("teams", { search, season });
  return (
    <div className="team-picker">
      <label className="picker-select">
        {label}
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
      <details className="comparator-team-search">
        <summary>Rechercher</summary>
        <label>
          Rechercher un club
          <input
            type="search"
            placeholder="Rechercher une équipe publiée"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </details>
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
function TeamSummary({ team, season }) {
  return <ClubSnapshot team={team} season={season} comparison />;
}
export function ComparativeStatistics({ left, right, leftTeam, rightTeam }) {
  const a = left.statistics.result?.data,
    b = right.statistics.result?.data;
  const ai = recentInsight(left.recent.result?.data, leftTeam.id),
    bi = recentInsight(right.recent.result?.data, rightTeam.id);
  const labels = {
    goalsForRecent: "Buts marqués · cinq derniers résultats",
    goalsAgainstRecent: "Buts encaissés · cinq derniers résultats",
    ...metricLabels,
  };
  const metric = (stats, insight, key) =>
    key === "goalsForRecent"
      ? insight.rows.length
        ? insight.goalsFor
        : null
      : key === "goalsAgainstRecent"
        ? insight.rows.length
          ? insight.goalsAgainst
          : null
        : stats?.metrics.find((item) => item.key === key)?.value;
  return (
    <section className="analysis-panel">
      <h2>Statistiques comparatives</h2>
      <p className="muted-text">
        {leftTeam.name} : {a?.sampleSize || 0} matchs · {rightTeam.name} :{" "}
        {b?.sampleSize || 0} matchs. Les fenêtres de dates sont propres à chaque
        équipe.
      </p>
      {Object.entries(labels).map(([key, label]) => {
        const av = metric(a, ai, key),
          bv = metric(b, bi, key);
        if (av == null && bv == null) return null;
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

      <SourceCaption result={left.statistics.result} />
      <SourceCaption result={right.statistics.result} />
    </section>
  );
}
export default function Compare() {
  const [params, setParams] = useSearchParams();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const mode =
    params.get("mode") === "simulation"
      ? "simulation"
      : params.get("mode") === "real" || params.get("match")
        ? "real"
        : params.get("team") && params.get("against")
          ? "simulation"
          : "real";
  const year = params.get("season") || "";
  const fixtures = useFootball("matches", { season: year, view: "upcoming" });
  const dataset = useFootball("dataset");
  const upcoming =
    fixtures.result?.data.filter(
      (m) => m.status === "scheduled" && Date.parse(m.kickoff) > clock,
    ) || [];
  const actualMatch =
    mode === "real"
      ? upcoming.find((m) => m.id === params.get("match")) ||
        (!params.get("match")
          ? upcoming.find(
              (m) =>
                (m.home.id === params.get("team") &&
                  m.away.id === params.get("against")) ||
                (m.away.id === params.get("team") &&
                  m.home.id === params.get("against")),
            )
          : null)
      : null;
  const leftId =
      mode === "real" ? actualMatch?.home.id || "" : params.get("team") || "",
    rightId =
      mode === "real"
        ? actualMatch?.away.id || ""
        : params.get("against") || "";
  const selectedYear =
    Number(year) ||
    actualMatch?.season ||
    Math.max(
      0,
      ...(dataset.result?.data.seasons || []).map((s) => s.start_year),
    );
  const venue =
    mode === "real"
      ? "home"
      : ["home", "away", "neutral"].includes(params.get("venue"))
        ? params.get("venue")
        : "home";
  const left = useFootball(
      "team",
      { teamId: leftId, season: selectedYear },
      { enabled: Boolean(leftId) },
    ),
    right = useFootball(
      "team",
      { teamId: rightId, season: selectedYear },
      { enabled: Boolean(rightId) },
    );
  const a = useTeamAnalysis(leftId, selectedYear),
    b = useTeamAnalysis(rightId, selectedYear);
  const incompatible = Boolean(
    left.result?.data.coverage?.compatibilityGroup &&
    right.result?.data.coverage?.compatibilityGroup &&
    left.result.data.coverage.compatibilityGroup !==
      right.result.data.coverage.compatibilityGroup,
  );
  const cutoff = useMemo(
    () =>
      new Date(
        Math.min(clock, actualMatch ? Date.parse(actualMatch.kickoff) : clock),
      ).toISOString(),
    [clock, actualMatch?.kickoff],
  );
  const statisticalReport = useMemo(() => {
    if (
      !dataset.result?.data ||
      !left.result?.data ||
      !right.result?.data ||
      leftId === rightId
    )
      return null;
    return createStatisticalReport({
      dataset: dataset.result.data,
      home: left.result.data,
      away: right.result.data,
      year: selectedYear,
      venue,
      cutoff,
      match: actualMatch,
    });
  }, [
    dataset.result?.data,
    left.result?.data,
    right.result?.data,
    leftId,
    rightId,
    selectedYear,
    venue,
    cutoff,
    actualMatch?.competition.id,
  ]);
  function set(key, value) {
    const next = new URLSearchParams(params);
    if (["team", "against", "season", "mode"].includes(key))
      next.delete("match");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  function selectMatch(id) {
    const m = upcoming.find((m) => m.id === id);
    const next = new URLSearchParams(params);
    next.set("mode", "real");
    next.delete("venue");
    if (m) {
      next.set("match", m.id);
      next.set("team", m.home.id);
      next.set("against", m.away.id);
      next.set("season", String(m.season));
    } else {
      next.delete("match");
      next.delete("team");
      next.delete("against");
    }
    setParams(next, { replace: true });
  }
  return (
    <section className="container page-content comparator-page">
      <PageHeading
        label="LE MATCH SOUS UN AUTRE ANGLE"
        title="Comparateur & Pronostics"
        description="Une rencontre programmée ou un duel théorique, avec des probabilités issues des résultats publiés."
      />
      <div className="comparator-controls">
        <div
          className="comparator-mode"
          role="group"
          aria-label="Mode du comparateur"
        >
          <button
            type="button"
            aria-pressed={mode === "real"}
            onClick={() => set("mode", "real")}
          >
            Match réel
          </button>
          <button
            type="button"
            aria-pressed={mode === "simulation"}
            onClick={() => set("mode", "simulation")}
          >
            Simulation libre
          </button>
        </div>
        <div className="filter-bar">
          <SeasonSelect
            value={year}
            onChange={(value) => set("season", value)}
          />
        </div>
      </div>
      {mode === "real" ? (
        <div className="comparator-fixture-picker">
          <label htmlFor="comparison-match">Rencontre programmée</label>
          <select
            id="comparison-match"
            value={actualMatch?.id || ""}
            onChange={(e) => selectMatch(e.target.value)}
            disabled={fixtures.loading}
          >
            <option value="">Choisir un match publié</option>
            {upcoming.map((m) => (
              <option key={m.id} value={m.id}>
                {m.home.name} — {m.away.name} ·{" "}
                {new Date(m.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                {m.competition.name}
              </option>
            ))}
          </select>
          {fixtures.loading && <p role="status">Chargement du calendrier…</p>}
          {fixtures.error && (
            <p role="alert">
              Calendrier indisponible.{" "}
              <button className="text-link" onClick={fixtures.retry}>
                Réessayer
              </button>
            </p>
          )}
          {!fixtures.loading && !fixtures.error && !upcoming.length && (
            <p role="status">
              Aucune rencontre future publiée ; la simulation libre reste
              disponible.
            </p>
          )}
          {params.get("match") &&
            !actualMatch &&
            !fixtures.loading &&
            !fixtures.error && (
              <p role="status">
                Cette rencontre n’est plus disponible dans le calendrier futur.
              </p>
            )}
        </div>
      ) : (
        <>
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
                  {
                    ...Object.fromEntries(params),
                    team: rightId,
                    against: leftId,
                    venue:
                      venue === "neutral"
                        ? "neutral"
                        : venue === "home"
                          ? "away"
                          : "home",
                  },
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
          <div className="comparator-venue">
            <label htmlFor="comparison-venue">Terrain</label>
            <select
              id="comparison-venue"
              value={venue}
              onChange={(e) => set("venue", e.target.value)}
            >
              <option value="home">Équipe A à domicile</option>
              <option value="away">Équipe B à domicile</option>
              <option value="neutral">Terrain neutre</option>
            </select>
          </div>
        </>
      )}
      {leftId && leftId === rightId ? (
        <Notice>Choisissez deux équipes différentes.</Notice>
      ) : !leftId || !rightId ? (
        <p className="comparator-empty">
          {mode === "real"
            ? "Choisis une rencontre pour ouvrir son analyse."
            : "Choisis deux clubs pour simuler leur rencontre."}
        </p>
      ) : (
        <DataState
          loading={left.loading || right.loading || dataset.loading}
          error={left.error || right.error || dataset.error}
          empty={
            !left.result?.data || !right.result?.data || !dataset.result?.data
          }
          retry={() => {
            left.retry();
            right.retry();
            dataset.retry();
          }}
        >
          {left.result?.data && right.result?.data && dataset.result?.data && (
            <>
              <div className="comparator-duel">
                <Link to={`/equipes/${leftId}`}>
                  <TeamBadge team={left.result.data} />
                  <strong>{left.result.data.name}</strong>
                  <small>
                    {venue === "neutral"
                      ? "Terrain neutre"
                      : venue === "home"
                        ? "Domicile"
                        : "Extérieur"}
                  </small>
                </Link>
                <div className="comparator-duel-context">
                  <span>VS</span>
                  {actualMatch ? (
                    <>
                      <strong>{actualMatch.competition.name}</strong>
                      <time dateTime={actualMatch.kickoff}>
                        {new Date(actualMatch.kickoff).toLocaleString("fr-FR", {
                          dateStyle: "medium",
                          ...(actualMatch.timeKnown === false
                            ? {}
                            : { timeStyle: "short" }),
                        })}
                      </time>
                      <Link to={`/matchs/${actualMatch.id}`}>
                        Fiche du match →
                      </Link>
                    </>
                  ) : (
                    <small>
                      Match théorique · {selectedYear}–{selectedYear + 1}
                    </small>
                  )}
                </div>
                <Link to={`/equipes/${rightId}`}>
                  <TeamBadge team={right.result.data} />
                  <strong>{right.result.data.name}</strong>
                  <small>
                    {venue === "neutral"
                      ? "Terrain neutre"
                      : venue === "home"
                        ? "Extérieur"
                        : "Domicile"}
                  </small>
                </Link>
              </div>
              <details className="comparator-details">
                <summary>
                  Analyse des équipes · statistiques, forme et historique
                </summary>
                {incompatible && (
                  <Notice>
                    Les indices utilisent des méthodes distinctes ; les
                    statistiques restent consultables.
                  </Notice>
                )}
                <div className="comparison-summaries">
                  <TeamSummary team={left.result.data} season={selectedYear} />
                  <span className="comparison-vs">VS</span>
                  <TeamSummary team={right.result.data} season={selectedYear} />
                </div>
                <div className="detail-grid">
                  <RecentMetrics team={left.result.data} analysis={a} />
                  <RecentMetrics team={right.result.data} analysis={b} />
                </div>
                <p className="muted-text">
                  {incompatible
                    ? "Ces indices appartiennent à des méthodes distinctes ; les résultats publiés restent consultables avec leur contexte."
                    : compareInsights(
                        left.result.data,
                        right.result.data,
                        recentInsight(a.recent.result?.data, leftId),
                        recentInsight(b.recent.result?.data, rightId),
                      )}
                </p>
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
                <details className="analysis-panel">
                  <summary>Consulter les sources et les contributions</summary>
                  <div className="detail-grid">
                    <CalculationTrace analysis={a} />
                    <CalculationTrace analysis={b} />
                  </div>
                </details>
              </details>
              <ComparatorForecast
                key={[
                  mode,
                  leftId,
                  rightId,
                  selectedYear,
                  venue,
                  actualMatch?.id,
                ].join(":")}
                report={statisticalReport}
                home={left.result.data}
                away={right.result.data}
                cutoff={cutoff}
                mode={mode}
                match={actualMatch}
              />
              <StatisticalResearch
                report={statisticalReport.research}
                home={left.result.data}
                away={right.result.data}
              />
              <SourceCaption result={dataset.result} />
              <CalcitoIdentityPanel
                report={statisticalReport}
                match={actualMatch}
              />
              {actualMatch && (
                <details className="comparator-details">
                  <summary>Prévisions serveur et accès à l’Arène</summary>
                  <MatchForecast match={actualMatch} />
                </details>
              )}
            </>
          )}
        </DataState>
      )}
      <details className="comparator-details">
        <summary>Historique des pronostics publiés</summary>
        <PredictionHistory />
      </details>
      <SourceCaption result={fixtures.result} />
    </section>
  );
}
