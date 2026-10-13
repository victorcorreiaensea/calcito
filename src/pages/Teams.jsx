import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamBadge,
  FormValue,
  Notice,
} from "../components/FootballUI";
import {
  CompetitionSelect,
  SeasonSelect,
  SourceCaption,
} from "../components/DataContext";
import {
  useTeamAnalysis,
  CalculationTrace,
  TeamStatistics,
} from "../components/TeamAnalysis";

export default function Teams() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  function setSearch(value) {
    setParams(value ? { search: value } : {}, { replace: true });
  }
  const [competition, setCompetition] = useState(""),
    [year, setYear] = useState(""),
    [page, setPage] = useState(0);
  const state = useFootball("teams", { search, competition, season: year });
  const rows = state.result?.data || [];
  return (
    <section className="container page-content">
      <PageHeading
        label="LES ÉQUIPES, AU-DELÀ DU SCORE"
        title="Équipes"
        description="Retrouvez les fiches publiées, leurs résultats et les statistiques réellement renseignées. Les données absentes restent indisponibles."
      />
      <div className="filter-bar">
        <div className="filter-field search-field">
          <label htmlFor="team-search">Rechercher une équipe</label>
          <div>
            <Search size={17} />
            <input
              type="search"
              id="team-search"
              placeholder="Nom de l’équipe…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        <CompetitionSelect
          value={competition}
          onChange={(value) => {
            setCompetition(value);
            setYear("");
            setPage(0);
          }}
        />
        <SeasonSelect
          competition={competition}
          value={year}
          onChange={(value) => {
            setYear(value);
            setPage(0);
          }}
        />
      </div>
      <DataState {...state} empty={!rows.length}>
        <p className="result-count" role="status">
          {rows.length} équipe(s) publiée(s)
        </p>
        <div className="team-grid">
          {rows.slice(page * 18, (page + 1) * 18).map((team) => (
            <article className="team-card" key={team.id}>
              <div className="team-card-top">
                <TeamBadge team={team} />
                <span className="status-pill">{team.country}</span>
              </div>
              <h2>{team.name}</h2>
              <p>
                {team.competitionName || "Fiche publiée"}
                {team.season ? ` · ${team.season}–${team.season + 1}` : ""}
              </p>
              <span className="eyebrow">FORME CALCITO</span>
              <FormValue score={team.score} />
              <Link className="text-link" to={`/equipes/${team.id}`}>
                Explorer l’équipe
                <ArrowUpRight size={18} />
              </Link>
            </article>
          ))}
        </div>
        <div className="pagination">
          <button
            disabled={!page}
            onClick={() => setPage((value) => value - 1)}
          >
            Précédent
          </button>
          <span>
            Page {page + 1} / {Math.max(1, Math.ceil(rows.length / 18))}
          </span>
          <button
            disabled={(page + 1) * 18 >= rows.length}
            onClick={() => setPage((value) => value + 1)}
          >
            Suivant
          </button>
        </div>
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
export function TeamDetail() {
  const { teamId } = useParams();
  const [detailParams] = useSearchParams();
  const [year, setYear] = useState(detailParams.get("season") || "");
  const state = useFootball("team", { teamId, season: year });
  const analysis = useTeamAnalysis(state.result?.data.id, year);
  const history = useFootball("teamHistory", { teamId, season: year });
  const standings = useFootball(
    "standings",
    { competition: state.result?.data.competitionId, season: year },
    { enabled: Boolean(state.result?.data.competitionId) },
  );
  const team = state.result?.data;
  const position = standings.result?.data.rows.find(
    (row) => row.id === teamId,
  )?.position;
  const relevantHistory =
    history.result?.data.filter(
      (m) =>
        m.status === "finished" &&
        (m.home.id === teamId || m.away.id === teamId),
    ) || [];
  const [page, setPage] = useState(0);
  return (
    <section className="container page-content">
      <Link className="back-link" to="/equipes">
        ← Toutes les équipes
      </Link>
      <DataState {...state}>
        {team && (
          <>
            <div className="team-detail-header">
              <TeamBadge team={team} />
              <PageHeading
                label={`${team.country} · ${team.competitionName || "ÉQUIPE"}`}
                title={team.name}
                description="Résultats publiés, statistiques renseignées et indice de forme lorsqu’il est disponible."
              />
              <FormValue
                score={year && Number(year) !== team.season ? null : team.score}
              />
            </div>
            <div className="filter-bar">
              <SeasonSelect
                value={year}
                onChange={(value) => {
                  setYear(value);
                  setPage(0);
                }}
              />
              <span className="status-pill">
                Position : {position || "—"}
                {standings.result?.data.partial ? " · classement partiel" : ""}
              </span>
              <Link
                className="button button-primary"
                to={`/comparateur?team=${team.id}${year ? `&season=${year}` : ""}`}
              >
                Comparer cette équipe
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="detail-grid">
              <CalculationTrace analysis={analysis} />
              <TeamStatistics state={analysis.statistics} />
            </div>
            <section className="analysis-panel">
              <h2>Évolution de la forme</h2>
              <FormHistory
                history={
                  year && Number(year) !== team.season
                    ? []
                    : team.formHistory || []
                }
              />
            </section>
            <section className="analysis-panel">
              <h2>Historique des résultats publiés</h2>
              <p className="muted-text">
                {team.coverage?.sampleSize || 0} / 5 résultats ·{" "}
                {team.coverage?.detailed || 0} détaillés ·{" "}
                {team.coverage?.simplified || 0} simplifiés.{" "}
                {team.coverage?.label}
              </p>
              {history.error ? (
                <p role="alert">Les résultats ne sont pas disponibles.</p>
              ) : !relevantHistory.length ? (
                <p className="muted-text">
                  Aucun résultat publié dans cette saison.
                </p>
              ) : (
                <>
                  <div className="team-history">
                    {relevantHistory
                      .slice(page * 10, (page + 1) * 10)
                      .map((match) => (
                        <div key={match.id}>
                          <span>
                            {new Date(match.kickoff).toLocaleDateString(
                              "fr-FR",
                            )}{" "}
                            · {match.competition.name}
                            {match.entry_type === "simplified"
                              ? " · Résultat simplifié"
                              : ""}
                          </span>
                          <strong>
                            {match.home.name} {match.goalsHome ?? "—"} –{" "}
                            {match.goalsAway ?? "—"} {match.away.name}
                          </strong>
                        </div>
                      ))}
                  </div>
                  <div className="pagination">
                    <button
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Précédent
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                      disabled={(page + 1) * 10 >= relevantHistory.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Suivant
                    </button>
                  </div>
                </>
              )}
            </section>
            <SourceCaption result={state.result} />
          </>
        )}
      </DataState>
    </section>
  );
}

function FormHistory({ history }) {
  if (history.length < 2)
    return (
      <p className="muted-text">
        Aucun historique suffisant d’indice calculé n’est disponible. Le
        graphique apparaît uniquement après des calculs réels et versionnés.
      </p>
    );
  const rows = [...history].sort(
    (a, b) => Date.parse(a.calculatedAt) - Date.parse(b.calculatedAt),
  );
  const points = rows
    .map(
      (row, i) =>
        `${15 + (i / (rows.length - 1)) * 470},${150 - row.score * 1.3}`,
    )
    .join(" ");
  return (
    <div>
      <svg
        className="form-history-chart"
        viewBox="0 0 500 175"
        role="img"
        aria-label={`Historique réel de forme de ${rows[0].score} à ${rows.at(-1).score} %`}
      >
        <line x1="15" x2="485" y1="150" y2="150" stroke="#25344D" />
        <polyline
          points={points}
          fill="none"
          stroke="#2F8CFF"
          strokeWidth="3"
        />
        {rows.map((row, i) => (
          <circle
            key={i}
            cx={15 + (i / (rows.length - 1)) * 470}
            cy={150 - row.score * 1.3}
            r="4"
            fill="#73B5FF"
          />
        ))}
      </svg>
      <p className="muted-text">
        {new Date(rows[0].calculatedAt).toLocaleDateString("fr-FR")} —{" "}
        {new Date(rows.at(-1).calculatedAt).toLocaleDateString("fr-FR")} ·
        Calculs versionnés
      </p>
    </div>
  );
}
