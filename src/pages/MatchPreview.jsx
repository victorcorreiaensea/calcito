import { Link, useParams, useSearchParams } from "react-router-dom";
import { useFootball } from "../hooks/useFootball";
import { DataState, PageHeading } from "../components/FootballUI";
import { FixtureCard } from "./Matches";
import ClubSnapshot from "../components/ClubSnapshot";
import RecentMetrics from "../components/RecentMetrics";
import { useTeamAnalysis } from "../components/TeamAnalysis";
import MatchForecast from "../components/MatchForecast";
import MatchStatistics from "../components/MatchStatistics";
export default function MatchPreview() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const state = useFootball("matches", {});
  const history = useFootball(
    "teamHistory",
    { teamId: params.get("team") },
    { enabled: Boolean(params.get("team")) },
  );
  const match =
    state.result?.data.find((m) => m.id === matchId) ||
    history.result?.data.find((m) => m.id === matchId);
  const homeAnalysis = useTeamAnalysis(match?.home.id, match?.season);
  const awayAnalysis = useTeamAnalysis(match?.away.id, match?.season);
  return (
    <section className="container page-content">
      <Link className="back-link" to="/matchs">
        ← Toutes les rencontres
      </Link>
      <PageHeading
        label="LE CONTEXTE AVANT LE COUP D’ENVOI"
        title={
          match
            ? `${match.home.name} — ${match.away.name}`
            : "Analyse de la rencontre"
        }
      />
      <DataState
        {...state}
        loading={state.loading || (!match && history.loading)}
        empty={!match}
      >
        {match && (
          <>
            <FixtureCard match={match} />
            {match.status === "finished" && <MatchStatistics match={match} />}
            {match.home.id && match.away.id && (
              <Link
                className="button button-secondary"
                to={`/comparateur?team=${match.home.id}&against=${match.away.id}&match=${match.id}&season=${match.season}`}
              >
                Comparer les équipes →
              </Link>
            )}
            {match.status === "scheduled" ? (
              <>
                <div className="detail-grid">
                  <ClubSnapshot
                    team={match.home}
                    season={String(match.season)}
                  />
                  <ClubSnapshot
                    team={match.away}
                    season={String(match.season)}
                  />
                </div>
                <div className="detail-grid">
                  <RecentMetrics team={match.home} analysis={homeAnalysis} />
                  <RecentMetrics team={match.away} analysis={awayAnalysis} />
                </div>
                <MatchForecast match={match} />
              </>
            ) : (
              <p className="muted-text">
                Les indices ci-dessus sont figés avant la rencontre. Les fiches
                clubs présentent leur situation actuelle ; aucun pronostic
                rétroactif n’est calculé.
              </p>
            )}
          </>
        )}
      </DataState>
    </section>
  );
}
