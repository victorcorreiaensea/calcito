import { compareHistoricalForms } from "../domain/formComparison";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
const number = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })
    : "—";
const signed = (n) =>
  Number.isFinite(n) ? `${n > 0 ? "+" : ""}${number(n)}` : "—";
export default function FormEvolution({
  series = [],
  loading,
  error,
  title = "L’évolution de la forme",
}) {
  const [range, setRange] = useState("10"),
    [selected, setSelected] = useState(null);
  const displayed = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        rows: range === "season" ? s.history : s.history.slice(-Number(range)),
      })),
    [series, range],
  );
  const points = displayed
    .flatMap((s, index) =>
      s.rows.map((r) => ({
        ...r,
        series: index,
        team: s.team,
        key: `${s.team.id}:${r.matchId}`,
      })),
    )
    .sort(
      (a, b) =>
        Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
        a.key.localeCompare(b.key),
    );
  const active = points.find((p) => p.key === selected) || points.at(-1);
  const dates = points.map((p) => Date.parse(p.kickoff)),
    first = Math.min(...dates),
    last = Math.max(...dates);
  const x = (r) =>
    55 +
    (last === first ? 0.5 : (Date.parse(r.kickoff) - first) / (last - first)) *
      750;
  const y = (r) => 245 - r.after * 2;
  const teamName = (id) =>
    id
      ? series.flatMap((s) => s.teams || []).find((t) => t.id === id)?.name ||
        series.find((s) => s.team.id === id)?.team.name
      : null;
  function choose(offset) {
    if (!points.length) return;
    const i = points.findIndex((p) => p.key === active?.key);
    setSelected(
      points[Math.max(0, Math.min(points.length - 1, i + offset))].key,
    );
  }
  const comparison = compareHistoricalForms(series, range);
  const highlights = points
    .filter((p) => p.label)
    .sort((a, b) => b.surprise - a.surprise)
    .slice(0, 4);
  return (
    <section className="analysis-panel form-evolution">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MATCH APRÈS MATCH</span>
          <h2>{title}</h2>
          <p>
            Une reconstruction chronologique depuis les résultats publiés. Même
            version de formule, dates réelles.
          </p>
        </div>
        <label className="evolution-range">
          Période
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setSelected(null);
            }}
          >
            <option value="5">5 derniers matchs</option>
            <option value="10">10 derniers matchs</option>
            <option value="season">Saison complète</option>
          </select>
        </label>
      </div>
      {series.some((s) => s.excluded?.length) && (
        <p className="form-footnote">
          Certaines rencontres ne sont pas tracées : un résultat ou un ordre
          chronologique est incomplet. Elles restent conservées dans
          l’historique des matchs.
        </p>
      )}
      {loading ? (
        <p role="status">Recalcul de la chronologie…</p>
      ) : error ? (
        <p role="alert">
          Historique indisponible. Réessayez après rechargement.
        </p>
      ) : !points.length ? (
        <p className="muted-text">
          Aucun résultat chronologique exploitable pour cette saison.
        </p>
      ) : (
        <>
          <div className="evolution-legend">
            {displayed.map((s, i) => (
              <span key={s.team.id}>
                <i className={i ? "line-secondary" : ""} />
                {s.team.name}
              </span>
            ))}
            <span>○ Initialisation neutre · ● Cinq matchs ou plus</span>
          </div>
          <svg
            className="evolution-chart"
            viewBox="0 0 860 290"
            role="group"
            aria-label="Historique de forme, dates en abscisse, indice de zéro à cent en ordonnée"
          >
            {[0, 25, 50, 75, 100].map((n) => (
              <g key={n}>
                <line x1="55" x2="805" y1={245 - n * 2} y2={245 - n * 2} />
                <text x="35" y={249 - n * 2}>
                  {n}
                </text>
              </g>
            ))}
            {[first, (first + last) / 2, last].map((date, i) => (
              <text
                key={i}
                x={55 + i * 375}
                y="278"
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              >
                {new Date(date).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                })}
              </text>
            ))}
            {displayed.map((s, i) => (
              <polyline
                key={s.team.id}
                points={s.rows.map((r) => `${x(r)},${y(r)}`).join(" ")}
                fill="none"
                className={i ? "evolution-line secondary" : "evolution-line"}
              />
            ))}
            {active && (
              <line
                className="evolution-cursor"
                x1={x(active)}
                x2={x(active)}
                y1="30"
                y2="245"
              />
            )}
            {points.map((p) => (
              <g
                key={p.key}
                role="button"
                tabIndex="0"
                aria-label={`${p.team.name}, ${p.kickoff.slice(0, 10)}, indice ${number(p.after)} sur 100${p.afterInitialized ? ", initialisation neutre" : ""}`}
                onMouseEnter={() => setSelected(p.key)}
                onFocus={() => setSelected(p.key)}
                onClick={() => setSelected(p.key)}
                onKeyDown={(e) => {
                  if (["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    setSelected(p.key);
                  }
                  if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                    e.preventDefault();
                    choose(e.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
              >
                <circle className="evolution-hit" cx={x(p)} cy={y(p)} r="17" />
                <circle
                  className={`evolution-point ${p.series ? "secondary" : ""} ${p.afterInitialized ? "initialized" : ""} ${active?.key === p.key ? "selected" : ""}`}
                  cx={x(p)}
                  cy={y(p)}
                  r={Math.abs(p.delta) >= 8 ? 7 : 5}
                />
              </g>
            ))}
          </svg>
          <div className="evolution-controls">
            <button
              className="button button-secondary"
              aria-label="Rencontre précédente"
              onClick={() => choose(-1)}
            >
              <ArrowLeft size={16} />
            </button>
            <label>
              Rencontre
              <select
                value={active.key}
                onChange={(e) => setSelected(e.target.value)}
              >
                {points.map((p) => (
                  <option value={p.key} key={p.key}>
                    {p.team.name} ·{" "}
                    {new Date(p.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                    {number(p.after)} / 100
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              aria-label="Rencontre suivante"
              onClick={() => choose(1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="evolution-detail" aria-live="polite">
            <div>
              <span className="eyebrow">
                {active.team.name} ·{" "}
                {new Date(active.kickoff).toLocaleDateString("fr-FR")}
              </span>
              <h3>
                vs{" "}
                {teamName(active.opponentId) ||
                  active.opponentName ||
                  "Adversaire enregistré"}
              </h3>
              <p>
                {active.goalsFor} – {active.goalsAgainst} ·{" "}
                {active.venue === "home" ? "Domicile" : "Extérieur"}
              </p>
              <p>
                Indice adverse avant match : {number(active.opponentBefore)}
                {active.opponentInitialized ? " · Référence initialisée" : ""}
              </p>
            </div>
            <div>
              <span>Indice avant → après</span>
              <strong>
                {number(active.before)} → {number(active.after)}
              </strong>
              <small className={active.delta >= 0 ? "positive" : "negative"}>
                {signed(active.delta)} points de variation totale
              </small>
            </div>
            <div>
              <span>Surprise Calcito</span>
              <strong>
                {active.surprise === null
                  ? "Non calculable"
                  : signed(active.surprise * 100)}
              </strong>
              <small>
                {active.appliedAdjustment === null
                  ? "Adversaire sans référence"
                  : `${signed(active.appliedAdjustment)} sur la performance du match`}
              </small>
            </div>
            {active.label && (
              <span className="exploit-label">
                <Sparkles size={14} />
                {active.label}
              </span>
            )}
          </div>
          <p className="form-footnote">
            {active.beforeInitialized ||
            active.afterInitialized ||
            active.opponentInitialized
              ? "Référence initialisée : moins de cinq résultats antérieurs pour au moins une équipe. Aucun label d’exploit n’est attribué sur cette base. "
              : ""}
            {active.afterInitialized
              ? `Indice initialisé (${active.sampleSize}/5 matchs), distinct d’une forme complète. `
              : ""}
            {active.conservativeDay
              ? "Heure incomplète dans cette journée : références figées avant la journée entière. "
              : ""}
            Surprise entre −100 et +100 : écart au résultat attendu, pas une
            probabilité. Bonus de surprise et variation totale sont deux valeurs
            différentes.
          </p>
          {series.length === 2 && (
            <div className="evolution-comparison">
              {comparison && (
                <>
                  <p>
                    Forme publiée la plus élevée :{" "}
                    <strong>{comparison.leader?.name || "égalité"}</strong>.
                  </p>
                  {comparison.progress ? (
                    <>
                      <p>
                        Période commune du{" "}
                        {new Date(comparison.progress.start).toLocaleDateString(
                          "fr-FR",
                        )}{" "}
                        au{" "}
                        {new Date(comparison.progress.end).toLocaleDateString(
                          "fr-FR",
                        )}{" "}
                        :{" "}
                        {comparison.progress.changes
                          .map(
                            (c) => `${c.team.name} ${signed(c.delta)} points`,
                          )
                          .join(" · ")}
                        .
                      </p>
                      <p>
                        Progression la plus forte sur cette période :{" "}
                        <strong>
                          {comparison.progress.leader?.name || "égalité"}
                        </strong>
                        .
                      </p>
                    </>
                  ) : (
                    <p>
                      Pas de période commune suffisante pour comparer les
                      progressions.
                    </p>
                  )}
                </>
              )}

              {displayed.map((s) => {
                const start = s.rows.find((r) => !r.afterInitialized),
                  end = s.rows.filter((r) => !r.afterInitialized).at(-1);
                return (
                  <p key={s.team.id}>
                    <strong>{s.team.name}</strong> ·{" "}
                    {end
                      ? `${number(end.after)} / 100 actuellement dans cette saison`
                      : "Forme encore initialisée"}{" "}
                    ·{" "}
                    {start && end && start !== end
                      ? `${signed(end.after - start.after)} points entre ses dates du ${new Date(start.kickoff).toLocaleDateString("fr-FR")} et du ${new Date(end.kickoff).toLocaleDateString("fr-FR")}`
                      : "Progression mesurée indisponible"}
                  </p>
                );
              })}
              <small>
                Les fenêtres de matchs peuvent couvrir des dates différentes.
                Les courbes utilisent un axe commun de dates, sans assimiler les
                numéros de matchs.
              </small>
            </div>
          )}
          <section className="evolution-highlights">
            <h3>Les performances marquantes</h3>
            {!highlights.length ? (
              <p className="muted-text">
                Aucun exploit confirmé dans cette période. Les références
                initialisées ne suffisent pas pour attribuer ce label.
              </p>
            ) : (
              <div>
                {highlights.map((p) => (
                  <article key={p.key}>
                    <span className="exploit-label">
                      <Sparkles size={14} />
                      {p.label}
                    </span>
                    <h4>
                      {p.team.name} · vs{" "}
                      {teamName(p.opponentId) ||
                        p.opponentName ||
                        "Adversaire enregistré"}
                    </h4>
                    <p>
                      {new Date(p.kickoff).toLocaleDateString("fr-FR")} ·{" "}
                      {p.goalsFor} – {p.goalsAgainst}
                    </p>
                    <p>
                      Indices avant : {number(p.before)} /{" "}
                      {number(p.opponentBefore)}
                    </p>
                    <p>
                      Surprise : {signed(p.surprise * 100)} · Ajustement du
                      match : {signed(p.appliedAdjustment)}
                    </p>
                    <strong>Variation totale : {signed(p.delta)}</strong>
                  </article>
                ))}
              </div>
            )}
          </section>
          <p className="form-footnote">
            Version {series[0]?.history[0]?.version} · Aucun résultat fictif.
            Les lignes relient des rencontres, pas des mesures quotidiennes
            intermédiaires.
          </p>
        </>
      )}
    </section>
  );
}
