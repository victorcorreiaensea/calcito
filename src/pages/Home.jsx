import { formDimensions } from "../domain/formPresentation";
import FormCore from "../components/FormCore";
import { FormFactors, MascotEditorial } from "../components/FormEducation";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  ScanLine,
  ChartNoAxesCombined,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import { databaseConfig } from "../services/supabaseClient";
import { mascotUrl } from "../components/CalcitoMascot";
import { TeamLink } from "../components/FootballUI";
import { SourceCaption } from "../components/DataContext";

export default function Home() {
  const state = useFootball(
    "matches",
    {},
    { enabled: databaseConfig.configured },
  );
  const teams = useFootball(
    "teams",
    {},
    { enabled: databaseConfig.configured },
  );
  const featured = (teams.result?.data || []).find((t) =>
    Number.isFinite(t.score),
  );
  const matches = state.result?.data.slice(0, 3) || [];
  return (
    <>
      <section className="hero container v3-hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="live-dot" />
            FOOTBALL INTELLIGENCE, HUMAN POWERED
          </div>
          <h1>
            Football is
            <br />
            more than
            <br />
            <span>a score.</span>
          </h1>
          <p>
            Le score raconte un match.
            <br />
            La forme raconte une dynamique.
          </p>
          <p className="hero-description">
            Des résultats vérifiés, des équipes à suivre, une nouvelle lecture
            du football. Calcito rassemble les performances récentes pour les
            rendre plus claires et comparables.
          </p>
          <div className="hero-buttons">
            <Link className="button button-primary" to="/equipes">
              Explorer les équipes
              <ArrowUpRight size={19} />
            </Link>
            <Link className="button button-secondary" to="/classements">
              Voir les classements
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="hero-trust">
            <ShieldCheck size={15} />
            <span>
              Données manuelles · Sources vérifiées · Lecture publique
            </span>
          </div>
        </div>
        <div className="hero-robot">
          <div className="robot-caption">
            <span>CALCITO / MATCHDAY COMPANION</span>
            <span className="live-dot" />
          </div>
          <div className="robot-orbit" aria-hidden="true" />
          <img
            src={mascotUrl}
            alt="Calcito, robot footballistique en armure noire, bleue et blanche, avec son ballon et son cœur électrique"
            fetchPriority="high"
            width="1280"
            height="1280"
          />
          <div className="robot-nameplate">
            <span className="nameplate-icon">
              <Trophy size={19} />
            </span>
            <div>
              <strong>Meet Calcito.</strong>
              <span>Du terrain aux données.</span>
            </div>
            <span className="nameplate-status">V4</span>
          </div>
        </div>
      </section>
      <div className="facts-strip">
        <div className="container facts-inner">
          <div>
            <strong>06</strong>
            <span>
              championnats européens
              <br />à suivre, journée après journée
            </span>
          </div>
          <div>
            <strong>03</strong>
            <span>
              coupes européennes
              <br />
              pour prolonger la lecture
            </span>
          </div>
          <div>
            <strong>05</strong>
            <span>
              derniers matchs officiels
              <br />
              pour lire la forme actuelle
            </span>
          </div>
          <span className="status-pill">INDICE DE FORME · PROVISOIRE</span>
        </div>
      </div>
      <section className="container home-form-signature">
        <div className="home-form-copy">
          <span className="eyebrow">LE NOYAU DE FORME CALCITO</span>
          <h2>
            Cinq matchs.
            <br />
            Une dynamique.
          </h2>
          <p>
            Résultats, buts et terrain : une lecture de la forme sur 100,
            expliquée par ce qui s’est passé sur le terrain.
          </p>
          <Link to="/methodologie" className="text-link">
            Découvrir le fonctionnement <ArrowUpRight size={17} />
          </Link>
          <p className="form-footnote">
            Un indice de forme, jamais une probabilité de victoire.
          </p>
        </div>
        <div className="home-form-featured">
          <FormCore
            dimensions={formDimensions(
              featured?.coverage?.breakdown,
              featured?.coverage?.compatibilityGroup,
            )}
            score={featured?.score}
            variant={featured?.coverage?.variant}
            dataMode={featured?.coverage?.dataMode}
          />
          {featured ? (
            <>
              <TeamLink team={featured} />
              <span className="form-footnote">
                Équipe publiée · {featured.season}–{featured.season + 1}
              </span>
            </>
          ) : (
            <p className="form-footnote">
              Le noyau s’allume lorsque cinq résultats sont disponibles.
              {teams.error && " Données indisponibles pour le moment."}
            </p>
          )}
        </div>
        <SourceCaption result={teams.result} />
      </section>
      <div className="container">
        <FormFactors />
        <MascotEditorial />
      </div>
      <section className="container matches-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LES RENCONTRES PUBLIÉES</span>
            <h2>
              Le football, en contexte<span>.</span>
            </h2>
          </div>
          <Link className="text-link" to="/matchs">
            Tous les matchs <ArrowUpRight size={16} />
          </Link>
        </div>
        {matches.length ? (
          <div className="home-fixture-grid">
            {matches.map((match) => (
              <article className="home-fixture" key={match.id}>
                <div>
                  <span>{match.competition.name}</span>
                  <span>
                    {match.status === "finished" ? "Terminé" : "À suivre"}
                  </span>
                </div>
                <TeamLink team={match.home} />
                <strong>
                  {match.goalsHome ?? "—"} – {match.goalsAway ?? "—"}
                </strong>
                <TeamLink team={match.away} />
                <small>
                  {new Date(match.kickoff).toLocaleDateString("fr-FR")}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-data-preview">
            <div>
              <span className="eyebrow">LE PROCHAIN CHAPITRE</span>
              <h3>
                {state.loading
                  ? "Chargement des matchs…"
                  : "Chaque match compte."}
              </h3>
              <p>
                {state.error
                  ? "Les rencontres ne sont pas disponibles pour le moment."
                  : "Les premières rencontres apparaîtront ici après leur publication. Aucun score ni statistique n’est inventé."}
              </p>
              <Link to="/methodologie">
                Comprendre notre approche <ArrowRight size={15} />
              </Link>
            </div>
            <div
              className="preview-scorecard"
              aria-label="Présentation du futur indice, sans valeur calculée"
            >
              <span>FORME CALCITO</span>
              <strong>
                —<small> / 100</small>
              </strong>
              <div className="preview-bars" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <p>Indice indisponible</p>
              <small>
                La formule propriétaire sera intégrée ultérieurement.
              </small>
            </div>
          </div>
        )}
        <SourceCaption result={state.result} />
      </section>
      <section className="method-section v3-method">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LE TERRAIN RENCONTRE LES DONNÉES</span>
              <h2>
                Une méthode. Plus de perspective<span>.</span>
              </h2>
            </div>
            <Link to="/methodologie" className="text-link">
              La méthodologie <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="method-grid">
            {[
              [
                ScanLine,
                "01",
                "Observer",
                "Les résultats et statistiques sont saisis une seule fois pour les deux équipes, puis vérifiés avant publication.",
              ],
              [
                SlidersHorizontal,
                "02",
                "Contextualiser",
                "Les cinq derniers matchs officiels expliquent l’indice provisoire. Une donnée manquante reste explicitement indisponible.",
              ],
              [
                ChartNoAxesCombined,
                "03",
                "Comparer",
                "Classements, résultats et indices ont chacun leur rôle. Les futurs pronostics utiliseront un modèle distinct.",
              ],
            ].map(([Icon, number, title, text]) => (
              <article className="method-card" key={number}>
                <div className="method-top">
                  <Icon size={27} />
                  <span>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
