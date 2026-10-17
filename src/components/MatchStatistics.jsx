import { statFields } from "../domain/match";
export default function MatchStatistics({ match }) {
  const stats = match.teamStatistics;
  if (
    !stats ||
    !["home", "away"].some((side) =>
      statFields.some(([key]) => stats[side]?.[key] != null),
    )
  )
    return null;
  return (
    <section className="analysis-panel match-statistics">
      <span className="eyebrow">DONNÉES PUBLIÉES</span>
      <h2>Statistiques du match</h2>
      <div className="match-stat-heading">
        <strong>
          {match.home.name}
          <small>Domicile</small>
        </strong>
        <span>Match entier</span>
        <strong>
          {match.away.name}
          <small>Extérieur</small>
        </strong>
      </div>
      <dl>
        {statFields.map(([key, label]) => (
          <div className="match-stat-line" key={key}>
            <dd>{stats.home?.[key] ?? "—"}</dd>
            <dt>{label}</dt>
            <dd>{stats.away?.[key] ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="muted-text">
        — : donnée non renseignée. Ces statistiques décrivent le match ; elles
        ne sont pas des probabilités de victoire.
      </p>
    </section>
  );
}
