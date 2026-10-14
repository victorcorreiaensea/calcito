export function compareHistoricalForms(series, range = "10") {
  if (series.length !== 2) return null;
  const valid = series.map((s) => ({
    team: s.team,
    rows: s.history.filter(
      (r) => !r.afterInitialized && Number.isFinite(r.after),
    ),
  }));
  if (valid.some((s) => !s.rows.length)) return null;
  const versions = new Set(valid.flatMap((s) => s.rows.map((r) => r.version)));
  if (versions.size !== 1) return null;
  const current = valid.map((s) => ({ team: s.team, row: s.rows.at(-1) }));
  const leader =
    current[0].row.after === current[1].row.after
      ? null
      : current[0].row.after > current[1].row.after
        ? current[0].team
        : current[1].team;
  const windows = valid.map((s) =>
    range === "season" ? s.rows : s.rows.slice(-Number(range)),
  );
  const start = Math.max(...windows.map((rows) => Date.parse(rows[0].kickoff))),
    end = Math.min(...windows.map((rows) => Date.parse(rows.at(-1).kickoff)));
  if (start >= end) return { leader, current, progress: null };
  const changes = valid.map((s) => {
    const before = s.rows.filter((r) => Date.parse(r.kickoff) <= start).at(-1),
      after = s.rows.filter((r) => Date.parse(r.kickoff) <= end).at(-1);
    return { team: s.team, before, after, delta: after.after - before.after };
  });
  return {
    leader,
    current,
    progress: {
      start,
      end,
      changes,
      leader:
        changes[0].delta === changes[1].delta
          ? null
          : changes[0].delta > changes[1].delta
            ? changes[0].team
            : changes[1].team,
    },
  };
}
