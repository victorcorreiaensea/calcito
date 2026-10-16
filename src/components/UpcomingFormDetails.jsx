import { useFootball } from "../hooks/useFootball";
export default function UpcomingFormDetails({ team, season }) {
  const timeline = useFootball("formTimeline", { teamId: team.id, season });
  const standings = useFootball(
    "standings",
    { competition: team.competitionId, season },
    { enabled: Boolean(team.competitionId) },
  );
  const three = timeline.result?.data.history?.slice(-3) || [];
  const instant =
    three.length === 3
      ? three.reduce((n, r) => n + r.performance, 0) / 3
      : null;
  const position = standings.result?.data.rows.find(
    (r) => r.id === team.id,
  )?.position;
  return (
    <small className="fixture-current-context">
      Lecture 3 matchs : {instant == null ? "—" : `${instant.toFixed(1)} / 100`}
      <br />
      Position : {position ? `${position}ᵉ` : "—"}
      {standings.result?.data.partial ? " · partielle" : ""}
    </small>
  );
}
