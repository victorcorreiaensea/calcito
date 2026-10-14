import { Link, useSearchParams } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import { useTeamAnalysis } from "../components/TeamAnalysis";
import {
  PageHeading,
  DataState,
  TeamLink,
  FormValue,
  Results,
  Notice,
} from "../components/FootballUI";
import { SeasonSelect, SourceCaption } from "../components/DataContext";
import { TeamPicker, ComparativeStatistics } from "./Compare";
import CalcitoMascot from "../components/CalcitoMascot";

export default function Predictions() {
  const [params, setParams] = useSearchParams();
  const homeId = params.get("home") || "",
    awayId = params.get("away") || "",
    year = params.get("season") || "";
  const home = useFootball(
      "team",
      { teamId: homeId, season: year },
      { enabled: Boolean(homeId) },
    ),
    away = useFootball(
      "team",
      { teamId: awayId, season: year },
      { enabled: Boolean(awayId) },
    );
  const a = useTeamAnalysis(home.result?.data.id, year),
    b = useTeamAnalysis(away.result?.data.id, year);
  const dataset = useFootball("dataset");
  const history = dataset.result?.data.predictions || [];
  function set(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <section className="container page-content">
      <PageHeading
        label="COMPRENDRE AVANT D’ANTICIPER"
        title="Pronostics"
        description="Choisissez deux équipes pour lire leur dynamique. Les probabilités et cotes attendent un modèle distinct, calibré et validé."
      />
      <CalcitoMascot
        variant="analysis"
        title="La forme avant les probabilités"
        message="Un indice de forme n’est pas une probabilité de victoire. Les cotes de l’Arène reposent sur un modèle de buts distinct, uniquement après validation historique."
      />
      <Link className="button button-primary arena-link" to="/arene">
        Découvrir l’Arène & les Calcithunes →
      </Link>
      <div className="filter-bar">
        <SeasonSelect value={year} onChange={(value) => set("season", value)} />
      </div>
      <div className="picker-grid predictions-pickers">
        <TeamPicker
          label="Équipe à domicile"
          value={homeId}
          excluded={awayId}
          season={year}
          onChange={(value) => set("home", value)}
        />
        <span className="comparison-vs">VS</span>
        <TeamPicker
          label="Équipe à l’extérieur"
          value={awayId}
          excluded={homeId}
          season={year}
          onChange={(value) => set("away", value)}
        />
      </div>
      {homeId && awayId && homeId === awayId ? (
        <Notice>Choisissez deux équipes différentes.</Notice>
      ) : homeId && awayId ? (
        <DataState
          loading={home.loading || away.loading}
          error={home.error || away.error}
        >
          {home.result && away.result && (
            <>
              <section className="analysis-panel prediction-panel">
                <div className="prediction-teams">
                  {[
                    [home.result.data, a],
                    [away.result.data, b],
                  ].map(([team, analysis]) => (
                    <div key={team.id}>
                      <TeamLink team={team} />
                      <FormValue
                        score={
                          year && Number(year) !== team.season
                            ? null
                            : team.score
                        }
                      />
                      <Results results={analysis.results} demo={false} />
                    </div>
                  ))}
                </div>
                <div className="probability-grid">
                  {[
                    ["1", "Victoire domicile"],
                    ["N", "Match nul"],
                    ["2", "Victoire extérieur"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <span>
                        {key} · {label}
                      </span>
                      <strong>—</strong>
                      <small>Probabilité indisponible</small>
                      <hr />
                      <span>Cote théorique</span>
                      <b>—</b>
                    </div>
                  ))}
                </div>
                <Notice>
                  Modèle de pronostics en développement. Aucune conversion
                  directe des indices en probabilités. Les futures probabilités
                  totaliseront 100 % ; la cote théorique sera leur inverse
                  décimal.
                </Notice>
                <dl className="prediction-metadata">
                  <div>
                    <dt>Date du calcul</dt>
                    <dd>Non calculé</dd>
                  </div>
                  <div>
                    <dt>Qualité des données</dt>
                    <dd>
                      {a.results.length} / 5 matchs domicile ·{" "}
                      {b.results.length} / 5 extérieur
                    </dd>
                  </div>
                  <div>
                    <dt>Facteurs utilisés</dt>
                    <dd>Aucun calcul probabiliste exécuté</dd>
                  </div>
                </dl>
              </section>
              <ComparativeStatistics
                left={a}
                right={b}
                leftTeam={home.result.data}
                rightTeam={away.result.data}
              />
            </>
          )}
        </DataState>
      ) : (
        <Notice>
          Sélectionnez les deux équipes pour afficher leurs données publiées.
        </Notice>
      )}
      <section className="analysis-panel">
        <h2>Historique des pronostics</h2>
        <p className="muted-text">
          Les futures prévisions seront enregistrées en base avant le coup
          d’envoi, puis comparées au résultat final. Aucun faux historique n’est
          créé.
        </p>
        {history.length ? (
          <div className="table-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Date de calcul</th>
                  <th>1 / N / 2</th>
                  <th>Résultat</th>
                  <th>Évaluation</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {dataset.result.data.matches.find(
                        (m) => m.id === row.match_id,
                      )?.round || "Match publié"}
                    </td>
                    <td>
                      {new Date(row.predicted_at).toLocaleString("fr-FR")}
                    </td>
                    <td>
                      {[
                        row.home_probability,
                        row.draw_probability,
                        row.away_probability,
                      ]
                        .map((value) => `${(Number(value) * 100).toFixed(1)} %`)
                        .join(" / ")}
                    </td>
                    <td>{row.final_result || "En attente"}</td>
                    <td>{row.evaluation?.value ?? "Non évalué"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="history-empty">
            Aucun pronostic publié. L’historique commencera après l’intégration
            du modèle.
          </p>
        )}
        <SourceCaption result={dataset.result} />
      </section>
    </section>
  );
}
