// Toutes les équipes, dates et valeurs ci-dessous sont fictives.
// Un indice de forme n'est jamais une probabilité de victoire.
export const teams = [
  {
    id: "riviera",
    name: "Riviera FC",
    short: "RIV",
    city: "Riviera",
    score: 92,
    color: "#B4FF39",
    results: ["V", "V", "N", "V", "V"],
  },
  {
    id: "atlas",
    name: "Atlas United",
    short: "ATL",
    city: "Atlas",
    score: 86,
    color: "#C6BCF6",
    results: ["V", "N", "V", "V", "V"],
  },
  {
    id: "port",
    name: "Port Athletic",
    short: "POR",
    city: "Port",
    score: 78,
    color: "#F2C078",
    results: ["N", "V", "V", "D", "V"],
  },
  {
    id: "nord",
    name: "Nord City",
    short: "NOR",
    city: "Nord",
    score: 71,
    color: "#9DC8E9",
    results: ["V", "D", "N", "V", "V"],
  },
  {
    id: "mont",
    name: "Mont Royal",
    short: "MON",
    city: "Mont",
    score: 64,
    color: "#E3A6A6",
    results: ["D", "V", "N", "V", "N"],
  },
];
export const matches = [
  {
    id: "one",
    competition: "Ligue Horizon",
    date: "18 juin 2030 · 20:45",
    home: teams[0],
    away: teams[1],
  },
  {
    id: "two",
    competition: "Coupe des Clubs",
    date: "19 juin 2030 · 18:30",
    home: teams[2],
    away: teams[3],
  },
  {
    id: "three",
    competition: "Ligue Horizon",
    date: "20 juin 2030 · 21:00",
    home: teams[4],
    away: teams[0],
  },
];
export const featuredTeam = teams[0];
export const formHistory = [46, 61, 55, 74, 69, 83, 79, 92];
export const methodology = [
  {
    number: "01",
    title: "Analyser les matchs",
    text: "Les cinq derniers matchs constituent le point de départ : résultats et statistiques décrivent les performances récentes.",
    icon: "analysis",
  },
  {
    number: "02",
    title: "Calculer la forme",
    text: "L’algorithme propriétaire pondère ces informations pour produire un indice de forme compris entre 0 et 100 %. La formule sera intégrée ultérieurement.",
    icon: "calculate",
  },
  {
    number: "03",
    title: "Comparer les équipes",
    text: "Un même indicateur pour situer les dynamiques récentes et lire le football avec davantage de contexte.",
    icon: "compare",
  },
];

export const demoCompetitions = [
  { id: "horizon", name: "Ligue Horizon", country: "Compétition fictive" },
  { id: "coupe", name: "Coupe des Clubs", country: "Compétition fictive" },
];
export const priorityCompetitions = [
  "Ligue 1",
  "Premier League",
  "Liga",
  "Serie A",
  "Bundesliga",
  "Liga Portugal",
  "Ligue des Champions",
  "Compétitions internationales",
];

// Scenarios are display-only illustrations, never inputs to calcitoEngine or predictions.
export const simulationScenarios = [
  { score: 82, results: ["V", "N", "V", "V", "N"] },
  { score: 68, results: ["N", "D", "V", "N", "V"] },
  { score: 91, results: ["V", "V", "N", "V", "V"] },
  { score: 55, results: ["D", "N", "V", "D", "N"] },
  { score: 74, results: ["V", "D", "N", "V", "V"] },
  { score: 63, results: ["N", "V", "D", "N", "V"] },
  { score: 87, results: ["V", "N", "V", "V", "V"] },
  { score: 47, results: ["D", "N", "D", "V", "D"] },
];
