import { useState } from "react";
import { useFootball } from "../hooks/useFootball";
import { footballService } from "../services/footballService";
import { simulatedProfile } from "../services/simulation";
import {
  PageHeading,
  DataState,
  TeamLink,
  Notice,
  FormBar,
} from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";
import { Ranking } from "./Home";

function StandingsTable({ rows, group, competitionName, formView }) {
  const sorted = formView
    ? [...rows].sort(
        (a, b) =>
          simulatedProfile(b.team.id).score -
            simulatedProfile(a.team.id).score ||
          a.team.name.localeCompare(b.team.name),
      )
    : [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="table-scroll">
      <table className="official-table full-standings">
        <caption>
          {competitionName}
          {group ? ` · ${group}` : ""} · {rows.length} équipes
          {rows[0]?.season ? ` · Saison ${rows[0].season}` : ""}
          {formView
            ? " · Classement de forme SIMULÉ"
            : " · Classement officiel"}
        </caption>
        <thead>
          <tr>
            {[
              "#",
              "Équipe",
              ...(formView ? [] : ["MJ", "V", "N", "D", "BP", "BC", "Points"]),
              "Forme simulée",
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.team.id}>
              <td>{formView ? index + 1 : row.position}</td>
              <td>
                <TeamLink team={row.team} />
              </td>
              {!formView &&
                [
                  "played",
                  "won",
                  "drawn",
                  "lost",
                  "goalsFor",
                  "goalsAgainst",
                  "points",
                ].map((key) => <td key={key}>{row[key] ?? "—"}</td>)}
              <td>
                <div className="standings-form">
                  <strong>{simulatedProfile(row.team.id).score} %</strong>
                  <FormBar score={simulatedProfile(row.team.id).score} />
                  <small>SIMULATION</small>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function Standings() {
  const [competition, setCompetition] = useState("");
  const [season, setSeason] = useState("");
  const [formView, setFormView] = useState(false);
  const demo = footballService.mode === "demo";
  const competitions = useFootball("competitions");
  const selectedId =
    competition ||
    competitions.result?.data.find((item) => item.id === "61")?.id ||
    competitions.result?.data[0]?.id;
  const selected = competitions.result?.data.find(
    (item) => item.id === selectedId,
  );
  const state = useFootball(
    "standings",
    { competition: selectedId, season },
    { enabled: !demo && Boolean(selectedId) },
  );
  const rows = state.result?.data || [];
  const groups = [...new Set(rows.map((row) => row.group))];
  const displayedSeason = rows[0]?.season;
  return (
    <section className="container page-content">
      <PageHeading
        label="TOUTES LES ÉQUIPES, CHAMPIONNAT PAR CHAMPIONNAT"
        title="Classements"
        description="Retrouvez le tableau complet de chaque compétition accessible. Les points et positions officiels restent séparés de la forme simulée."
      />
      {demo ? (
        <>
          <Notice>
            Mode démonstration : ce classement contient uniquement des équipes
            et des indices fictifs.
          </Notice>
          <Ranking />
        </>
      ) : (
        <DataState
          {...competitions}
          empty={competitions.result?.data.length === 0}
        >
          <div
            className="league-shortcuts"
            aria-label="Choisir une compétition"
          >
            {competitions.result?.data.map((item) => (
              <button
                key={item.id}
                aria-pressed={item.id === selectedId}
                onClick={() => {
                  setCompetition(item.id);
                  setSeason("");
                }}
              >
                {item.name}
                <small>{item.country}</small>
              </button>
            ))}
          </div>
          <div className="filter-bar">
            <div className="filter-field">
              <label htmlFor="standings-competition">Compétition</label>
              <select
                id="standings-competition"
                value={selectedId || ""}
                onChange={(event) => {
                  setCompetition(event.target.value);
                  setSeason("");
                }}
              >
                {competitions.result?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.country}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="standings-season">Saison</label>
              <select
                id="standings-season"
                value={season}
                onChange={(event) => setSeason(event.target.value)}
              >
                <option value="">
                  Dernière saison accessible avec votre offre
                </option>
                {selected?.seasons?.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="standings-tabs"
              role="group"
              aria-label="Type de classement"
            >
              <button
                aria-pressed={!formView}
                onClick={() => setFormView(false)}
              >
                Classement officiel
              </button>
              <button aria-pressed={formView} onClick={() => setFormView(true)}>
                Forme simulée
              </button>
            </div>
          </div>
          <Notice>
            Les indices de forme sont des simulations d’interface, sans formule
            Calcito et sans valeur prédictive. Ils ne modifient jamais les
            points, résultats ou positions officiels.
          </Notice>
          <DataState {...state} empty={state.result?.data.length === 0}>
            {displayedSeason && (
              <div className="season-context">
                <span className="status-pill">Saison {displayedSeason}</span>
                <p>
                  {displayedSeason !== selected?.seasons?.[0]
                    ? "Données historiques accessibles avec votre offre API. Ce tableau ne représente pas nécessairement la saison actuelle."
                    : "Saison fournie par API-Football."}
                </p>
                <strong>{rows.length} équipes · aucun club masqué</strong>
              </div>
            )}
            {groups.map((group) => (
              <StandingsTable
                key={group || "league"}
                rows={rows.filter((row) => row.group === group)}
                group={group}
                competitionName={selected?.name || "Compétition"}
                formView={formView}
              />
            ))}
            <SourceCaption result={state.result} />
          </DataState>
        </DataState>
      )}
    </section>
  );
}
