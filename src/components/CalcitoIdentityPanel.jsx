import { Link } from "react-router-dom";
import CalcitoMascot from "./CalcitoMascot";
import { calcitoPersonality } from "../domain/calcitoPersonality";
import { negotiationContract } from "../domain/negotiationContract";
import { statisticalVerdict } from "../services/predictionService";

export default function CalcitoIdentityPanel({ report, match }) {
  const personality = calcitoPersonality({
    verdict: statisticalVerdict(report),
  });
  return (
    <>
      <section
        className="comparator-identity"
        aria-labelledby="calcito-challenge-title"
      >
        <div className="comparator-forecast-heading">
          <h2 id="calcito-challenge-title">Défier Calcito</h2>
          <span className="status-pill">En développement</span>
        </div>
        <p className="comparator-note">
          La négociation en trois propositions est en préparation.
        </p>
        <fieldset disabled className="comparator-negotiation-fields">
          <label>
            Événement à négocier
            <select defaultValue="" aria-label="Événement à négocier">
              <option value="">Sélection de l’événement à venir</option>
            </select>
          </label>
          <label>
            Cote proposée
            <input
              type="text"
              inputMode="decimal"
              placeholder="—"
              aria-label="Cote proposée"
            />
          </label>
          <button type="button" className="button button-secondary">
            Proposer une cote
          </button>
        </fieldset>
        <dl className="comparator-identity-facts">
          <div>
            <dt>Limite prévue</dt>
            <dd>
              {negotiationContract.maxAttempts} propositions par négociation
            </dd>
          </div>
          <div>
            <dt>Tentatives restantes</dt>
            <dd>— · négociation non activée</dd>
          </div>
          <div>
            <dt>Historique de négociation</dt>
            <dd>En développement</dd>
          </div>
        </dl>
        <Link
          className="text-link"
          to={match ? `/arene?match=${match.id}` : "/arene"}
        >
          Ouvrir les défis existants de l’Arène →
        </Link>
      </section>
      <section
        className="comparator-identity"
        aria-labelledby="calcito-personality-title"
      >
        <h2 id="calcito-personality-title">Personnalité et réactions</h2>
        <CalcitoMascot
          variant="compare"
          emotion={personality.emotion}
          title={`Humeur : ${personality.label}`}
          message={personality.comment}
        />
        <dl className="comparator-identity-facts">
          <div>
            <dt>Verdict statistique</dt>
            <dd>{personality.scientificVerdict}</dd>
          </div>
          <div>
            <dt>Décision personnelle</dt>
            <dd>En développement · aucune exception émotionnelle appliquée</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
