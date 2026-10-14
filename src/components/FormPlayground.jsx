import { formDimensions } from "../domain/formPresentation";
import { useState } from "react";
import { calculateResultsForm } from "../engines/resultsFormEngine";
import FormCore from "./FormCore";
const initial = [
  { goals_for: 2, goals_against: 0, venue: "home" },
  { goals_for: 1, goals_against: 1, venue: "away" },
  { goals_for: 0, goals_against: 1, venue: "away" },
  { goals_for: 3, goals_against: 1, venue: "home" },
  { goals_for: 2, goals_against: 0, venue: "away" },
];
export default function FormPlayground() {
  const [matches, setMatches] = useState(initial);
  const model = calculateResultsForm(matches);
  function edit(i, key, value) {
    setMatches((rows) =>
      rows.map((r, n) =>
        n === i
          ? {
              ...r,
              [key]:
                key === "venue" ? value : value === "" ? "" : Number(value),
            }
          : r,
      ),
    );
  }
  return (
    <section className="form-playground analysis-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ESSAYEZ POUR COMPRENDRE</span>
          <h2>Un résultat change la lecture.</h2>
          <p>
            Modifiez ces cinq rencontres fictives : le noyau montre la base
            intrinsèque conservée. La surprise relative est expliquée dans les
            exemples ci-dessus.
          </p>
        </div>
        <span className="demo-label">DÉMONSTRATION FICTIVE</span>
      </div>
      <div className="playground-layout">
        <FormCore
          dimensions={formDimensions(model.breakdown, model.formulaVersion)}
          score={model.score}
          demo
          variant="provisional"
        />
        <div>
          <div className="playground-matches">
            {matches.map((m, i) => (
              <fieldset key={i}>
                <legend>Match fictif {i + 1}</legend>
                <label>
                  Buts marqués
                  <input
                    aria-label={`Buts marqués · démonstration ${i + 1}`}
                    type="number"
                    min="0"
                    max="20"
                    value={m.goals_for}
                    onChange={(e) => edit(i, "goals_for", e.target.value)}
                  />
                </label>
                <label>
                  Buts encaissés
                  <input
                    aria-label={`Buts encaissés · démonstration ${i + 1}`}
                    type="number"
                    min="0"
                    max="20"
                    value={m.goals_against}
                    onChange={(e) => edit(i, "goals_against", e.target.value)}
                  />
                </label>
                <label>
                  Terrain
                  <select
                    aria-label={`Terrain · démonstration ${i + 1}`}
                    value={m.venue}
                    onChange={(e) => edit(i, "venue", e.target.value)}
                  >
                    <option value="home">Domicile</option>
                    <option value="away">Extérieur</option>
                  </select>
                </label>
              </fieldset>
            ))}
          </div>
          <button
            className="button button-secondary"
            onClick={() => setMatches(initial)}
          >
            Réinitialiser la démonstration
          </button>
          <p className="form-footnote">
            Aucune équipe réelle. Rien n’est enregistré ou publié. Une case vide
            ou un score invalide rend l’indice indisponible.
          </p>
        </div>
      </div>
    </section>
  );
}
