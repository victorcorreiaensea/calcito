import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  GitCompareArrows,
  Shield,
  Swords,
  X,
} from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import { databaseConfig } from "../services/supabaseClient";
import { mascotUrl } from "../components/CalcitoMascot";
import CalcitoGuide from "../components/CalcitoGuide";
import ClubSnapshot from "../components/ClubSnapshot";
import { TeamLink, FormValue } from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";
import "./Home.css";

function HomeFixture({ match }) {
  return (
    <article className="home-match">
      <div className="home-match-meta">
        <span>
          {match.competition.name} · {match.round}
        </span>
        <span className="home-match-status">À venir</span>
      </div>
      <div className="home-match-versus">
        <TeamLink team={match.home} />
        <strong>
          {match.goalsHome != null && match.goalsAway != null
            ? `${match.goalsHome} – ${match.goalsAway}`
            : "VS"}
        </strong>
        <TeamLink team={match.away} />
      </div>
      <div className="home-match-date">
        <time dateTime={match.kickoff}>
          {new Date(match.kickoff).toLocaleString("fr-FR", {
            dateStyle: "medium",
            ...(match.timeKnown === false ? {} : { timeStyle: "short" }),
          })}
        </time>
        <Link to={`/matchs/${match.id}`}>
          Analyse <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="home-match-actions">
        <details>
          <summary>Forme des équipes</summary>
          <div className="home-match-form-grid">
            {[match.home, match.away].map((team) => (
              <div key={team.id}>
                <span>{team.name}</span>
                <FormValue
                  score={team.score}
                  variant={team.coverage?.variant}
                  dataMode={team.coverage?.dataMode}
                />
              </div>
            ))}
          </div>
        </details>
        {Date.parse(match.kickoff) > Date.now() && (
          <Link to={`/arene?match=${match.id}`}>
            Défier Calcito <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function Home() {
  const guide = useRef(null);
  const state = useFootball(
    "matches",
    { view: "upcoming" },
    { enabled: databaseConfig.configured },
  );
  const teams = useFootball(
    "teams",
    {},
    { enabled: databaseConfig.configured },
  );
  const featured = teams.result?.data.find((t) =>
    ["fc porto", "porto"].includes(t.name.toLowerCase()),
  );
  const matches =
    state.result?.data.filter((m) => m.status === "scheduled").slice(0, 3) ||
    [];

  return (
    <div className="home-page">
      <section className="container home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <h1 id="home-title">
            Football is more
            <br />
            <span>than a score.</span>
          </h1>
          <p>Suis la forme des clubs et prépare les prochaines affiches.</p>
          <Link className="button button-primary" to="/matchs">
            Explorer les matchs <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <button
          className="home-mascot hero-mascot-invitation"
          type="button"
          aria-label="Faire connaissance avec Calcito"
          aria-haspopup="dialog"
          onClick={() => guide.current?.showModal()}
        >
          <img
            src={mascotUrl}
            alt="Calcito, notre robot sportif bleu et blanc, et son ballon de football"
            fetchPriority="high"
            width="1280"
            height="1280"
          />
        </button>
      </section>

      <section
        className="container home-matches"
        aria-labelledby="home-matches-title"
      >
        <div className="section-heading home-section-heading">
          <h2 id="home-matches-title">
            Prochains matchs<span>.</span>
          </h2>
          <Link className="text-link" to="/matchs">
            Tous les matchs <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {matches.length ? (
          <div className="home-fixture-grid">
            {matches.map((match) => (
              <HomeFixture match={match} key={match.id} />
            ))}
          </div>
        ) : (
          <div className="home-data-state" role="status">
            <p>
              {state.loading
                ? "Chargement du calendrier…"
                : state.error
                  ? "Calendrier indisponible pour le moment."
                  : "Aucune rencontre future publiée pour le moment."}
            </p>
            {state.error && (
              <button className="text-link" onClick={state.retry}>
                Réessayer
              </button>
            )}
          </div>
        )}
        <SourceCaption result={state.result} />
      </section>

      <nav className="container home-shortcuts" aria-label="Accès rapides">
        {[
          [Shield, "Équipes", "/equipes"],
          [GitCompareArrows, "Comparateur", "/comparateur"],
          [Swords, "Arène", "/arene"],
        ].map(([Icon, label, path]) => (
          <Link key={path} to={path}>
            <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
            <span>{label}</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <section
        className="container home-spotlight"
        aria-labelledby="home-spotlight-title"
      >
        <div className="section-heading home-section-heading">
          <h2 id="home-spotlight-title">
            Club à la une<span>.</span>
          </h2>
          <Link
            className="text-link"
            to={featured ? `/equipes/${featured.id}` : "/equipes"}
          >
            {featured ? "Voir la fiche" : "Tous les clubs"}{" "}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {featured ? (
          <>
            <div className="home-porto-header">
              <TeamLink team={featured} />
              <FormValue
                score={featured.score}
                variant={featured.coverage?.variant}
                dataMode={featured.coverage?.dataMode}
              />
            </div>
            <details className="home-porto-details">
              <summary>Forme récente et prochain match</summary>
              <ClubSnapshot team={featured} featured comparison />
            </details>
          </>
        ) : (
          <div className="home-data-state" role="status">
            <p>
              {teams.loading
                ? "Chargement du FC Porto…"
                : teams.error
                  ? "La fiche du FC Porto est indisponible pour le moment."
                  : "La fiche du FC Porto n’est pas disponible pour le moment."}
            </p>
            {teams.error && (
              <button className="text-link" onClick={teams.retry}>
                Réessayer
              </button>
            )}
          </div>
        )}
        <SourceCaption result={teams.result} />
      </section>

      <dialog
        className="home-guide-dialog"
        ref={guide}
        aria-labelledby="meet-calcito"
        onClick={(event) => {
          if (event.target === event.currentTarget) guide.current?.close();
        }}
      >
        <button
          className="home-guide-close"
          type="button"
          aria-label="Fermer le dialogue avec Calcito"
          onClick={() => guide.current?.close()}
        >
          <X size={22} aria-hidden="true" />
        </button>
        <CalcitoGuide />
      </dialog>
    </div>
  );
}
