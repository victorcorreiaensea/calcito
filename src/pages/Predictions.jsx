import { useSearchParams } from "react-router-dom";
import { simulatedProfile } from "../services/simulation";
import { useFootball } from "../hooks/useFootball";
import { calculatePrediction } from "../engines/predictionEngine";
import { createPredictionHistory } from "../services/predictionHistory";
import {
  PageHeading,
  DataState,
  TeamLink,
  FormValue,
  Notice,
} from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";
import CalcitoMascot from "../components/CalcitoMascot";

function PredictionHistory() {
  let records = [],
    error = null;
  try {
    records = createPredictionHistory(window.localStorage).list();
  } catch {
    error =
      "Historique local inaccessible ou illisible. Aucun enregistrement n’a été supprimé.";
  }
  return (
    <section className="analysis-panel history-panel">
      <div className="panel-heading">
        <h2>Historique des pronostics</h2>
        <span className="status-pill">Stockage local prévu</span>
      </div>
      <p className="muted-text">
        Match, date du calcul, version du modèle, probabilités, résultat final
        et évaluation. Les futurs enregistrements locaux resteront propres à ce
        navigateur.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : records.length ? (
        <div className="table-scroll">
          <table className="official-table">
            <caption>Pronostics enregistrés sur ce navigateur</caption>
            <thead>
              <tr>
                <th>Match</th>
                <th>Date</th>
                <th>1 / N / 2</th>
                <th>Résultat</th>
                <th>Évaluation</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    {record.match.homeName} — {record.match.awayName}
                  </td>
                  <td>
                    {new Date(record.predictedAt).toLocaleString("fr-FR")}
                  </td>
                  <td>
                    {["home", "draw", "away"]
                      .map(
                        (key) =>
                          `${(record.probabilities[key] * 100).toFixed(1)} %`,
                      )
                      .join(" / ")}
                  </td>
                  <td>
                    {{ home: "1", draw: "N", away: "2" }[record.finalResult] ||
                      "En attente"}
                  </td>
                  <td>
                    {record.evaluation?.value?.toFixed(3) ?? "Non évalué"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="history-empty">
          Aucun pronostic enregistré. L’historique commencera après
          l’intégration d’un modèle calibré.
        </div>
      )}
    </section>
  );
}
export default function Predictions() {
  const state = useFootball("matches");
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("match");
  const match = selectedId
    ? state.result?.data.find((item) => item.id === selectedId)
    : state.result?.data[0];
  const prediction = calculatePrediction({ match });
  const demo = state.result?.mode === "demo";
  return (
    <section className="container page-content">
      <PageHeading
        label="COMPRENDRE AVANT D’ANTICIPER"
        title="Pronostics"
        description="Un futur modèle probabiliste distinct de l’indice de forme. Les estimations ne seront affichées qu’après calibration et validation."
      />
      <CalcitoMascot
        variant="analysis"
        title="Modèle en développement"
        message="Un indice de forme n’est pas une probabilité de victoire. Aucun pronostic ni aucune cote n’est inventé ici."
      />
      <DataState {...state} empty={state.result?.data.length === 0}>
        {!match ? (
          <Notice>
            Ce match est introuvable. Choisissez une autre rencontre.
          </Notice>
        ) : null}
        <div className="filter-bar">
          <div className="filter-field prediction-select">
            <label htmlFor="prediction-match">
              Rencontre à analyser{demo ? " · fictive" : ""}
            </label>
            <select
              id="prediction-match"
              value={match?.id || ""}
              onChange={(event) =>
                setParams({ match: event.target.value }, { replace: true })
              }
            >
              {!match && <option value="">Choisir une rencontre</option>}
              {state.result?.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.home.name} — {item.away.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {match && (
          <section className="analysis-panel prediction-panel">
            <div className="prediction-teams">
              <div>
                <TeamLink team={match.home} />
                <FormValue
                  score={
                    match.home.score ?? simulatedProfile(match.home.id).score
                  }
                  demo
                />
              </div>
              <span>VS</span>
              <div>
                <TeamLink team={match.away} />
                <FormValue
                  score={
                    match.away.score ?? simulatedProfile(match.away.id).score
                  }
                  demo
                />
              </div>
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
              {prediction.status === "model-pending"
                ? "Modèle en développement : aucune probabilité 1/N/2 ni cote disponible. Les futures probabilités devront totaliser 100 % ; les cotes théoriques seront leurs inverses décimaux."
                : ""}
            </Notice>
            <dl className="prediction-metadata">
              <div>
                <dt>Date du calcul</dt>
                <dd>Non calculé</dd>
              </div>
              <div>
                <dt>Qualité des données</dt>
                <dd>{demo ? "Démonstration fictive" : "Non évaluée"}</dd>
              </div>
              <div>
                <dt>Facteurs utilisés</dt>
                <dd>Aucun calcul exécuté</dd>
              </div>
            </dl>
          </section>
        )}
        <SourceCaption result={state.result} />
      </DataState>
      <PredictionHistory />
    </section>
  );
}
