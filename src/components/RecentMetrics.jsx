import { recentInsight } from "../domain/teamInsight";
export default function RecentMetrics({ team, analysis }) {
  const insight = recentInsight(analysis.recent.result?.data, team.id);
  const history = analysis.timeline.result?.data.history?.slice(-5) || [];
  const opponents = history.filter(
    (r) => !r.opponentInitialized && Number.isFinite(r.opponentBefore),
  );
  return (
    <section className="analysis-panel recent-metrics">
      <h3>{team.name} · les faits récents</h3>
      <p className="muted-text">
        {insight.rows.length} résultats publiés, même saison. Fenêtre propre au
        club.
      </p>
      <dl>
        {[
          ["Buts marqués", insight.rows.length ? insight.goalsFor : "—"],
          ["Buts encaissés", insight.rows.length ? insight.goalsAgainst : "—"],
          ...[
            ["home", "À domicile"],
            ["away", "À l’extérieur"],
          ].map(([venue, label]) => {
            const sample = insight.values.filter((r) => r.venue === venue);
            return [
              label,
              sample.length
                ? `${sample.filter((r) => r.gf > r.ga).length} V / ${sample.length} matchs · ${sample.reduce((n, r) => n + r.gf, 0)} buts marqués, ${sample.reduce((n, r) => n + r.ga, 0)} encaissés`
                : "Aucun match dans cet échantillon",
            ];
          }),
          [
            "Niveau des adversaires avant match",
            opponents.length === history.length && history.length
              ? `${(opponents.reduce((n, r) => n + r.opponentBefore, 0) / opponents.length).toFixed(1)} / 100`
              : `Références complètes : ${opponents.length} / ${history.length}`,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
