import { Navigate, useSearchParams } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import { SourceCaption } from "../components/DataContext";
export default function Predictions() {
  const [old] = useSearchParams();
  const next = new URLSearchParams(old);
  if (old.get("home")) next.set("team", old.get("home"));
  if (old.get("away")) next.set("against", old.get("away"));
  next.delete("home");
  next.delete("away");
  return <Navigate replace to={`/comparateur?${next}`} />;
}
export function PredictionHistory() {
  const dataset = useFootball("dataset");
  const history = dataset.result?.data.predictions || [];
  return (
    <section className="analysis-panel">
      <h2>Historique des pronostics</h2>
      <p className="muted-text">
        Prévisions publiées enregistrées avant la rencontre. Cet historique est
        distinct des tickets privés et de leurs cotes figées, consultables dans
        le profil de l’Arène.
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
                  <td>{new Date(row.predicted_at).toLocaleString("fr-FR")}</td>
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
          Aucun pronostic publié dans cet historique.
        </p>
      )}
      <SourceCaption result={dataset.result} />
    </section>
  );
}
