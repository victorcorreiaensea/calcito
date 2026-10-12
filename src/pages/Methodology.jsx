import { ScanLine, SlidersHorizontal, ChartNoAxesCombined } from "lucide-react";
import { methodology, priorityCompetitions } from "../demoData";
import { PageHeading, Notice } from "../components/FootballUI";

export default function Methodology() {
  return (
    <section className="container page-content">
      <PageHeading
        label="UNE LECTURE TRANSPARENTE DU JEU"
        title="Méthodologie"
        description="Distinguer ce que les données montrent, ce que l’algorithme calculera et ce qui reste à développer."
      />
      <div className="method-grid">
        {methodology.map((step, i) => {
          const Icon = [ScanLine, SlidersHorizontal, ChartNoAxesCombined][i];
          return (
            <article className="method-card" key={step.number}>
              <div className="method-top">
                <Icon size={27} />
                <span>{step.number}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          );
        })}
      </div>
      <div className="detail-grid methodology-panels">
        <section className="analysis-panel">
          <h2>L’indice de forme Calcito</h2>
          <p className="muted-text">
            Les cinq derniers matchs terminés constituent les données d’entrée.
            Le module conserve leur date, leur résultat et leur référence
            source.
          </p>
          <ul className="feature-list">
            <li>Résultat du match et tirs</li>
            <li>Grosses occasions et notes d’équipe</li>
            <li>Bonus fournis et coefficients de compétition</li>
            <li>
              Coefficient européen de 1,20 uniquement pour les compétitions
              explicitement confirmées
            </li>
          </ul>
          <Notice>
            La formule exacte, les autres coefficients et les compétitions
            auxquelles appliquer 1,20 restent à fournir. Des données manquantes
            bloquent le calcul ; elles ne sont jamais remplacées par zéro.
          </Notice>
        </section>
        <section className="analysis-panel">
          <h2>Des probabilités à part entière</h2>
          <p className="muted-text">
            Un futur modèle calibré estimera les trois issues d’un match.
            L’indice de forme ne sera jamais converti directement en
            probabilité.
          </p>
          <ul className="feature-list">
            <li>Probabilités décimales totalisant 1 (100 %)</li>
            <li>Cote théorique = 1 / probabilité décimale</li>
            <li>Date, version du modèle et qualité des données</li>
            <li>Historique et évaluation après résultat final</li>
          </ul>
          <Notice>
            Modèle en développement. Aucun pari, paiement, bookmaker ou lien
            d’affiliation.
          </Notice>
        </section>
      </div>
      <section className="analysis-panel">
        <h2>Couverture envisagée</h2>
        <p className="muted-text">
          La disponibilité effective dépendra du fournisseur autorisé et des
          droits d’accès. Cette liste ne constitue pas une couverture
          actuellement connectée.
        </p>
        <div className="competition-chips">
          {priorityCompetitions.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </section>
      <Notice>
        Mode démonstration : équipes, résultats, dates et indices fictifs sont
        explicitement identifiés. Aucun classement officiel ni statistique
        manquante n’est inventé.
      </Notice>
    </section>
  );
}
