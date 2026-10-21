import { useEffect, useState } from "react";
import {
  officialPredictionEvents,
  verifiedOffers,
  offeredDecimal,
} from "../services/predictionRankings";
import { createComparisonRankings } from "../services/predictionService";
const percent = (p) =>
  `${(p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const price = (n) =>
  n == null
    ? "—"
    : n.toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
export default function PredictionRankings({
  report,
  match,
  mode,
  controller,
  external,
}) {
  const [manual, setManual] = useState({}),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = Date.now();
  const official =
    mode === "real"
      ? officialPredictionEvents({
          payload: controller?.current?.data,
          match,
          userId: controller?.user?.id,
          now,
        })
      : {
          status: "unavailable",
          events: [],
          reason:
            "Simulation : aucune probabilité officielle validée disponible.",
        };
  const contextId = report.contextId;
  const offers = [
    ...Object.entries(manual).map(([marketId, decimal]) => ({
      marketId,
      decimal,
      contextId,
      source: { type: "manual" },
    })),
    ...verifiedOffers(external, match, now),
  ];
  const ranking = createComparisonRankings({ official, offers });
  const choices = official.events?.length
    ? official.events.map((e) => ({
        id: e.id,
        market: "Prévision officielle",
        selection: e.label,
      }))
    : report.events || [];
  const currentSelection = choices.some((e) => e.id === selected)
    ? selected
    : choices[0]?.id || "";
  function submit(event) {
    event.preventDefault();
    const decimal = offeredDecimal(draft);
    if (decimal === null) {
      setError("Saisis une cote décimale strictement supérieure à 1.");
      return;
    }
    if (!currentSelection) {
      setError("Aucun événement disponible pour cette rencontre.");
      return;
    }
    setManual((values) => ({ ...values, [currentSelection]: decimal }));
    setDraft("");
    setError("");
  }
  const waiting = controller?.busy;
  const unavailable = controller?.current?.error || official.reason;
  return (
    <div className="comparison-rankings">
      <section aria-labelledby="calcito-predictions-title">
        <h3 id="calcito-predictions-title">Les prédictions de Calcito</h3>
        <small className="muted-text">
          TOP 3 · Les plus probables
          {ranking.probabilities.length > 0 ? " · Prévisions officielles" : ""}
        </small>
        {waiting ? (
          <p role="status">Chargement des prévisions officielles…</p>
        ) : ranking.probabilities.length ? (
          <ol className="comparison-ranking-list">
            {ranking.probabilities.map((e) => (
              <li key={e.id}>
                <span>{e.label}</span>
                <strong>{percent(e.probability)}</strong>
                <small>Cote théorique {price(e.theoreticalOdds)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p
            role={
              official.status === "error" || controller?.current?.error
                ? "alert"
                : "status"
            }
          >
            {unavailable}
          </p>
        )}
        {mode === "real" && controller?.user && (
          <button
            type="button"
            className="text-link comparator-disclosure"
            disabled={
              waiting ||
              match?.status !== "scheduled" ||
              Date.parse(match?.kickoff) <= now ||
              match?.timeKnown === false
            }
            onClick={controller.load}
          >
            {waiting
              ? "Calcul serveur…"
              : controller.current?.data
                ? "Actualiser les prévisions officielles"
                : "Charger les prévisions officielles"}
          </button>
        )}
        {mode === "real" && !controller?.user && (
          <p className="muted-text">
            Connecte-toi dans l’Arène pour consulter les prévisions serveur
            validées.
          </p>
        )}
      </section>
      <section aria-labelledby="calcito-value-title">
        <h3 id="calcito-value-title">Les cotes intéressantes</h3>
        <small className="muted-text">
          TOP 3 · Les meilleurs écarts disponibles
        </small>
        {!offers.length && (
          <p role="status">
            Propose une cote pour découvrir ce qu’en pense Calcito.
          </p>
        )}
        {!!offers.length && !ranking.values.length && (
          <p role="status">
            Cote conservée pour cette comparaison ; écart indisponible sans
            probabilité officielle admissible.
          </p>
        )}
        {!!ranking.values.length && (
          <ol className="comparison-ranking-list">
            {ranking.values.map((e) => (
              <li key={e.marketId}>
                <span>{e.label}</span>
                <strong>
                  {e.edge > 0 ? "+" : ""}
                  {percent(e.edge)}
                </strong>
                <small>
                  Calcito {percent(e.officialProbability)} · théorique{" "}
                  {price(e.theoreticalOdds)} · proposée {price(e.offeredOdds)}
                </small>
                <small>
                  {e.oddsSource.type === "manual"
                    ? "Cote saisie manuellement"
                    : `Cote externe vérifiée · ${e.oddsSource.bookmaker}`}{" "}
                  ·{" "}
                  {e.assessment === "favourable"
                    ? "écart favorable"
                    : e.assessment === "unfavourable"
                      ? "écart défavorable"
                      : "écart nul"}
                </small>
              </li>
            ))}
          </ol>
        )}
        <form className="comparison-odds-form" onSubmit={submit}>
          <label>
            Événement
            <select
              value={currentSelection}
              onChange={(e) => {
                setSelected(e.target.value);
                setError("");
              }}
              disabled={!choices.length}
            >
              {!choices.length && (
                <option value="">Aucun événement disponible</option>
              )}
              {choices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.market} · {e.selection}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cote à comparer
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="1,90"
              disabled={!choices.length}
            />
          </label>
          <button
            className="button button-secondary"
            type="submit"
            disabled={!choices.length}
          >
            Ajouter la cote
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {!!Object.keys(manual).length && (
          <details>
            <summary>Cotes manuelles · {Object.keys(manual).length}</summary>
            <ul>
              {Object.entries(manual).map(([id, decimal]) => (
                <li key={id}>
                  {choices.find((e) => e.id === id)?.selection || id} ·{" "}
                  {price(decimal)}{" "}
                  <button
                    className="text-link"
                    type="button"
                    aria-label={`Retirer la cote ${id}`}
                    onClick={() =>
                      setManual((values) =>
                        Object.fromEntries(
                          Object.entries(values).filter(([key]) => key !== id),
                        ),
                      )
                    }
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {!!ranking.values.length && (
          <p className="muted-text">
            Écart théorique selon le modèle, sans garantie de gain.
          </p>
        )}
      </section>
      <details className="comparator-validation">
        <summary>Sources et méthode des classements</summary>
        <p>
          Probabilités officielles : prévisions serveur validées, même rencontre
          et même calibration ; aucun résultat expérimental utilisé. Une seule
          sélection par famille pour diversifier les prédictions ; les seuils de
          buts constituent une famille. Tri par probabilité, puis identifiant en
          cas d’égalité.
        </p>
        <p>
          Écart = probabilité officielle × cote proposée − 1. Tri décroissant,
          trois événements distincts maximum ; un écart négatif reste identifié
          comme défavorable. Les cotes de jeu de l’Arène ne sont pas des cotes
          commerciales proposées.
        </p>
        {official.events?.length > 0 && (
          <p>
            Source : arena_quote · version {official.events[0].modelVersion} ·
            calcul{" "}
            {new Date(
              official.events[0].predictionRef.createdAt,
            ).toLocaleString("fr-FR")}
            .
          </p>
        )}
        <p>
          Les cotes manuelles restent en mémoire sur cette comparaison ; aucun
          enregistrement ni négociation.
        </p>
      </details>
    </div>
  );
}
