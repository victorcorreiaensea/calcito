import { normalizeClub } from "./simplified.js";
export const clubAliases = [
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
export const clubSlug = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export function clubCandidates(name, teams) {
  const group = clubAliases.find((a) =>
    a.some((n) => normalizeClub(n) === normalizeClub(name)),
  ) || [name];
  const keys = new Set(group.map(normalizeClub));
  return teams.filter(
    (t) => keys.has(normalizeClub(t.name)) || keys.has(normalizeClub(t.slug)),
  );
}
