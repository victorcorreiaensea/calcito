import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import {
  PageHeading,
  DataState,
  TeamLink,
  Notice,
  Results,
  FormValue,
} from "../components/FootballUI";
import { isStandingsCompetition } from "../domain/standings";
import { isTrackedLeague } from "../domain/simplified";
import { europeanRows, compatibleRankingGroups } from "../domain/european";
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
                <FormValue
                  variant={row.team.coverage?.variant}
                  dataMode={row.team.coverage?.dataMode}
                  score={row.team.score}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function Standings() {
  const [params] = useSearchParams();
  const [competition, setCompetition] = useState(
      params.get("competition") || "",
    ),
    [year, setYear] = useState(params.get("season") || "");
  const comps = useFootball("competitions");
  const standingsComps =
    comps.result?.data.filter(isStandingsCompetition) || [];
  const selectedId =
    standingsComps.find(
      (comp) => comp.id === competition || comp.slug === competition,
    )?.id ||
    standingsComps.find((comp) => comp.slug === "ligue-1")?.id ||
    standingsComps[0]?.id;
  const selected = standingsComps.find((comp) => comp.id === selectedId);
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
        label="CHAMPIONNATS · CHAMPIONS LEAGUE · EUROPA LEAGUE"
        title="Classements"
        description="Retrouvez les six championnats suivis et les phases de ligue de Champions League et d’Europa League, à partir des matchs publiés."
      />
      <DataState {...comps} empty={standingsComps.length === 0}>
        <div className="league-shortcuts">
          {standingsComps.map((comp) => (
            <button
              key={comp.id}
              aria-pressed={comp.id === selectedId}
              onClick={() => {
                setCompetition(comp.id);
                setYear("");
              }}
            >
              {comp.name}
              <small>
                {comp.type === "european-cup" ? "Phase de ligue" : comp.country}
              </small>
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
              {standingsComps.map((comp) => (
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
              {selected?.type === "european-cup" && (
                <Notice>
                  Phase de ligue uniquement : les points et les buts concernent
                  cette compétition, sans inclure les championnats nationaux. Ce
                  tableau est distinct du classement de forme Calcito.
                </Notice>
              )}
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
    [scope, setScope] = useState("all"),
    [quality, setQuality] = useState("all");
  const state = useFootball("dataset");
  const d = state.result?.data;
  const leagues = d?.competitions.filter(isTrackedLeague) || [];
  const years = [...new Set(d?.seasons.map((s) => s.start_year) || [])].sort(
    (a, b) => b - a,
  );
  const selectedYear = Number(year) || years[0];
  const candidates = d ? europeanRows(d, selectedYear) : [];
  const rows = candidates.filter(
    (r) =>
      (!competition || r.league?.id === competition) &&
      (scope === "all" || (scope === "tracked" ? !r.extra : r.extra)) &&
      (quality === "all" ||
        (quality === "complete"
          ? r.status === "complete"
          : r.variant === "provisional")),
  );
  const groups = compatibleRankingGroups(rows);
  return (
    <section className="container page-content">
      <PageHeading
        label="FORME DES CLUBS · PAS UN CLASSEMENT UEFA"
        title="Classement européen Calcito"
        description="Les six championnats suivis et les clubs supplémentaires inscrits aux coupes européennes. Résultats complets et rapides réunis, sans inventer d’indice."
      />
      <Notice>
        Les indices complets et provisoires ne sont classés ensemble que si leur
        compatibilité mathématique est validée. Chaque variante et groupe de
        méthode possède ici son propre classement. Sans méthode définie, les
        clubs restent sans rang ni pourcentage.
      </Notice>
      <DataState {...state}>
        <div className="filter-bar">
          <div className="filter-field">
            <label htmlFor="europe-scope">Clubs</label>
            <select
              id="europe-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">Tous les clubs</option>
              <option value="tracked">Six championnats suivis</option>
              <option value="extra">Clubs européens supplémentaires</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="europe-league">Championnat</label>
            <select
              id="europe-league"
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
            >
              <option value="">Tous les championnats</option>
              {leagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="europe-season">Saison</label>
            <select
              id="europe-season"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">Dernière saison publiée</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}–{y + 1}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="europe-quality">Indices et complétude</label>
            <select
              id="europe-quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="all">Toutes les données</option>
              <option value="complete">Indices complets uniquement</option>
              <option value="provisional">
                Indices provisoires / méthode en attente
              </option>
            </select>
          </div>
        </div>
        {groups.map((group) => (
          <section key={group.key} className="analysis-panel">
            <h2>{group.label}</h2>
            {group.key === "unavailable" && (
              <p className="muted-text">
                Ordre alphabétique, sans classement sportif.
              </p>
            )}
            <div className="table-scroll">
              <table className="official-table">
                <thead>
                  <tr>
                    <th>Rang</th>
                    <th>Équipe</th>
                    <th>Pays</th>
                    <th>Championnat d’origine</th>
                    <th>Indice / complétude</th>
                    <th>5 derniers</th>
                    <th>Historique</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.team.id}>
                      <td>{row.rank ?? "—"}</td>
                      <td>
                        <TeamLink team={row.team} />
                      </td>
                      <td>{row.team.country}</td>
                      <td>{row.origin}</td>
                      <td>
                        <FormValue
                          score={row.score}
                          variant={row.variant}
                          dataMode={row.dataMode}
                        />
                        <small className="coverage-caption">
                          {row.sampleSize} / 5 résultats · {row.detailed}{" "}
                          détaillés · {row.simplified} simplifiés
                          <br />
                          {row.label}
                        </small>
                      </td>
                      <td>
                        <Results results={row.results} demo={false} />
                      </td>
                      <td>
                        <Link
                          to={`/equipes/${row.team.id}?season=${selectedYear}`}
                        >
                          Voir les matchs →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {!rows.length && (
          <p className="muted-text">
            Aucun club dans cette sélection. Les clubs supplémentaires
            apparaissent après publication de leur fiche et de leur
            participation à une saison européenne.
          </p>
        )}
        <SourceCaption result={state.result} />
      </DataState>
    </section>
  );
}
