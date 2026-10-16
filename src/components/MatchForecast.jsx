import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../admin/AuthProvider";
import { arenaQuote } from "../services/arenaRepository";
export default function MatchForecast({ match }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setState(null);
    setBusy(false);
  }, [match.id, user?.id]);
  async function load() {
    setBusy(true);
    try {
      setState({
        id: match.id,
        user: user?.id,
        data: await arenaQuote(match.id),
      });
    } catch {
      setState({
        id: match.id,
        user: user?.id,
        error:
          "Les prévisions sont indisponibles : modèle validé, historique suffisant et rencontre future à heure précise nécessaires.",
      });
    } finally {
      setBusy(false);
    }
  }
  const current =
    state?.id === match.id && state?.user === user?.id ? state : null;
  return (
    <section className="analysis-panel forecast-panel">
      <span className="eyebrow">LE MODÈLE DE BUTS · DISTINCT DE L’INDICE</span>
      <h2>Prévisions de la rencontre</h2>
      {!user ? (
        <p>
          <Link className="text-link" to={`/arene?match=${match.id}`}>
            Se connecter pour consulter les cotes serveur →
          </Link>
        </p>
      ) : (
        <button
          className="button button-secondary"
          disabled={
            busy ||
            match.status !== "scheduled" ||
            Date.parse(match.kickoff) <= Date.now()
          }
          onClick={load}
        >
          {busy ? "Calcul serveur…" : "Consulter les prévisions réelles"}
        </button>
      )}
      {current?.data?.forecast && (
        <div className="forecast-triplet">
          {[
            ["home", "Domicile"],
            ["draw", "Nul"],
            ["away", "Extérieur"],
          ].map(([k, label]) => (
            <div key={k}>
              <span>{label}</span>
              <strong>
                {(Number(current.data.forecast[k]) * 100).toFixed(1)} %
              </strong>
              <small>Estimation du modèle</small>
            </div>
          ))}
        </div>
      )}
      {current?.data?.quotes?.length > 0 && (
        <div className="forecast-prices">
          {current.data.quotes.map((q) => (
            <Link key={q.id} to={`/arene?match=${match.id}`}>
              {q.market} · {Number(q.odds).toFixed(2)}
            </Link>
          ))}
        </div>
      )}
      <p role="status" className="muted-text">
        {current?.error ||
          current?.data?.reason ||
          "Aucune conversion de l’indice en probabilité. Les cotes ne sont affichées qu’après un calcul serveur validé."}
      </p>
      <Link className="button button-primary" to={`/arene?match=${match.id}`}>
        Défier Calcito →
      </Link>
    </section>
  );
}
