import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import { useTeamAnalysis } from "./TeamAnalysis";
import { TeamBadge, FormValue, Results } from "./FootballUI";
import CalcitoMascot from "./CalcitoMascot";
import { recentInsight, insightText } from "../domain/teamInsight";
export default function ClubSnapshot({
  team,
  season = "",
  featured = false,
  comparison = false,
}) {
  const analysis = useTeamAnalysis(team.id, season);
  const table = useFootball(
    "standings",
    { competition: team.competitionId, season },
    { enabled: Boolean(team.competitionId) },
  );
  const upcoming = useFootball("matches", { season, view: "upcoming" });
  const insight = recentInsight(analysis.recent.result?.data, team.id);
  const latest = analysis.timeline.result?.data.history?.at(-1);
  const rows = table.result?.data.rows || [],
    index = rows.findIndex((r) => r.id === team.id),
    row = rows[index];
  const next = upcoming.result?.data.find(
    (m) => m.status === "scheduled" && [m.home.id, m.away.id].includes(team.id),
  );
  return (
    <section className={`club-snapshot ${featured ? "club-featured" : ""}`}>
      {(featured || comparison) && (
        <div className="club-snapshot-heading">
          <TeamBadge team={team} />
          <div>
            <span className="eyebrow">
              {featured ? "À L’HONNEUR" : "FACE À FACE"}
            </span>
            <h2>
              <Link to={`/equipes/${team.id}`}>
                {team.name} <ArrowUpRight size={20} aria-hidden="true" />
              </Link>
            </h2>
            <p>{team.competitionName || team.country}</p>
          </div>
          {(featured || comparison) && (
            <FormValue score={team.score} variant={team.coverage?.variant} />
          )}
        </div>
      )}
      <div className="insight-tiles">
        <div>
          <span>Lecture instantanée · 3 matchs</span>
          <strong>
            {insight.instant == null ? "—" : insight.instant.toFixed(1)}
            <small> / 100</small>
          </strong>
          <small>Moyenne descriptive, hors indice principal</small>
          {latest && !latest.beforeInitialized && !latest.afterInitialized && (
            <small>
              Dernière évolution de l’indice : {latest.delta >= 0 ? "+" : ""}
              {latest.delta.toLocaleString("fr-FR", {
                maximumFractionDigits: 1,
              })}{" "}
              pts
            </small>
          )}
        </div>
        <div>
          <span>Derniers résultats · ancien → récent</span>
          <Results results={analysis.results} demo={false} />
          <small>{insight.rows.length} rencontres publiées</small>
        </div>
        <div>
          <span>
            Position {table.result?.data.partial ? "· partielle" : ""}
          </span>
          <strong>{row ? `${row.position}ᵉ` : "—"}</strong>
          <small>
            {row
              ? `${row.points} pts · ${row.won} V / ${row.drawn} N / ${row.lost} D · diff. ${row.goalDifference}`
              : "Classement indisponible"}
          </small>
        </div>
      </div>
      {!comparison && (
        <CalcitoMascot
          variant="analysis"
          emotion={
            !insight.rows.length
              ? "neutral"
              : insight.wins >= 3
                ? "joyful"
                : insight.goalsAgainst > insight.goalsFor
                  ? "disappointed"
                  : "focused"
          }
          title="Le regard de Calcito"
          message={insightText(team.name, insight)}
        />
      )}
      {!featured && !comparison && row && (
        <Link
          className="mini-standings"
          to={`/classements?competition=${team.competitionId}&season=${season || team.season}`}
          aria-label="Voir le classement complet"
        >
          {rows.slice(Math.max(0, index - 2), index + 3).map((r) => (
            <div className={r.id === team.id ? "is-current" : ""} key={r.id}>
              <b>{r.position}</b>
              <span>{r.team.name}</span>
              <span>{r.points} pts</span>
              <small>
                {r.points - row.points > 0 ? "+" : ""}
                {r.points - row.points} pts d’écart
              </small>
            </div>
          ))}
          <span className="text-link">Classement complet →</span>
        </Link>
      )}
      {featured && (
        <div className="featured-next">
          <span className="eyebrow">PROCHAIN RENDEZ-VOUS CONNU</span>
          {next ? (
            <Link to={`/matchs/${next.id}`}>
              {next.home.name} — {next.away.name}
              <small>
                {new Date(next.kickoff).toLocaleString("fr-FR", {
                  dateStyle: "medium",
                  ...(next.timeKnown === false ? {} : { timeStyle: "short" }),
                })}
              </small>
            </Link>
          ) : (
            <p>Aucune prochaine rencontre publiée.</p>
          )}
        </div>
      )}
    </section>
  );
}
