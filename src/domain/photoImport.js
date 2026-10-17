import { normalizeClub } from "./simplified.js";
import { parseImportDate } from "./matchImport.js";
import { statFields, nullableNumber, validateMatch } from "./match.js";
const aliases = [
  ["Aston Villa", "Aston Villa FC"],
  ["Manchester City", "Manchester City FC"],
  ["Arsenal", "Arsenal FC"],
  ["Liverpool", "Liverpool FC"],
  ["Crystal Palace", "Crystal Palace FC"],
  ["Sunderland", "Sunderland AFC"],
  ["Bournemouth", "AFC Bournemouth"],
  ["Real Madrid", "Real Madrid CF"],
  ["Villarreal", "Villarreal CF"],
  ["Celta Vigo", "RC Celta de Vigo"],
  ["Real Sociedad", "Real Sociedad de Fútbol"],
  ["Juventus", "Juventus FC"],
  ["Hoffenheim", "TSG 1899 Hoffenheim", "TSG Hoffenheim"],
  ["Benfica", "SL Benfica", "Sport Lisboa e Benfica"],
  ["Club Brugge", "Club Bruges", "Club Brugge KV"],
  ["Bayern Munich", "Bayern München", "Bayern Munich FC", "FC Bayern München"],
  ["Sporting", "Sporting CP", "Sporting Portugal"],
  ["Inter", "Inter Milan", "Internazionale", "FC Internazionale Milano"],
  ["PSG", "Paris Saint-Germain", "Paris SG"],
  ["Manchester Utd", "Manchester United", "Manchester United FC"],
  [
    "Atl. Madrid",
    "Atlético Madrid",
    "Atletico Madrid",
    "Club Atlético de Madrid",
  ],
  ["Naples", "Napoli", "SSC Napoli"],
  ["Barcelone", "Barcelona", "FC Barcelona"],
  ["Côme", "Como", "Como 1907"],
  ["Porto", "FC Porto"],
  ["Marseille", "Olympique de Marseille", "OM"],
  ["Lyon", "Olympique Lyonnais", "OL"],
  ["Betis", "Real Betis", "Real Betis Balompié"],
  ["Dortmund", "Borussia Dortmund"],
  ["Stuttgart", "VfB Stuttgart"],
  ["Leverkusen", "Bayer Leverkusen", "Bayer 04 Leverkusen"],
  ["AS Rome", "Roma", "AS Roma"],
  ["AEK", "AEK Athens", "AEK Athènes"],
  ["Alkmaar", "AZ Alkmaar", "AZ"],
  ["Din. Zagreb", "Dinamo Zagreb"],
  ["Lech", "Lech Poznan"],
  ["Plzen", "Viktoria Plzen"],
  ["Nijmegen", "NEC Nijmegen"],
  ["Red Bull Salzbourg", "Red Bull Salzburg", "RB Salzburg"],
  ["Bodo/Glimt", "Bodø/Glimt"],
  ["Lillestrom", "Lillestrøm"],
  ["Olympiakos", "Olympiacos"],
  ["H. Beer Sheva", "Hapoel Beer Sheva"],
  ["Shakhtar", "Shakhtar Donetsk"],
  ["Slovan Bratislava", "ŠK Slovan Bratislava"],
  ["Omonia", "Omonia Nicosia"],
  ["Sabah FC", "Sabah FK"],
  ["Royale Union SG", "Union Saint-Gilloise"],
  ["Levski", "Levski Sofia"],
  ["Viking", "Viking FK"],
  ["PSV", "PSV Eindhoven"],
  ["Sparta Prague", "Sparta Praha"],
  ["Slavia Prague", "Slavia Praha"],
  ["Jagiellonia", "Jagiellonia Bialystok"],
  ["Ferencvaros", "Ferencváros"],
  ["Fenerbahce", "Fenerbahçe"],
  ["Besiktas", "Beşiktaş"],
];
export const photoSlug = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export function clubCandidates(name, teams) {
  const group = aliases.find((a) =>
    a.some((n) => normalizeClub(n) === normalizeClub(name)),
  ) || [name];
  const keys = new Set(group.map(normalizeClub));
  return teams.filter(
    (t) => keys.has(normalizeClub(t.name)) || keys.has(normalizeClub(t.slug)),
  );
}
export function initialPhotoDraft(row, dataset) {
  const p = row.proposed;
  const d = {
    competition_id:
      dataset.competitions.find((c) => c.slug === p.competition)?.id || "",
    round: String(p.round || ""),
    date: p.date || "",
    timezone: p.timezone || "Europe/Paris",
    goals_home: p.score?.[0] ?? null,
    goals_away: p.score?.[1] ?? null,
    identity_confirmed: false,
  };
  for (const side of ["home", "away"]) {
    const matches = clubCandidates(p[side + "_name"] || "", dataset.teams);
    d[side + "_team_id"] = matches.length === 1 ? matches[0].id : "";
    d["new_" + side] = {
      name: p[side + "_name"] || "",
      slug: photoSlug(p[side + "_name"] || ""),
      country: p.clubs?.[side]?.country || "",
      domestic_league: p.clubs?.[side]?.domestic_league || "",
    };
    d[side + "_stats"] = Object.fromEntries(
      statFields.map(([k]) => [k, p.stats?.[side]?.[k] ?? null]),
    );
  }
  return { ...d, ...(Object.keys(row.draft || {}).length ? row.draft : {}) };
}
export function photoReviewPayload(draft) {
  const date = parseImportDate(draft.date, draft.timezone);
  if (date.dateOnly) throw new Error("Heure du coup d’envoi requise.");
  const d = { ...draft, kickoff: date.iso };
  for (const side of ["home", "away"])
    d[side + "_stats"] = Object.fromEntries(
      statFields.map(([k]) => [k, nullableNumber(d[side + "_stats"]?.[k])]),
    );
  for (const k of ["goals_home", "goals_away"]) d[k] = nullableNumber(d[k]);
  const errors = validateMatch(
    {
      ...d,
      season_id: "photo-review",
      home_team_id: d.home_team_id || "new-home",
      away_team_id: d.away_team_id || "new-away",
      source: "Capture fournie",
      verified_at: new Date().toISOString(),
      status: "finished",
    },
    true,
  );
  if (Object.keys(errors).length)
    throw new Error(Object.values(errors).join(" "));
  if (!d.identity_confirmed)
    throw new Error(
      "Confirmez les identités et les informations de la rencontre.",
    );
  return d;
}
export async function openPhotoBundle(
  buffer,
  code,
  cryptoAPI = globalThis.crypto,
) {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.slice(0, 8)) !== "CALCIPH1")
    throw new Error("Format de lot inconnu.");
  try {
    const material = await cryptoAPI.subtle.importKey(
      "raw",
      new TextEncoder().encode(code.trim()),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await cryptoAPI.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: bytes.slice(8, 24),
        iterations: 250000,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const clear = await cryptoAPI.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(24, 36) },
      key,
      bytes.slice(36),
    );
    const stream = new Blob([clear])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const result = JSON.parse(await new Response(stream).text());
    if (
      result.format !== "calcito-photos-v1" ||
      !Array.isArray(result.captures) ||
      result.captures.length > 72
    )
      throw new Error();
    return result.captures;
  } catch {
    throw new Error("Code incorrect ou lot endommagé.");
  }
}
