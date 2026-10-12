import { useState } from "react";
import { Link } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamLink,
  Notice,
  Results,
  FormValue,
} from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";

function Table({ rows, group, season }) {
  return (
    <div className="table-scroll">
      <table className="official-table full-standings">
        <caption>
          {season.label}
          {group ? ` · ${group}` : ""} · {rows.length} équipes
        </caption>
        <thead>
          <tr>
            {[
              "#",
              "Équipe",
              "MJ",
              "V",
              "N",
              "D",
              "BP",
              "BC",
              "Diff.",
              "Points",
              "5 derniers",
              "Forme Calcito",
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.position}</td>
              <td>
                <TeamLink team={row.team} />
                {row.adjustment !== 0 && (
                  <small className="points-adjustment">
                    {row.adjustment > 0 ? "+" : ""}
                    {row.adjustment} pts : {row.adjustmentReason}
                  </small>
                )}
              </td>
              {[
                "played",
                "won",
                "drawn",
                "lost",
                "goalsFor",
                "goalsAgainst",
                "goalDifference",
                "points",
              ].map((key) => (
                <td key={key}>{row[key]}</td>
              ))}
              <td>
                <Results results={row.results} demo={false} />
              </td>
              <td>
                <FormValue score={row.team.score} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function Standings() {
  const [competition, setCompetition] = useState(""),
    [year, setYear] = useState("");
  const comps = useFootball("competitions");
  const leagueComps =
    comps.result?.data.filter((comp) => comp.type === "league") || [];
  const selectedId =
    competition ||
    leagueComps.find((comp) => comp.slug === "ligue-1")?.id ||
    leagueComps[0]?.id;
  const selected = leagueComps.find((comp) => comp.id === selectedId);
  const state = useFootball(
    "standings",
    { competition: selectedId, season: year },
    { enabled: Boolean(selectedId) },
  );
  const table = state.result?.data;
  const groups = [...new Set(table?.rows.map((row) => row.group) || [])];
  return (
    <section className="container page-content">
      <PageHeading
        label="TOUTES LES ÉQUIPES, CHAMPIONNAT PAR CHAMPIONNAT"
        title="Classements"
        description="Un classement reconstruit à partir des matchs publiés. La couverture, les règles de départage et les éventuelles sanctions restent visibles."
      />
      <DataState {...comps} empty={leagueComps.length === 0}>
        <div className="league-shortcuts">
          {leagueComps.map((comp) => (
            <button
              key={comp.id}
              aria-pressed={comp.id === selectedId}
              onClick={() => {
                setCompetition(comp.id);
                setYear("");
              }}
            >
              {comp.name}
              <small>{comp.country}</small>
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
                setYear("");
              }}
            >
              {leagueComps.map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="standings-season">Saison</label>
            <select
              id="standings-season"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="">Dernière saison publiée</option>
              {selected?.seasons.map((value) => (
                <option key={value} value={value}>
                  {value}–{value + 1}
                </option>
              ))}
            </select>
          </div>
          <Link className="button button-secondary" to="/classement-europeen">
            Classement européen Calcito →
          </Link>
        </div>
        <DataState {...state} empty={!table?.rows.length}>
          {table?.season && (
            <>
              <div className="season-context">
                <span
                  className={`status-pill ${table.partial ? "partial-pill" : ""}`}
                >
                  {table.partial ? "CLASSEMENT PARTIEL" : "COUVERTURE VÉRIFIÉE"}
                </span>
                <p>
                  {table.recordedMatches} matchs terminés publiés
                  {table.expectedMatches
                    ? ` / ${table.expectedMatches} attendus`
                    : ""}{" "}
                  · {table.season.label}
                </p>
              </div>
              {table.partial && (
                <Notice>
                  Ce tableau reflète uniquement les rencontres enregistrées et
                  vérifiées. Il ne constitue pas encore un classement officiel
                  complet. Les règles de départage et la couverture doivent être
                  confirmées par l’administrateur.
                </Notice>
              )}
              {table.unsupported.length > 0 && (
                <Notice>
                  Règles de départage non prises en charge :{" "}
                  {table.unsupported.join(", ")}. Les équipes à égalité gardent
                  un rang partagé.
                </Notice>
              )}
              {groups.map((group) => (
                <Table
                  key={group || "league"}
                  rows={table.rows.filter((row) => row.group === group)}
                  group={group}
                  season={table.season}
                />
              ))}
            </>
          )}
          <SourceCaption result={state.result} />
        </DataState>
      </DataState>
    </section>
  );
}
export function EuropeanRanking() {
  const [competition, setCompetition] = useState(""),
    [year, setYear] = useState(""),
    [onlyCalculated, setOnlyCalculated] = useState(false);
  const state = useFootball("dataset");
  const d = state.result?.data;
  const leagues = d?.competitions.filter((c) => c.type === "league") || [];
  const years = [
    ...new Set(
      d?.seasons
        .filter((s) => leagues.some((c) => c.id === s.competition_id))
        .map((s) => s.start_year) || [],
    ),
  ].sort((a, b) => b - a);
  const selectedYear = Number(year) || years[0];
  const members =
    d?.members.filter((m) => {
      const season = d.seasons.find((s) => s.id === m.season_id);
      return (
        season?.start_year === selectedYear &&
        leagues.some((c) => c.id === season.competition_id) &&
        (!competition || season.competition_id === competition)
      );
    }) || [];
  const candidates = [...new Set(members.map((m) => m.team_id))]
    .map((id) => {
      const team = d.teams.find((t) => t.id === id),
        member = members.find((m) => m.team_id === id),
        season = d.seasons.find((s) => s.id === member.season_id),
        form = d.forms.find(
          (f) =>
            f.team_id === id &&
            f.season_start_year === selectedYear &&
            f.is_valid &&
            f.is_published,
        );
      const recent = d.matches
        .filter(
          (m) =>
            m.is_published &&
            m.status === "finished" &&
            [m.home_team_id, m.away_team_id].includes(id) &&
            d.seasons.find((s) => s.id === m.season_id)?.start_year ===
              selectedYear,
        )
        .slice(0, 5)
        .reverse()
        .map((m) => {
          const home = m.home_team_id === id,
            gf = home ? m.goals_home : m.goals_away,
            ga = home ? m.goals_away : m.goals_home;
          return gf > ga ? "V" : gf === ga ? "N" : "D";
        });
      return {
        results: recent,
        team: { ...team, logo: team?.logo_url },
        comp: d.competitions.find((c) => c.id === season.competition_id),
        score: form?.score == null ? null : Number(form.score),
      };
    })
    .filter((row) => row.team?.id);
  const rows = candidates
    .filter((row) => !onlyCalculated || row.score !== null)
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        a.team.name.localeCompare(b.team.name),
    );
  return (
    <section className="container page-content">
      <PageHeading
        label="UNE ÉCHELLE COMMUNE, PAS UN CLASSEMENT UEFA"
        title="Classement européen Calcito"
        description="Les clubs des six championnats, regroupés par saison et classés uniquement lorsqu’un indice Calcito valide est disponible."
      />
      <Notice>
        La formule propriétaire n’est pas encore fournie. Aucun indice ni rang
        européen n’est inventé. Ce classement n’est pas un classement officiel
        UEFA.
      </Notice>
      <DataState {...state}>
        <div className="filter-bar">
          <div className="filter-field">
            <label htmlFor="europe-league">Championnat</label>
            <select
              id="europe-league"
              value={competition}
              onChange={(event) => setCompetition(event.target.value)}
            >
              <option value="">Tous les championnats</option>
              {leagues.map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="europe-season">Saison</label>
            <select
              id="europe-season"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="">Dernière saison publiée</option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}–{value + 1}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={onlyCalculated}
              onChange={(event) => setOnlyCalculated(event.target.checked)}
            />
            Indices calculables uniquement
          </label>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Rang Calcito</th>
                  <th>Équipe</th>
                  <th>Championnat</th>
                  <th>Indice</th>
                  <th>5 derniers</th>
                  <th>Historique</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.team.id}>
                    <td>{row.score === null ? "—" : index + 1}</td>
                    <td>
                      <TeamLink team={row.team} />
                    </td>
                    <td>{row.comp.name}</td>
                    <td>
                      {row.score === null
                        ? "Indice indisponible"
                        : `${row.score} %`}
                    </td>
                    <td>
                      <Results results={row.results} demo={false} />
                    </td>
                    <td>
                      <Link to={`/equipes/${row.team.id}`}>
                        Voir les matchs →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">
            Aucune équipe avec des données publiées dans cette sélection.
          </p>
        )}
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
