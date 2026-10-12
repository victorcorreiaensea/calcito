import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { simulatedProfile } from "../services/simulation";
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
import { useTeamAnalysis, CalculationTrace } from "../components/TeamAnalysis";
import { Notice } from "../components/FootballUI";

export default function Teams() {
  const [search, setSearch] = useState("");
  const [competition, setCompetition] = useState("");
  const state = useFootball("teams", { search, competition });
  return (
    <section className="container page-content">
      <PageHeading
        label="LES ÉQUIPES, AU-DELÀ DU SCORE"
        title="Équipes"
        description="Explorez les clubs, leurs résultats disponibles et des indices de forme simulés pour illustrer leur dynamique."
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
                {team.season ? ` · Saison ${team.season}` : ""}
              </p>
              <FormValue
                score={team.score ?? simulatedProfile(team.id).score}
                demo
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
                    : "Résultats disponibles dans l’API et indice de forme simulé, clairement séparés."
                }
              />
              <FormValue
                score={demo ? team.score : simulatedProfile(team.id).score}
                demo
              />
            </div>
            {demo && <Results results={team.results} />}
            <SourceCaption result={state.result} />
            <Notice>
              L’indice est simulé pour illustrer l’interface. Il ne provient pas
              de l’algorithme propriétaire et n’est pas une probabilité de
              victoire.
            </Notice>
            <div className="results-detail">
              <CalculationTrace analysis={analysis} demo={demo} />
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
