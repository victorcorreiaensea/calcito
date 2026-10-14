import { FormFactors, MascotEditorial } from "../components/FormEducation";
import FormCore from "../components/FormCore";
import FormPlayground from "../components/FormPlayground";
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
      <section className="methodology-intro analysis-panel">
        <div>
          <span className="eyebrow">LA FORME, PAS LE HASARD</span>
          <h2>Un noyau. Cinq matchs. Toute une dynamique.</h2>
          <p>
            Calcito rassemble les cinq dernières rencontres publiées d’une
            équipe pour lire ses résultats, son attaque, sa défense et ses
            performances à l’extérieur.
          </p>
          <p className="form-footnote">
            L’anneau exprime l’indice sur 100. L’appréciation décrit son niveau
            actuel ; elle ne prédit pas le prochain résultat.
          </p>
        </div>
        <FormCore score={null} />
      </section>
      <FormFactors />
      <MascotEditorial />
      <section className="analysis-panel methodology-five">
        <span className="eyebrow">UNE FENÊTRE SUR LA DYNAMIQUE</span>
        <h2>Les cinq derniers matchs, côte à côte.</h2>
        <div
          className="method-five-slots"
          aria-label="Schéma de cinq emplacements de matchs, sans résultats fictifs"
        >
          <span>01</span>
          <span>02</span>
          <span>03</span>
          <span>04</span>
          <span>05</span>
        </div>
        <p>
          Sur une fiche équipe, chaque rencontre affiche l’adversaire, le score,
          le terrain et sa contribution réelle lorsque celle-ci est calculable.
          Du plus ancien au plus récent, la frise rend la série lisible.
        </p>
        <p className="form-footnote">
          Même saison, toutes compétitions confondues, uniquement des matchs
          publiés. Les cinq rencontres ont le même poids dans la formule
          actuelle.
        </p>
      </section>
      <FormPlayground />
      <section className="analysis-panel">
        <h2>Un indice simplifié, une lecture qui peut s’enrichir.</h2>
        <div className="form-analysis-levels">
          <article>
            <span className="eyebrow">LE CALCUL ACTUEL</span>
            <h3>Résultats, buts et terrain</h3>
            <p>
              Cinq scores valides suffisent. Aucune donnée avancée manquante ne
              pénalise l’équipe.
            </p>
          </article>
          <article>
            <span className="eyebrow">LES INFORMATIONS COMPLÉMENTAIRES</span>
            <h3>Une lecture enrichie</h3>
            <p>
              Les tirs, tirs cadrés et occasions renseignés complètent
              l’analyse. Leur couverture est indiquée match par match ; ils ne
              modifient pas l’indice actuel.
            </p>
          </article>
        </div>
        <p className="form-footnote">
          Un indice enrichi par les statistiques nécessitera une formule
          propriétaire intégrée et versionnée. Il n’est pas encore disponible.
        </p>
      </section>
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
          <h2>Ce que l’indice dit — et ses limites</h2>
          <p>
            Une forme récente, pas une promesse de victoire. Cinq résultats sont
            nécessaires ; la difficulté des adversaires n’est pas encore
            corrigée. Les scores de modèles différents ne sont pas mélangés.
          </p>
          <details className="missing-details">
            <summary>Voir la méthode de calcul et ses poids</summary>
            <h2>Forme provisoire v2 : résultats, buts et terrain</h2>
            <p>
              Les cinq derniers matchs publiés de la saison, toutes compétitions
              confondues, ont le même poids. Les résultats dominent le calcul ;
              marquer davantage et encaisser moins améliorent aussi la forme.
              Les effets des buts diminuent progressivement pour éviter qu’une
              seule large victoire écrase les autres matchs.
            </p>
            <ul className="feature-list">
              <li>Résultat : poids 55 (victoire 1, nul 1/3, défaite 0)</li>
              <li>
                Différence de buts : poids 20, via (1 + tanh((BM − BE)/2))/2
              </li>
              <li>Défense : poids 10, via 1/(BE + 1)</li>
              <li>Attaque : poids 5, via BM/(BM + 2)</li>
              <li>
                Résultat à l’extérieur : bonus 4 pour une victoire, 2 pour un
                nul
              </li>
              <li>Buts à l’extérieur : bonus 3 × BM/(BM + 2)</li>
              <li>Clean sheet à domicile : bonus 3 si aucun but encaissé</li>
            </ul>
            <p>
              BM = buts marqués ; BE = buts encaissés. Chaque match reçoit la
              somme de ces contributions. L’indice vaut 100 × la moyenne des
              cinq matchs / 97. Le plafond commun de 97 tient compte de
              l’exclusion mutuelle des bonus domicile et extérieur : l’indice
              reste entre 0 et 100, avec la même échelle pour toutes les
              équipes. Un terrain inconnu ne reçoit aucun bonus et est signalé.
            </p>
            <p>
              Ces poids constituent une proposition provisoire explicite, sans
              calibration prédictive. Version : results-context-v2. Les anciens
              indices basés uniquement sur les points ne sont pas réutilisés.
              Les statistiques avancées ne changent pas ce calcul. La formule
              propriétaire reste distincte et les groupes de comparaison
              séparés.
            </p>
          </details>
          <details className="missing-details">
            <summary>L’indice propriétaire à venir</summary>
            <h2>L’indice propriétaire Calcito</h2>
            <ul className="feature-list">
              <li>Cinq derniers matchs officiels publiés</li>
              <li>Résultats, tirs, grosses occasions et notes d’équipe</li>
              <li>Bonus et coefficients fournis par le propriétaire</li>
              <li>
                Coefficient de 1,20 pour les compétitions européennes
                expressément confirmées
              </li>
            </ul>
            <Notice>
              La formule exacte reste à fournir. Aucun score n’est inventé et
              aucune donnée manquante ne devient zéro. « Indice indisponible »
              est affiché tant que le calcul n’est pas possible.
            </Notice>
          </details>
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
