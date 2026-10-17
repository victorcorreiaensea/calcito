import { statFields } from "../domain/match";
import {
  comparativeStat,
  analyzeMatchStatistics,
} from "../domain/matchAnalysis";
import CalcitoMascot from "./CalcitoMascot";
const format = (value) =>
  value === null
    ? "—"
    : value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
export default function MatchStatistics({ match }) {
  const stats = match.teamStatistics;
  if (
    !stats ||
    !["home", "away"].some((side) =>
      statFields.some(([key]) => stats[side]?.[key] != null),
    )
  )
    return null;
  const fields = [...statFields].sort((a, b) => {
    const order = [
      "xg",
      "possession",
      "shots",
      "shots_on_target",
      "big_chances",
      "corners",
      "passes_completed",
      "passes_attempted",
      "pass_accuracy",
      "yellow_cards",
      "red_cards",
      "woodwork",
      "team_rating",
    ];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });
  return (
    <section className="native-match-statistics">
      <div className="native-stats-heading">
        <div>
          <span className="eyebrow">LE MATCH EN CHIFFRES</span>
          <h2>Statistiques du match</h2>
        </div>
        <span className="native-stats-period">Match entier</span>
      </div>
      <div className="native-stats-teams">
        <strong>
          <i />
          {match.home.name}
          <small>Domicile</small>
        </strong>
        <strong>
          <i />
          {match.away.name}
          <small>Extérieur</small>
        </strong>
      </div>
      <dl className="native-stats-grid">
        {fields.map(([key, label]) => {
          const values = comparativeStat(stats.home?.[key], stats.away?.[key]);
          return (
            <div
              className={
                "native-stat " +
                (!values.complete ? "native-stat-incomplete" : "")
              }
              key={key}
            >
              <div className="native-stat-values">
                <dd>{format(values.home)}</dd>
                <dt>{label}</dt>
                <dd>{format(values.away)}</dd>
              </div>
              <div className="native-stat-track" aria-hidden="true">
                {values.complete && (
                  <>
                    <span
                      className="native-stat-home"
                      style={{ width: values.homeShare + "%" }}
                    />
                    <span
                      className="native-stat-away"
                      style={{ width: values.awayShare + "%" }}
                    />
                  </>
                )}
              </div>
              {!values.complete && <small>Donnée non renseignée</small>}
            </div>
          );
        })}
      </dl>
      <p className="native-stats-note">
        Les barres comparent les valeurs enregistrées. — : donnée non
        renseignée. Une donnée absente ne vaut jamais zéro.
      </p>
      <div className="native-match-coach">
        <CalcitoMascot
          variant="analysis"
          title="Le regard de Calcito"
          message={analyzeMatchStatistics(match)}
        />
        <p>
          Analyse descriptive du match, sans modification de la formule de
          l’indice et sans probabilité de victoire.
        </p>
      </div>
    </section>
  );
}
