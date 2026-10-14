import { ScanLine, SlidersHorizontal, ChartNoAxesCombined } from "lucide-react";
import { PageHeading, Notice } from "../components/FootballUI";
import { priorityCompetitions } from "../demoData";

export default function Methodology() {
  return (
    <section className="container page-content">
      <PageHeading
        label="UNE LECTURE TRANSPARENTE DU JEU"
        title="Méthodologie"
        description="Les résultats vérifiés, les classements reconstruits et les futurs modèles ont chacun leur rôle. Les données manquantes restent visibles."
      />
      <Notice>
        Les résultats rapides des championnats non suivis rejoignent les cinq
        derniers matchs. Ils renseignent uniquement le score : les statistiques
        absentes restent inconnues. L’indice résultats provisoire utilise les
        résultats, les buts et le terrain des cinq derniers matchs. Il ne s’agit
        pas d’une probabilité de victoire. Ces résultats rapides ne modifient
        jamais les classements nationaux.
      </Notice>
      <div className="method-grid">
        {[
          [
            ScanLine,
            "01",
            "Saisir et vérifier",
            "L’administrateur enregistre chaque match une seule fois : score, statistiques des deux équipes, source et date de vérification. Les brouillons restent privés.",
          ],
          [
            SlidersHorizontal,
            "02",
            "Préparer la forme",
            "Les cinq derniers matchs officiels, toutes compétitions confondues dans la même saison, constituent les données d’entrée du futur indice.",
          ],
          [
            ChartNoAxesCombined,
            "03",
            "Lire et comparer",
            "Les visiteurs consultent les données publiées, les classements partiels et les comparaisons sans avoir besoin de se connecter.",
          ],
        ].map(([Icon, n, title, text]) => (
          <article className="method-card" key={n}>
            <div className="method-top">
              <Icon size={27} />
              <span>{n}</span>
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <div className="detail-grid methodology-panels">
        <section className="analysis-panel">
          <h2>Forme provisoire v2 : résultats, buts et terrain</h2>
          <p>
            Les cinq derniers matchs publiés de la saison, toutes compétitions
            confondues, ont le même poids. Les résultats dominent le calcul ;
            marquer davantage et encaisser moins améliorent aussi la forme. Les
            effets des buts diminuent progressivement pour éviter qu’une seule
            large victoire écrase les autres matchs.
          </p>
          <ul className="feature-list">
            <li>Résultat : poids 55 (victoire 1, nul 1/3, défaite 0)</li>
            <li>
              Différence de buts : poids 20, via (1 + tanh((BM − BE)/2))/2
            </li>
            <li>Défense : poids 10, via 1/(BE + 1)</li>
            <li>Attaque : poids 5, via BM/(BM + 2)</li>
            <li>
              Résultat à l’extérieur : bonus 4 pour une victoire, 2 pour un nul
            </li>
            <li>Buts à l’extérieur : bonus 3 × BM/(BM + 2)</li>
            <li>Clean sheet à domicile : bonus 3 si aucun but encaissé</li>
          </ul>
          <p>
            BM = buts marqués ; BE = buts encaissés. Chaque match reçoit la
            somme de ces contributions. L’indice vaut 100 × la moyenne des cinq
            matchs / 97. Le plafond commun de 97 tient compte de l’exclusion
            mutuelle des bonus domicile et extérieur : l’indice reste entre 0 et
            100, avec la même échelle pour toutes les équipes. Un terrain
            inconnu ne reçoit aucun bonus et est signalé.
          </p>
          <p>
            Ces poids constituent une proposition provisoire explicite, sans
            calibration prédictive. Version : results-context-v2. Les anciens
            indices basés uniquement sur les points ne sont pas réutilisés. Les
            statistiques avancées ne changent pas ce calcul. La formule
            propriétaire reste distincte et les groupes de comparaison séparés.
          </p>
          <h2>L’indice propriétaire Calcito</h2>
          <ul className="feature-list">
            <li>Cinq derniers matchs officiels publiés</li>
            <li>Résultats, tirs, grosses occasions et notes d’équipe</li>
            <li>Bonus et coefficients fournis par le propriétaire</li>
            <li>
              Coefficient de 1,20 pour les compétitions européennes expressément
              confirmées
            </li>
          </ul>
          <Notice>
            La formule exacte reste à fournir. Aucun score n’est inventé et
            aucune donnée manquante ne devient zéro. « Indice indisponible » est
            affiché tant que le calcul n’est pas possible.
          </Notice>
        </section>
        <section className="analysis-panel">
          <h2>Un classement honnête sur sa couverture</h2>
          <p className="muted-text">
            Les points sont reconstruits à partir des matchs terminés publiés et
            des règles configurées pour la saison. Les sanctions de points
            doivent être justifiées.
          </p>
          <Notice>
            « Classement partiel » reste visible tant que les matchs
            nécessaires, les règles et les vérifications ne sont pas complets.
            Les départages sont configurables ; une égalité non résolue garde un
            rang partagé.
          </Notice>
          <p className="muted-text">
            Le classement européen Calcito compare les indices, pas les points
            de championnat. Il n’est pas un classement UEFA.
          </p>
        </section>
      </div>
      <section className="analysis-panel">
        <h2>Pronostics : un modèle à part entière</h2>
        <p className="muted-text">
          Le futur modèle probabiliste devra être calibré. Ses trois
          probabilités totaliseront 100 %, les cotes théoriques seront leurs
          inverses et les calculs conserveront leur date, version et qualité des
          données.
        </p>
        <Notice>
          Modèle de pronostics en développement. Aucun pari, paiement, bookmaker
          ou lien d’affiliation.
        </Notice>
      </section>
      <Notice>
        Les résultats OpenFootball sont issus d’un jeu de données CC0. Les
        compléments adaptés depuis Wikipédia sont attribués à la page source de
        chaque match et partagés sous{" "}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY-SA 4.0
        </a>
        . Les noms sont associés aux fiches Calcito ; les relevés incomplets et
        dates contradictoires sont signalés avant import.
      </Notice>
      <section className="analysis-panel">
        <h2>Compétitions prévues</h2>
        <div className="competition-chips">
          {[
            ...priorityCompetitions.slice(0, 7),
            "UEFA Europa League",
            "UEFA Conference League",
          ].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <p className="muted-text">
          Chaque saison possède ses propres participants. Les données d’une
          saison ne remplacent pas celles des précédentes.
        </p>
      </section>
    </section>
  );
}
