import { Sparkles } from "lucide-react";
import { calculateSurprise } from "../engines/dynamicFormEngine";
import CalcitoMascot from "./CalcitoMascot";
const scenarios = [
  {
    name: "Une victoire attendue",
    own: 88,
    opponent: 45,
    gf: 2,
    ga: 0,
    venue: "home",
  },
  {
    name: "Une victoire surprise",
    own: 45,
    opponent: 88,
    gf: 2,
    ga: 0,
    venue: "away",
  },
  {
    name: "Un nul contre un favori",
    own: 45,
    opponent: 88,
    gf: 1,
    ga: 1,
    venue: "away",
  },
];
export default function SurpriseEducation() {
  return (
    <section className="analysis-panel surprise-education">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SURPRISE CALCITO</span>
          <h2>Tous les résultats ne se valent pas.</h2>
          <p>
            Battre une équipe en difficulté et battre une équipe au sommet de sa
            forme ne représentent pas le même défi. Calcito regarde le niveau de
            l’adversaire avant la rencontre.
          </p>
        </div>
        <span className="demo-label">EXEMPLES FICTIFS</span>
      </div>
      <div className="surprise-scenarios">
        {scenarios.map((s) => {
          const r = calculateSurprise({
            ownBefore: s.own,
            opponentBefore: s.opponent,
            goalsFor: s.gf,
            goalsAgainst: s.ga,
            venue: s.venue,
            reliable: true,
          });
          return (
            <article key={s.name}>
              <Sparkles size={21} />
              <h3>{s.name}</h3>
              <p>
                Avant : {s.own} vs {s.opponent} / 100
              </p>
              <strong>
                {s.gf} – {s.ga}
              </strong>
              <span>{s.venue === "home" ? "Domicile" : "Extérieur"}</span>
              <div
                className="surprise-meter"
                aria-label={`Surprise ${Math.round(r.surprise * 100)} sur une échelle de moins cent à plus cent`}
              >
                <i style={{ width: `${Math.max(0, r.surprise) * 100}%` }} />
              </div>
              <p>{r.label || "Une victoire positive, sans label d’exploit."}</p>
              <small>
                Ajustement de performance : +
                {r.adjustment.toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                })}{" "}
                · pas la variation totale de l’indice
              </small>
            </article>
          );
        })}
      </div>
      <CalcitoMascot
        variant="analysis"
        title="Le défi compte aussi."
        message="Je compare deux références connues avant le coup d’envoi. Un exploit apporte un supplément mesuré ; il ne remplace ni les buts ni les cinq derniers matchs."
      />
      <p className="form-footnote">
        La surprise est complémentaire et bornée. Les labels exigent cinq matchs
        antérieurs pour chaque équipe. Une référence neutre aide à démarrer,
        sans faire croire qu’on connaît déjà sa force. L’indice n’est jamais une
        probabilité de victoire.
      </p>
    </section>
  );
}
