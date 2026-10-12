import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamLink,
  FormValue,
} from "../components/FootballUI";
import {
  CompetitionSelect,
  SeasonSelect,
  SourceCaption,
} from "../components/DataContext";

const labels = {
  finished: "Terminé",
  scheduled: "À venir",
  live: "En cours",
  postponed: "Reporté",
  cancelled: "Annulé",
};
export function FixtureCard({ match }) {
  return (
    <article className="fixture-card">
      <div className="fixture-meta">
        <span>
          {match.competition.name} · {match.round}
        </span>
        <span className="status-pill">{labels[match.status]}</span>
      </div>
      <div className="fixture-versus">
        <TeamLink team={match.home} />
        <strong className="fixture-score">
          {match.goalsHome != null && match.goalsAway != null
            ? `${match.goalsHome} – ${match.goalsAway}`
            : "VS"}
        </strong>
        <TeamLink team={match.away} />
      </div>
      <div className="fixture-forms">
        <div>
          <span>Forme domicile</span>
          <FormValue score={match.home.score} />
        </div>
        <div>
          <span>Forme extérieur</span>
          <FormValue score={match.away.score} />
        </div>
      </div>
      <div className="fixture-footer">
        <span>
          {new Date(match.kickoff).toLocaleString("fr-FR", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
        <Link
          to={`/pronostics?home=${match.home.id}&away=${match.away.id}&match=${match.id}&season=${match.season}`}
        >
          Analyse
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </article>
  );
}
export default function Matches() {
  const [competition, setCompetition] = useState(""),
    [year, setYear] = useState(""),
    [view, setView] = useState(""),
    [page, setPage] = useState(0);
  const state = useFootball("matches", { competition, season: year, view });
  const matches = state.result?.data || [];
  return (
    <section className="container page-content">
      <PageHeading
        label="LE JEU, MATCH APRÈS MATCH"
        title="Matchs"
        description="Calendrier et résultats vérifiés, saisis une seule fois pour les deux équipes. Seules les rencontres publiées par l’administrateur sont visibles."
      />
      <div className="filter-bar">
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
        <div className="filter-field">
          <label htmlFor="fixture-view">Calendrier</label>
          <select
            id="fixture-view"
            value={view}
            onChange={(event) => {
              setView(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Tous les matchs publiés</option>
            <option value="results">Résultats</option>
            <option value="upcoming">À venir / en cours</option>
          </select>
        </div>
      </div>
      <DataState {...state} empty={!matches.length}>
        <div className="fixture-grid">
          {matches.slice(page * 12, (page + 1) * 12).map((match) => (
            <FixtureCard match={match} key={match.id} />
          ))}
        </div>
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Précédent
          </button>
          <span>
            Page {page + 1} / {Math.max(1, Math.ceil(matches.length / 12))}
          </span>
          <button
            disabled={(page + 1) * 12 >= matches.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivant
          </button>
        </div>
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
