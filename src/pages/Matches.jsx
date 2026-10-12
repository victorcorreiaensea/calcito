import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamLink,
  FormValue,
  DemoLabel,
} from "../components/FootballUI";
import { CompetitionSelect, SourceCaption } from "../components/DataContext";

const statuses = {
  scheduled: "À venir",
  finished: "Terminé",
  live: "En cours",
  postponed: "Reporté",
  cancelled: "Annulé",
};
export function FixtureCard({ match, demo }) {
  return (
    <article className="fixture-card">
      <div className="fixture-meta">
        <span>
          {typeof match.competition === "string"
            ? match.competition
            : match.competition?.name || "Compétition indisponible"}
        </span>
        {demo ? (
          <DemoLabel compact />
        ) : (
          <span className="status-pill">{statuses[match.status]}</span>
        )}
      </div>
      <div className="fixture-versus">
        <TeamLink team={match.home} />
        <span className="fixture-score">
          {match.status === "finished" &&
          match.goalsHome != null &&
          match.goalsAway != null
            ? `${match.goalsHome} – ${match.goalsAway}`
            : "VS"}
        </span>
        <TeamLink team={match.away} />
      </div>
      <div className="fixture-forms">
        <div>
          <span>Forme domicile</span>
          <FormValue score={demo ? match.home.score : null} demo={demo} />
        </div>
        <div>
          <span>Forme extérieur</span>
          <FormValue score={demo ? match.away.score : null} demo={demo} />
        </div>
      </div>
      <div className="fixture-footer">
        <span>
          {demo
            ? `Date fictive · ${match.date}`
            : new Date(match.kickoff).toLocaleString("fr-FR", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
        </span>
        <Link to={`/pronostics?match=${encodeURIComponent(match.id)}`}>
          Analyse <ArrowUpRight size={14} />
        </Link>
      </div>
    </article>
  );
}
export default function Matches() {
  const [competition, setCompetition] = useState("");
  const [view, setView] = useState("upcoming");
  const state = useFootball("matches", { competition, view });
  return (
    <section className="container page-content">
      <PageHeading
        label="LE JEU, MATCH APRÈS MATCH"
        title="Matchs"
        description="Calendrier et derniers résultats. Les horaires réels sont affichés selon votre fuseau horaire ; les indices de forme ne sont pas des probabilités."
      />
      <div className="filter-bar">
        <CompetitionSelect value={competition} onChange={setCompetition} />
        <div className="filter-field">
          <label htmlFor="fixture-view">Calendrier</label>
          <select
            id="fixture-view"
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="upcoming">À venir</option>
            <option value="results">Derniers résultats</option>
          </select>
        </div>
      </div>
      <DataState {...state} empty={state.result?.data.length === 0}>
        <div className="fixture-grid">
          {state.result?.data.map((match) => (
            <FixtureCard
              match={match}
              key={match.id}
              demo={state.result.mode === "demo"}
            />
          ))}
        </div>
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
