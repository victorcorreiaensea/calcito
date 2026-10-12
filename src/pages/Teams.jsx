import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamBadge,
  FormValue,
  Results,
  DemoLabel,
} from "../components/FootballUI";
import { CompetitionSelect, SourceCaption } from "../components/DataContext";
import {
  useTeamAnalysis,
  CalculationTrace,
  TeamStatistics,
} from "../components/TeamAnalysis";

export default function Teams() {
  const [search, setSearch] = useState("");
  const [competition, setCompetition] = useState("");
  const state = useFootball("teams", { search, competition });
  return (
    <section className="container page-content">
      <PageHeading
        label="LES ÉQUIPES, AU-DELÀ DU SCORE"
        title="Équipes"
        description="Explorez les clubs, leurs résultats récents et les données disponibles pour comprendre leur dynamique."
      />
      <div className="filter-bar">
        <div className="filter-field search-field">
          <label htmlFor="team-search">Rechercher une équipe</label>
          <div>
            <Search size={17} />
            <input
              type="search"
              id="team-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom de l’équipe (3 caractères minimum en mode réel)…"
            />
          </div>
        </div>
        <CompetitionSelect value={competition} onChange={setCompetition} />
      </div>
      <p className="muted-text">
        Sans filtre ni recherche, le fournisseur API-Football affiche la Ligue
        1. Une recherche permet de trouver des équipes d’autres championnats.
      </p>
      <DataState {...state} empty={state.result?.data.length === 0}>
        <p className="result-count" role="status">
          {state.result?.data.length} équipe(s)
        </p>
        <div className="team-grid">
          {state.result?.data.map((team) => (
            <article className="team-card" key={team.id}>
              <div className="team-card-top">
                <TeamBadge team={team} />
                {state.result.mode === "demo" && <DemoLabel compact />}
              </div>
              <h2>{team.name}</h2>
              <p>
                {team.competitionName ||
                  team.country ||
                  "Compétition non renseignée"}
              </p>
              <FormValue
                score={team.score}
                demo={state.result.mode === "demo"}
              />
              <Results
                results={team.results}
                demo={state.result.mode === "demo"}
              />
              <Link
                className="text-link"
                to={`/equipes/${encodeURIComponent(team.id)}`}
              >
                Explorer l’équipe <ArrowUpRight size={18} />
              </Link>
            </article>
          ))}
        </div>
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
export function TeamDetail() {
  const { teamId } = useParams();
  const state = useFootball("team", teamId);
  const analysis = useTeamAnalysis(state.result?.data.id);
  const team = state.result?.data;
  const demo = state.result?.mode === "demo";
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
                label={
                  demo
                    ? "FICHE D’ÉQUIPE FICTIVE"
                    : team.competitionName || "FICHE ÉQUIPE"
                }
                title={team.name}
                description={
                  demo
                    ? "Profil de démonstration. Les résultats et l’indice de forme sont fictifs."
                    : "Résultats récents, statistiques et traçabilité des données utilisées."
                }
              />
              <FormValue
                score={demo ? team.score : analysis.engine.score}
                demo={demo}
              />
            </div>
            {demo && <Results results={team.results} />}
            <SourceCaption result={state.result} />
            <div className="detail-grid">
              <CalculationTrace analysis={analysis} demo={demo} />
              <TeamStatistics state={analysis.statistics} />
            </div>
            <Link
              className="button button-primary"
              to={`/comparateur?team=${encodeURIComponent(team.id)}`}
            >
              Comparer cette équipe <ArrowUpRight size={18} />
            </Link>
          </>
        )}
      </DataState>
    </section>
  );
}
