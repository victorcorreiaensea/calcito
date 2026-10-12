import {
  ArrowUpRight,
  ArrowRight,
  ChartNoAxesCombined,
  SlidersHorizontal,
  ScanLine,
  MoveRight,
  Info,
} from "lucide-react";
import {
  teams,
  matches,
  featuredTeam,
  formHistory,
  methodology,
} from "../demoData";
import {
  DemoLabel,
  TeamBadge,
  FormBar,
  Results,
} from "../components/FootballUI";
import CalcitoMascot from "../components/CalcitoMascot";

function FormVisual() {
  const points = formHistory
    .map((value, i) => `${20 + i * 43},${140 - value * 1.1}`)
    .join(" ");
  return (
    <div className="visual-wrap">
      <div className="visual-caption">
        <span className="live-dot" /> LA FORME, EN UN COUP D’ŒIL{" "}
        <span>01 / 05</span>
      </div>
      <div className="form-visual">
        <div className="visual-top">
          <span className="eyebrow">TEAM INSIGHT</span>
          <DemoLabel compact />
        </div>
        <div className="featured-heading">
          <TeamBadge team={featuredTeam} />
          <div>
            <h2>{featuredTeam.name}</h2>
            <span>Dynamique récente · Équipe fictive</span>
          </div>
          <ArrowUpRight size={21} className="muted" />
        </div>
        <div className="score-display">
          <div>
            <span className="score-label">Indice de forme</span>
            <strong>
              {featuredTeam.score}
              <span>%</span>
            </strong>
          </div>
          <span className="form-status">
            <span /> Très bonne forme
          </span>
        </div>
        <div
          className="chart"
          role="img"
          aria-label="Évolution fictive de l’indice de forme de 46 à 92 %"
        >
          <div className="chart-labels">
            <span>100</span>
            <span>50</span>
            <span>0</span>
          </div>
          <svg
            viewBox="0 0 340 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#B4FF39" stopOpacity=".15" />
                <stop offset="100%" stopColor="#B4FF39" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[30, 85, 140].map((y) => (
              <line
                key={y}
                x1="0"
                y1={y}
                x2="340"
                y2={y}
                stroke="#344037"
                strokeDasharray="3 5"
              />
            ))}
            <polygon
              points={`20,155 ${points} 321,155`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={points}
              fill="none"
              stroke="#B4FF39"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle
              cx="321"
              cy={140 - 92 * 1.1}
              r="5"
              fill="#B4FF39"
              stroke="#1C2620"
              strokeWidth="3"
            />
          </svg>
        </div>
        <div className="chart-footer">
          <span>ÉVOLUTION SIMULÉE</span>
          <span>FORME ACTUELLE</span>
        </div>
        <div className="visual-bottom">
          <span>5 derniers matchs fictifs</span>
          <Results results={featuredTeam.results} />
        </div>
      </div>
      <div className="visual-note">
        <Info size={14} /> Un indice de forme. Pas une probabilité de victoire.
      </div>
    </div>
  );
}
export function SectionHeading({ eyebrow, title, children }) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function MatchCard({ match }) {
  return (
    <article className="match-card">
      <div className="match-top">
        <span>{match.competition}</span>
        <DemoLabel compact />
      </div>
      <div className="match-teams">
        <div>
          <TeamBadge team={match.home} />
          <h3>{match.home.name}</h3>
        </div>
        <span className="versus">VS</span>
        <div>
          <TeamBadge team={match.away} />
          <h3>{match.away.name}</h3>
        </div>
      </div>
      <div className="match-forms">
        <div>
          <span>Forme</span>
          <strong>
            {match.home.score}
            <small>%</small>
          </strong>
          <FormBar score={match.home.score} />
        </div>
        <div>
          <span>Forme</span>
          <strong>
            {match.away.score}
            <small>%</small>
          </strong>
          <FormBar score={match.away.score} />
        </div>
      </div>
      <div className="match-date">
        <span>Date fictive</span>
        <time>{match.date}</time>
      </div>
    </article>
  );
}
export function Ranking() {
  return (
    <section id="equipes" className="ranking-panel">
      <div className="ranking-heading">
        <div>
          <span className="eyebrow">LES DYNAMIQUES DU MOMENT</span>
          <h2>
            Team form ranking<span>.</span>
          </h2>
        </div>
        <DemoLabel compact />
      </div>
      <div
        className="ranking-table"
        role="table"
        aria-label="Classement fictif des équipes par indice de forme"
      >
        <div className="ranking-row table-head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Équipe</span>
          <span role="columnheader" className="recent">
            5 derniers matchs
          </span>
          <span role="columnheader">Indice de forme</span>
        </div>
        {teams.map((team, i) => (
          <div className="ranking-row" key={team.id} role="row">
            <span role="cell" className={`rank ${i === 0 ? "first" : ""}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="rank-team" role="cell">
              <TeamBadge team={team} small />
              <span>
                {team.name}
                <small>Équipe fictive</small>
              </span>
            </div>
            <div className="recent" role="cell">
              <Results results={team.results} />
            </div>
            <div className="rank-score" role="cell">
              <FormBar score={team.score} />
              <strong>
                {team.score}
                <small>%</small>
              </strong>
            </div>
          </div>
        ))}
      </div>
      <div className="ranking-bottom">
        <span>V : victoire · N : nul · D : défaite</span>
        <span>Classement de démonstration</span>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <div className="container home-notice">
        <Info size={15} /> Les visuels de cet accueil sont des démonstrations
        fictives.
      </div>
      <section className="hero container" id="accueil">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="live-dot" /> LE FOOTBALL, SOUS UN NOUVEL ANGLE
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
            Calcito transforme les performances récentes en un indice de forme
            clair et comparable. Pour mieux comprendre les équipes, au-delà du
            résultat.
          </p>
          <a className="button button-primary" href="#/equipes">
            Explorer les équipes <ArrowUpRight size={19} />
          </a>
          <a className="hero-method" href="#/methodologie">
            Découvrir la méthodologie <ArrowRight size={15} />
          </a>
        </div>
        <FormVisual />
      </section>
      <div className="facts-strip">
        <div className="container facts-inner">
          <div>
            <strong>05</strong>
            <span>
              matchs pour lire
              <br />
              la dynamique récente
            </span>
          </div>
          <div>
            <strong>
              0—100<span>%</span>
            </strong>
            <span>
              un indice de forme
              <br />
              clair et comparable
            </span>
          </div>
          <div>
            <ChartNoAxesCombined size={32} />
            <span>
              La performance en contexte.
              <br />
              <b>Le football avec perspective.</b>
            </span>
          </div>
          <DemoLabel />
        </div>
      </div>
      <section className="container matches-section" id="matchs">
        <SectionHeading
          eyebrow="LE PROCHAIN COUP D’ENVOI"
          title={
            <>
              Matchs à suivre<span>.</span>
            </>
          }
        >
          <span className="section-description">
            Des confrontations à lire autrement.
          </span>
        </SectionHeading>
        <div className="match-grid">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
        <p className="data-disclaimer">
          <Info size={14} /> Équipes, compétitions, dates et indices fictifs.
          Ces exemples illustrent uniquement l’interface.
        </p>
      </section>
      <section className="container insights-section">
        <Ranking />
        <span className="sr-only">
          Classement d’illustration, pas un classement officiel.
        </span>
        <aside id="comparateur" className="comparison-panel">
          <span className="eyebrow">UN AUTRE REGARD SUR LE MATCH</span>
          <h2>
            Deux équipes.
            <br />
            Un même repère.
          </h2>
          <p>
            Comparez leur forme récente sur une échelle commune, sans confondre
            dynamique et résultat à venir.
          </p>
          <div
            className="comparison-example"
            aria-label="Comparaison fictive : Riviera FC 92 %, Atlas United 86 %"
          >
            {teams.slice(0, 2).map((team) => (
              <div key={team.id}>
                <TeamBadge team={team} small />
                <span>{team.short}</span>
                <strong>
                  {team.score}
                  <small>%</small>
                </strong>
              </div>
            ))}
            <span className="comparison-divider">/</span>
          </div>
          <span className="comparison-note">
            EXEMPLE FICTIF · INDICES DE FORME
          </span>
          <a href="#/equipes" className="text-link">
            Voir les indices des équipes <ArrowUpRight size={18} />
          </a>
        </aside>
      </section>
      <section className="method-section" id="methodologie">
        <div className="container">
          <SectionHeading
            eyebrow="LA PERFORMANCE DEVIENT LISIBLE"
            title={
              <>
                Comment fonctionne Calcito<span> ?</span>
              </>
            }
          >
            <p className="section-description">
              Des matchs à l’indice.
              <br />
              Une lecture plus claire du jeu.
            </p>
          </SectionHeading>
          <div className="method-grid">
            {methodology.map((step) => {
              const Icon = {
                analysis: ScanLine,
                calculate: SlidersHorizontal,
                compare: ChartNoAxesCombined,
              }[step.icon];
              return (
                <article className="method-card" key={step.number}>
                  <div className="method-top">
                    <Icon size={27} strokeWidth={1.5} />
                    <span>{step.number}</span>
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              );
            })}
          </div>
          <div className="method-note">
            <span className="live-dot" />
            <p>
              L’indice mesure une forme récente. Il ne prédit pas à lui seul
              l’issue d’un match.
            </p>
            <MoveRight size={21} />
          </div>
        </div>
      </section>
      <div className="container mascot-home">
        <CalcitoMascot
          variant="welcome"
          title="Moi, c’est Calcito."
          message="Votre futur assistant pour explorer les performances, comprendre les dynamiques et comparer les équipes."
        />
      </div>
    </>
  );
}
