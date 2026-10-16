import { useState } from "react";
import { calculateResultsForm } from "../engines/resultsFormEngine";
import { calculateSurprise } from "../engines/dynamicFormEngine";
import { dynamicFormModel } from "../config/dynamicFormModel";
import CalcitoMascot from "./CalcitoMascot";
const steps = [
  [
    "Le résultat",
    "Une victoire apporte plus qu’un nul, un nul plus qu’une défaite. Le résultat représente 55 points de la base avant normalisation ; les buts et le terrain complètent cette lecture.",
  ],
  [
    "L’adversaire",
    "Le moteur compare les indices connus avant le match et tient compte du terrain. Une surprise ajuste la performance jusqu’à 8 points, dans la limite de 0 à 100. Les labels d’exploit nécessitent cinq matchs antérieurs pour les deux clubs.",
  ],
  [
    "Les cinq matchs",
    "Le moteur actuellement exécuté prend les cinq dernières performances à poids égaux, dans une même saison. Le modèle A + C sur huit matchs et ses coefficients 0,7 / 0,5 / 0,3 ne sont pas intégrés.",
  ],
  [
    "Le rythme immédiat",
    "La lecture instantanée est la moyenne descriptive des trois dernières performances calculées. Elle complète la lecture du club ; elle ne modifie pas l’indice principal.",
  ],
  [
    "L’indice final",
    "La moyenne des cinq performances donne l’indice sur 100. Avant cinq matchs, l’indice public reste indisponible. Les références neutres d’initialisation sont signalées dans les historiques.",
  ],
  [
    "Probabilités & cotes",
    "85/100 de forme n’est pas 85 % de chances de gagner. Le modèle de buts Poisson est distinct, calibré et évalué dans l’ordre chronologique. Sans validation ou historique suffisant : pas de cote.",
  ],
];
export default function MethodJourney() {
  const [step, setStep] = useState(0),
    [gf, setGf] = useState(2),
    [ga, setGa] = useState(0),
    [opponent, setOpponent] = useState(65),
    [venue, setVenue] = useState("home");
  const base = calculateResultsForm(
    Array.from({ length: 5 }, () => ({
      goals_for: gf,
      goals_against: ga,
      venue,
    })),
  ).score;
  const surprise = calculateSurprise({
    ownBefore: 50,
    opponentBefore: opponent,
    goalsFor: gf,
    goalsAgainst: ga,
    venue,
    reliable: true,
  });
  const performance = Math.max(0, Math.min(100, base + surprise.adjustment));
  return (
    <>
      <section className="method-journey analysis-panel">
        <span className="eyebrow">SUIVEZ LE GUIDE</span>
        <h2>Du terrain à l’indice.</h2>
        <div className="journey-steps" aria-label="Étapes de la méthode">
          {steps.map(([title], i) => (
            <button
              key={title}
              aria-pressed={step === i}
              onClick={() => setStep(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {title}
            </button>
          ))}
        </div>
        <div aria-live="polite">
          <CalcitoMascot
            emotion="focused"
            title={steps[step][0]}
            message={steps[step][1]}
          />
        </div>
        <div className="journey-navigation">
          <button disabled={!step} onClick={() => setStep(step - 1)}>
            ← Précédent
          </button>
          <span>
            {step + 1} / {steps.length}
          </span>
          <button
            disabled={step === steps.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Suivant →
          </button>
        </div>
      </section>
      <section className="analysis-panel performance-lab">
        <span className="demo-label">LABORATOIRE · SCÉNARIO FICTIF</span>
        <h2>Et si le match se passait autrement ?</h2>
        <p>
          Ta référence avant match est fixée à 50/100. Modifie le scénario : le
          véritable moteur V4 calcule la performance d’une rencontre, pas un
          indice d’équipe ni une prévision.
        </p>
        <div className="lab-controls">
          <label>
            Buts marqués
            <input
              type="number"
              min="0"
              max="20"
              value={gf}
              onChange={(e) =>
                setGf(Math.min(20, Math.max(0, Number(e.target.value))))
              }
            />
          </label>
          <label>
            Buts encaissés
            <input
              type="number"
              min="0"
              max="20"
              value={ga}
              onChange={(e) =>
                setGa(Math.min(20, Math.max(0, Number(e.target.value))))
              }
            />
          </label>
          <label>
            Indice de l’adversaire : {opponent}
            <input
              type="range"
              min="0"
              max="100"
              value={opponent}
              onChange={(e) => setOpponent(Number(e.target.value))}
            />
          </label>
          <label>
            Terrain
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="home">Domicile</option>
              <option value="away">Extérieur</option>
            </select>
          </label>
        </div>
        <div className="lab-result" aria-live="polite">
          <div>
            <span>Performance de ce match fictif</span>
            <strong>
              {performance.toFixed(1)}
              <small> / 100</small>
            </strong>
          </div>
          <p>
            {gf > ga ? "Victoire" : gf === ga ? "Match nul" : "Défaite"} · Base
            normalisée {base.toFixed(1)} · Ajustement adversaire{" "}
            {surprise.adjustment >= 0 ? "+" : ""}
            {surprise.adjustment.toFixed(1)}
            <br />
            <small>Le résultat final reste borné entre 0 et 100.</small>
          </p>
        </div>
        <details>
          <summary>Voir le calcul détaillé</summary>
          <p>
            Base : résultat 55, différence de buts 20, défense 10, attaque 5,
            résultat extérieur 4, buts à l’extérieur 3, clean sheet à domicile
            3. Les bonus de terrain sont exclusifs : base divisée par 97 puis
            multipliée par 100. Ajustement : 8 × (résultat effectif − attente
            logistique), avec avantage domicile {dynamicFormModel.homeAdvantage}{" "}
            et échelle {dynamicFormModel.expectationScale}. La moyenne des cinq
            performances produit ensuite l’indice principal.
          </p>
        </details>
      </section>
    </>
  );
}
