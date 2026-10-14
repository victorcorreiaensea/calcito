import { calendarLeagues } from "../domain/calendar";
import { requireDatabase } from "./supabaseClient";
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Source inaccessible (HTTP ${r.status}).`);
  const text = await r.text();
  if (text.length > 1000000) throw new Error("Source trop volumineuse.");
  return JSON.parse(text);
}
export async function fetchCalendar() {
  const commit = await json(
    "https://api.github.com/repos/openfootball/football.json/commits/master",
  );
  if (!/^[a-f0-9]{40}$/.test(commit.sha))
    throw new Error("Version de source invalide.");
  const catalog = await json(
    `${import.meta.env.BASE_URL}data/season-2026-2027.json`,
  );
  const results = await Promise.allSettled(
    calendarLeagues.map(async (league) => {
      const source = `https://raw.githubusercontent.com/openfootball/football.json/${commit.sha}/2026-27/${league.code}.1.json`;
      return { code: league.code, source, ...(await json(source)) };
    }),
  );
  const feeds = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  return {
    sourceCommit: commit.sha,
    fetchedAt: new Date().toISOString(),
    clubs: catalog.clubs,
    feeds,
  };
}
async function rpc(name, args = {}) {
  const r = await requireDatabase().rpc(name, args);
  if (r.error) {
    const e = new Error(r.error.message);
    e.code = r.error.code;
    throw e;
  }
  return r.data;
}
export const calendarStatus = () => rpc("arena_calendar_status");
export const applyCalendar = (entries, nonce) =>
  rpc("arena_calendar_apply", { entries, client_nonce: nonce });
