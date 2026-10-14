import { Trophy, Crosshair, ShieldCheck, Plane } from "lucide-react";
import { TeamBadge } from "./FootballUI";
import { buildFormStory } from "../domain/formPresentation";
const icons = {
  wins: Trophy,
  attack: Crosshair,
  defence: ShieldCheck,
  away: Plane,
};
export default function FormStory({ analysis }) {
  const { engine, coverage, recent } = analysis;
  const story = buildFormStory(engine.trace, {
    modelVersion: engine.formulaVersion,
    breakdown: coverage.breakdown,
  });
  const raw = recent.result?.data || [];
  const advanced = engine.trace.filter((t) => {
    const m = raw.find((m) => m.id === t.matchId);
    return ["shots", "shots_on_target", "big_chances"].some((k) =>
      Number.isFinite(m?.manualStats?.[k]),
    );
  }).length;
  if (recent.loading)
    return (
      <section className="analysis-panel" role="status">
        Chargement de la dynamique…
      </section>
    );
  if (recent.error)
    return (
      <section className="analysis-panel">
        <h2>Pourquoi cet indice ?</h2>
        <p role="alert">
          Les matchs ne sont pas disponibles. Aucune explication ne peut être
          déduite.
        </p>
      </section>
    );
  return (
    <section className="form-story analysis-panel">
      <header className="form-story-heading">
        <div>
          <span className="eyebrow">LE SCORE RACONTE UNE HISTOIRE</span>
          <h2>Pourquoi cet indice ?</h2>
        </div>
        <span className="status-pill">{story.sampleSize} / 5 résultats</span>
      </header>
      <p className="form-story-summary">{story.summary}</p>
      {story.sampleSize > 0 && (
        <div className="form-fact-grid">
          {story.facts.map((f) => {
            const Icon = icons[f.key];
            return (
              <div key={f.key}>
                <Icon size={19} />
                <strong>{f.value}</strong>
                <span>{f.text}</span>
              </div>
            );
          })}
        </div>
      )}
      {story.sampleSize > 0 && (
        <p className="form-footnote">
          {story.goalsAgainst} buts encaissés · {story.draws} nul
          {story.draws > 1 ? "s" : ""} · {story.losses} défaite
          {story.losses > 1 ? "s" : ""} ·{" "}
          {story.unbeatenStreak == null
            ? "Série observée indéterminée."
            : `Série observée : ${story.unbeatenStreak} match${story.unbeatenStreak > 1 ? "s" : ""} sans défaite dans cette fenêtre.`}{" "}
          {story.venueKnown < story.sampleSize &&
            "Terrain partiellement renseigné : les faits extérieurs concernent uniquement les terrains connus."}
        </p>
      )}
      <div className="analysis-coverage">
        <ScanCoverage count={advanced} total={engine.trace.length} />
        <p>
          {advanced
            ? `Lecture enrichie : des statistiques avancées sont renseignées sur ${advanced} des ${engine.trace.length} matchs.`
            : "Analyse simplifiée : résultats, buts et domicile / extérieur."}{" "}
          <span>
            Elles ne changent pas la formule actuelle. Leur absence ne pénalise
            pas l’équipe.
          </span>
        </p>
      </div>
      {coverage.dynamic && (
        <p className="form-footnote">
          Force adverse mesurée avant match sur {coverage.relativeReliable} des{" "}
          {engine.trace.length} rencontres ; les autres références sont
          initialisées ou inconnues. Seules les références complètes peuvent
          déclencher un label d’exploit.
        </p>
      )}
      <div className="form-timeline-heading">
        <h3>Les cinq derniers matchs</h3>
        <span>Du plus ancien au plus récent</span>
      </div>
      <div className="form-timeline">
        {[...engine.trace].reverse().map((t) => {
          const m = raw.find((m) => m.id === t.matchId);
          const opponent = m
            ? m.home.id === engine.teamId
              ? m.away
              : m.home
            : { name: t.opponent, short: t.opponent || "?" };
          const i = engine.trace.findIndex((r) => r.matchId === t.matchId);
          const contribution =
            m?.dynamic && Number.isFinite(coverage.score)
              ? m.dynamic.performance / 5
              : story.contributions[i];
          return (
            <article className="timeline-match" key={t.matchId}>
              <div className="timeline-top">
                <time dateTime={t.kickoff}>
                  {new Date(t.kickoff).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
                <span
                  className={`result result-${(t.result || "unknown").toLowerCase()}`}
                >
                  {t.result || "?"}
                </span>
              </div>
              <TeamBadge team={opponent} small />
              <strong className="timeline-opponent">{opponent.name}</strong>
              <strong className="timeline-score">
                {t.goalsFor ?? "—"} <span>–</span> {t.goalsAgainst ?? "—"}
              </strong>
              <span>
                {t.venue === "home"
                  ? "Domicile"
                  : t.venue === "away"
                    ? "Extérieur"
                    : "Terrain inconnu"}
              </span>
              {m?.dynamic && (
                <small className="timeline-variation">
                  {m.dynamic.before.toLocaleString("fr-FR", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  →{" "}
                  {m.dynamic.after.toLocaleString("fr-FR", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  ({m.dynamic.delta > 0 ? "+" : ""}
                  {m.dynamic.delta.toLocaleString("fr-FR", {
                    maximumFractionDigits: 1,
                  })}
                  ){m.dynamic.afterInitialized ? " · Initialisation" : ""}
                </small>
              )}
              {m?.dynamic?.label && (
                <span className="exploit-label">{m.dynamic.label}</span>
              )}
              {Number.isFinite(contribution) ? (
                <div className="timeline-contribution">
                  <div aria-hidden="true">
                    <i
                      style={{ width: `${Math.min(100, contribution * 5)}%` }}
                    />
                  </div>
                  <small>
                    {contribution.toLocaleString("fr-FR", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    points dans l’indice / 100
                  </small>
                </div>
              ) : (
                <small>Contribution indisponible</small>
              )}
            </article>
          );
        })}
      </div>
      {(story.contributions.length > 0 ||
        (Number.isFinite(coverage.score) && raw.some((m) => m.dynamic))) && (
        <p className="form-footnote">
          Chaque contribution est sa part dans la moyenne des cinq matchs, pas
          une variation avant / après. Leur somme donne l’indice ; l’affichage
          est arrondi.
        </p>
      )}
    </section>
  );
}
function ScanCoverage({ count, total }) {
  return (
    <div
      className="coverage-dots"
      aria-label={`${count} matchs avec statistiques avancées sur ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <i className={i < count ? "is-filled" : ""} key={i} />
      ))}
    </div>
  );
}
