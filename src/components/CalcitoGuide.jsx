import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import CalcitoMascot from "./CalcitoMascot";
const dialogues = [
  [
    "Salut Calcito, qui es-tu ?",
    "Ton compagnon de tribune, avec un faible pour les données ! Je t’aide à analyser, comparer et défier, sans promettre de connaître le prochain score.",
    "/equipes",
    "Explorer les clubs",
    "joyful",
  ],
  [
    "Comment analyses-tu les équipes ?",
    "Je lis les résultats publiés : buts marqués, buts encaissés, terrain et niveau de l’adversaire avant la rencontre. Une statistique absente reste inconnue.",
    "/methodologie",
    "Ouvrir le laboratoire",
    "focused",
  ],
  [
    "C’est quoi l’indice Calcito ?",
    "La moyenne des performances de cinq matchs, sur 100. La formule actuelle est provisoire et expliquée : cet indice n’est jamais un pourcentage de chances de gagner.",
    "/methodologie",
    "Comprendre l’indice",
    "proud",
  ],
  [
    "Tu peux prédire les matchs ?",
    "Je peux estimer des probabilités avec un modèle de buts distinct, s’il a passé sa validation historique. Pas assez de données ? Je le dis. Le football garde ses surprises !",
    "/comparateur",
    "Comparer & préparer",
    "surprised",
  ],
  [
    "Comment gagner des Calcithunes ?",
    "Les quiz et les missions permettent d’en gagner. Dans l’Arène, tu peux aussi me défier avec cette monnaie exclusivement fictive. Aucun achat et aucun retrait d’argent.",
    "/arene",
    "Découvrir l’Arène",
    "curious",
  ],
];
export default function CalcitoGuide() {
  const [selected, setSelected] = useState(0);
  const d = dialogues[selected];
  return (
    <section className="calcito-conversation" aria-labelledby="meet-calcito">
      <div>
        <span className="eyebrow">UN ROBOT. LA PASSION DU BALLON.</span>
        <h2 id="meet-calcito">
          Fais connaissance
          <br />
          avec Calcito<span className="blue-dot">.</span>
        </h2>
        <p>
          Curieux de nature. Supporter dans l’âme.
          <br />
          Pose-moi une question, je suis là pour ça.
        </p>
        <div className="conversation-questions">
          {dialogues.map(([question], i) => (
            <button
              key={question}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
            >
              {question}
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="conversation-answer" aria-live="polite">
        <CalcitoMascot
          emotion={d[4]}
          title="Salut, moi c’est Calcito."
          message={d[1]}
        />
        <Link className="text-link" to={d[2]}>
          {d[3]} →
        </Link>
      </div>
    </section>
  );
}
