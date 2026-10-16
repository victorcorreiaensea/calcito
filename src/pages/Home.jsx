import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowRight, ShieldCheck, Trophy } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import { databaseConfig } from "../services/supabaseClient";
import { mascotUrl } from "../components/CalcitoMascot";
import CalcitoGuide from "../components/CalcitoGuide";
import ClubSnapshot from "../components/ClubSnapshot";
import { FixtureCard } from "./Matches";
import { SourceCaption } from "../components/DataContext";
export default function Home() {
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
    <>
      <section className="hero container v3-hero discovery-hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="live-dot" />
            LE FOOTBALL A UN NOUVEAU COMPAGNON
          </div>
          <h1>
            Football is
            <br />
            more than
            <br />
            <span>a score.</span>
          </h1>
          <p>
            Les chiffres ont une histoire.
            <br />
            Calcito te la raconte.
          </p>
          <p className="hero-description">
            Lis la forme de tes clubs, prépare les prochaines affiches et défie
            Calcito. Une autre façon de vivre le football, guidée par les faits.
          </p>
          <div className="hero-buttons">
            <Link className="button button-primary" to="/equipes">
              Explorer les équipes <ArrowUpRight size={18} />
            </Link>
            <a
              className="button button-secondary"
              href="#meet-calcito"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("meet-calcito")?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              Rencontrer Calcito <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-trust">
            <ShieldCheck size={15} />
            <span>Des données publiées. Des incertitudes assumées.</span>
          </div>
        </div>
        <div className="hero-robot">
          <div className="robot-caption">
            <span>CALCITO / TON COMPAGNON DE MATCH</span>
            <span className="live-dot" />
          </div>
          <div className="robot-orbit" aria-hidden="true" />
          <a
            className="hero-mascot-invitation"
            href="#meet-calcito"
            aria-label="Faire connaissance avec Calcito"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("meet-calcito")?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
              });
            }}
          >
            <img
              src={mascotUrl}
              alt="Calcito, notre robot sportif bleu et blanc, et son ballon de football"
              fetchPriority="high"
              width="1280"
              height="1280"
            />
          </a>
          <div className="robot-nameplate">
            <span className="nameplate-icon">
              <Trophy size={19} />
            </span>
            <div>
              <strong>Le jeu commence ici.</strong>
              <span>De la curiosité. Du ballon. Du contexte.</span>
            </div>
            <span className="nameplate-status">C.</span>
          </div>
        </div>
      </section>
      <div className="container discovery-intro">
        <span>ANALYSER.</span>
        <span>COMPARER.</span>
        <span>DÉFIER.</span>
      </div>
      <section className="container discovery-porto">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LE CLUB SOUS LES PROJECTEURS</span>
            <h2>
              Dans le bleu de Porto<span>.</span>
            </h2>
          </div>
          <Link className="text-link" to="/equipes">
            Tous les clubs <ArrowUpRight size={17} />
          </Link>
        </div>
        {featured ? (
          <ClubSnapshot team={featured} featured />
        ) : (
          <div className="analysis-panel">
            <p role="status">
              {teams.loading
                ? "Chargement du FC Porto…"
                : "La fiche du FC Porto n’est pas disponible pour le moment."}
            </p>
            {teams.error && <button onClick={teams.retry}>Réessayer</button>}
          </div>
        )}
        <SourceCaption result={teams.result} />
      </section>
      <div className="container">
        <CalcitoGuide />
        <div className="discovery-paths">
          {[
            [
              "01",
              "Analyser",
              "La dynamique derrière les résultats.",
              "/equipes",
            ],
            [
              "02",
              "Comparer",
              "Deux clubs. Des faits. Ta lecture du jeu.",
              "/comparateur",
            ],
            [
              "03",
              "Défier",
              "Un duel avec Calcito. Des Calcithunes 100 % fictives.",
              "/arene",
            ],
          ].map(([n, title, text, path]) => (
            <Link key={n} to={path}>
              <span className="eyebrow">{n} / LE JEU CONTINUE</span>
              <h2>
                {title} <ArrowUpRight size={24} aria-hidden="true" />
              </h2>
              <p>{text}</p>
            </Link>
          ))}
        </div>
      </div>
      <section className="container matches-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">AVANT LE COUP D’ENVOI</span>
            <h2>
              Les prochains rendez-vous<span>.</span>
            </h2>
          </div>
          <Link className="text-link" to="/matchs">
            Tous les matchs <ArrowUpRight size={16} />
          </Link>
        </div>
        {matches.length ? (
          <div className="home-fixture-grid">
            {matches.map((match) => (
              <FixtureCard match={match} key={match.id} />
            ))}
          </div>
        ) : (
          <div className="analysis-panel">
            <p>
              {state.loading
                ? "Chargement du calendrier…"
                : state.error
                  ? "Calendrier indisponible pour le moment."
                  : "Aucune rencontre future publiée pour le moment."}
            </p>
            {state.error && <button onClick={state.retry}>Réessayer</button>}
          </div>
        )}
        <SourceCaption result={state.result} />
      </section>
      <section className="container discovery-final">
        <span className="eyebrow">LE PLAISIR DE COMPRENDRE</span>
        <h2>
          Plus de contexte.
          <br />
          Encore plus de football.
        </h2>
        <p>
          Un indice sur 100 décrit la forme. Il ne prédit pas le prochain but.
          <br />
          Découvre le moteur et teste tes idées dans notre laboratoire.
        </p>
        <Link className="button button-secondary" to="/methodologie">
          Comment ça marche ? <ArrowUpRight size={17} />
        </Link>
      </section>
    </>
  );
}
