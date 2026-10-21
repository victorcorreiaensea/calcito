import { readFile, writeFile } from "node:fs/promises";
import {
  statisticFields,
  validStatistic,
  statisticalRecords,
  coverageAudit,
} from "../src/engines/statistics/data.js";
import { parseCSV } from "../src/domain/csv.js";
import { validateResearch } from "../src/engines/statistics/validation.js";

// Optional PUBLIC dataset export: { teams, competitions, seasons, matches, stats, simplified }.
// Never read auth/session/environment secrets or write to Supabase.
const [datasetPath, outputPath] = process.argv.slice(2);
let report;
if (datasetPath) {
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const cutoff = new Date().toISOString();
  const records = statisticalRecords(dataset);
  const years = [...new Set(records.map((r) => r.year))];
  report = {
    source: datasetPath,
    cutoff,
    seasons: years.map((year) => ({
      year,
      coverage: coverageAudit(records, { cutoff, year }),
      validations: [
        ...new Set(
          records.filter((r) => r.year === year).map((r) => r.competition),
        ),
      ].map((competitionId) => ({
        competitionId,
        ...validateResearch(records, dataset, { cutoff, year, competitionId }),
      })),
    })),
  };
} else {
  const input = JSON.parse(
    await readFile(
      new URL(
        "../data/imports/europe-2026-match-statistics.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const summarize = (matches) => {
    const observations = matches.flatMap((m) => [m.home_stats, m.away_stats]);
    return {
      matches: matches.length,
      clubs: new Set(
        matches.flatMap((m) => [m.home_club.slug, m.away_club.slug]),
      ).size,
      fields: Object.fromEntries(
        statisticFields.map((key) => [
          key,
          {
            n: observations.filter((o) => validStatistic(key, o[key])).length,
            denominator: observations.length,
          },
        ]),
      ),
      perClub: [
        ...new Set(
          matches.flatMap((m) => [m.home_club.slug, m.away_club.slug]),
        ),
      ].map((slug) => ({
        slug,
        matches: matches.filter(
          (m) => m.home_club.slug === slug || m.away_club.slug === slug,
        ).length,
      })),
    };
  };
  const csv = parseCSV(
    await readFile(
      new URL(
        "../public/downloads/calcito_resultats_2026_2027.csv",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const csvRows = csv;
  report = {
    nationalCsv: {
      source: "public/downloads/calcito_resultats_2026_2027.csv",
      matches: csvRows.length,
      competitions: [...new Set(csvRows.map((r) => r.competition))].map(
        (competition) => ({
          competition,
          matches: csvRows.filter((r) => r.competition === competition).length,
          advancedObservations: csvRows
            .filter((r) => r.competition === competition)
            .reduce(
              (n, r) =>
                n +
                [
                  "home_shots",
                  "away_shots",
                  "home_shots_on_target",
                  "away_shots_on_target",
                ].filter((k) => r[k] !== undefined && r[k] !== "").length,
              0,
            ),
        }),
      ),
      note: "Fichier local uniquement : aucune preuve de publication ou de disponibilité historique dans Supabase.",
    },
    source:
      "data/imports/europe-2026-match-statistics.json — relevé local fourni, pas un export Supabase",
    sourceDescription: input.source,
    coverage: summarize(input.matches),
    competitions: [
      ...new Set(input.matches.map((m) => `${m.competition}:${m.season}`)),
    ].map((key) => ({
      key,
      ...summarize(
        input.matches.filter((m) => `${m.competition}:${m.season}` === key),
      ),
    })),
    validation: {
      status: "unavailable",
      evaluated: 0,
      reason:
        "Deux matchs par club seulement ; dates de vérification/publication et created_at/updated_at des statistiques absentes du fichier. Impossible de reconstituer leur disponibilité historique. Aucun timestamp inventé, aucun score de validation réel calculé.",
    },
    liveDatabase: {
      status: "not-audited",
      reason:
        "Lecture directe bloquée par le proxy de cet environnement (CONNECT 403). Couverture de production non certifiée ; calcul effectué côté site sur son dataset public.",
    },
  };
}
const text = JSON.stringify(report, null, 2) + "\n";
if (outputPath) await writeFile(outputPath, text);
else process.stdout.write(text);
