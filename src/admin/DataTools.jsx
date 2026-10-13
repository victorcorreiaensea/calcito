import { useState } from "react";
import { parseCSV, downloadCSV } from "../domain/csv";
import { matchPayload, validateMatch } from "../domain/match";
import { mutate, saveMatch } from "../services/manualRepository";

const matchHeaders = [
  "competition",
  "season",
  "round",
  "kickoff",
  "home",
  "away",
  "status",
  "goals_home",
  "goals_away",
  "halftime_home",
  "halftime_away",
  "extra_home",
  "extra_away",
  "penalties_home",
  "penalties_away",
  "source",
  "verified_at",
  "comment",
  ...["home", "away"].flatMap((side) =>
    [
      "shots",
      "shots_on_target",
      "woodwork",
      "big_chances",
      "team_rating",
      "possession",
      "xg",
    ].map((key) => `${side}_${key}`),
  ),
];
const teamHeaders = [
  "slug",
  "name",
  "short",
  "country",
  "logo_url",
  "domestic_league",
];
export default function DataTools({ dataset, reload, onImport }) {
  const [kind, setKind] = useState("matches"),
    [preview, setPreview] = useState([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [published, setPublished] = useState(false);
  function validate(rows, type) {
    const seen = new Set();
    return rows.map((row, index) => {
      const errors = [];
      let payload;
      if (type === "teams") {
        for (const key of ["slug", "name", "short", "country"])
          if (!row[key]?.trim()) errors.push(`${key} requis`);
        if (row.slug && !/^[a-z0-9-]+$/.test(row.slug))
          errors.push("slug invalide");
        if (row.short?.length > 8) errors.push("abréviation trop longue");
        if (row.logo_url && !/^https:\/\//.test(row.logo_url))
          errors.push("logo HTTPS requis");
        if (
          dataset.teams.some((team) => team.slug === row.slug) ||
          seen.has(row.slug)
        )
          errors.push("équipe déjà existante ou dupliquée");
        seen.add(row.slug);
        payload = {
          ...Object.fromEntries(
            teamHeaders
              .filter(
                (key) => key !== "domestic_league" || dataset.simplifiedReady,
              )
              .map((key) => [key, row[key] || null]),
          ),
          is_published: false,
        };
      } else {
        const comp = dataset.competitions.find(
          (c) => c.slug === row.competition,
        );
        const season = dataset.seasons.find(
          (s) =>
            s.competition_id === comp?.id &&
            (s.label === row.season || String(s.start_year) === row.season),
        );
        const home = dataset.teams.find((t) => t.slug === row.home),
          away = dataset.teams.find((t) => t.slug === row.away);
        payload = {
          ...row,
          season_id: season?.id || "",
          home_team_id: home?.id || "",
          away_team_id: away?.id || "",
          status: row.status || "finished",
          home_stats: {},
          away_stats: {},
        };
        for (const side of ["home", "away"])
          for (const key of [
            "shots",
            "shots_on_target",
            "woodwork",
            "big_chances",
            "team_rating",
            "possession",
            "xg",
          ])
            payload[`${side}_stats`][key] = row[`${side}_${key}`] || "";
        errors.push(
          ...Object.entries(validateMatch(payload, published)).map(
            ([key, value]) => `${key} : ${value}`,
          ),
        );
        if (
          season &&
          [home, away].some(
            (team) =>
              !dataset.members.some(
                (m) => m.season_id === season.id && m.team_id === team?.id,
              ),
          )
        )
          errors.push("équipe absente des participants de la saison");
        const date = Number.isFinite(Date.parse(row.kickoff))
          ? new Date(row.kickoff).toISOString().slice(0, 10)
          : "";
        const signature = [season?.id, home?.id, away?.id, date].join("|");
        if (
          seen.has(signature) ||
          dataset.matches.some(
            (m) =>
              m.season_id === season?.id &&
              m.home_team_id === home?.id &&
              m.away_team_id === away?.id &&
              m.kickoff.slice(0, 10) === date,
          )
        )
          errors.push("match déjà existant ou dupliqué");
        seen.add(signature);
      }
      return { line: index + 2, row, payload, errors };
    });
  }
  async function file(event) {
    setMessage("");
    setPreview([]);
    try {
      const selected = event.target.files[0];
      if (!selected) return;
      if (selected.size > 2 * 1024 * 1024)
        throw new Error("CSV limité à 2 Mo.");
      const rows = parseCSV(await selected.text());
      if (rows.length > 500)
        throw new Error("Import limité à 500 lignes par lot.");
      setPreview(validate(rows, kind));
    } catch (error) {
      setMessage(error.message);
    }
    event.target.value = "";
  }
  async function importRows() {
    setBusy(true);
    let done = 0;
    try {
      for (const item of preview) {
        if (item.errors.length)
          throw new Error("Corrigez les lignes invalides.");
        if (kind === "teams") await mutate("teams", "insert", item.payload);
        else await saveMatch(matchPayload(item.payload, published));
        done++;
      }
      setMessage(
        `${done} lignes importées${kind === "teams" ? " en fiches privées" : published ? " et publiées" : " en brouillon"}.`,
      );
      setPreview([]);
      await reload();
    } catch (error) {
      setMessage(
        `${done} lignes enregistrées avant interruption. ${error.message} Rechargez le fichier : les doublons seront signalés.`,
      );
      setPreview([]);
      await reload();
    } finally {
      setBusy(false);
    }
  }
  function exportMatches() {
    downloadCSV(
      "calcito-matchs.csv",
      dataset.matches.map((match) => {
        const season = dataset.seasons.find((s) => s.id === match.season_id),
          comp = dataset.competitions.find(
            (c) => c.id === season?.competition_id,
          );
        const record = {
          competition: comp?.slug,
          season: season?.label,
          round: match.round,
          kickoff: match.kickoff,
          home: dataset.teams.find((t) => t.id === match.home_team_id)?.slug,
          away: dataset.teams.find((t) => t.id === match.away_team_id)?.slug,
          status: match.status,
          goals_home: match.goals_home,
          goals_away: match.goals_away,
          halftime_home: match.halftime_home,
          halftime_away: match.halftime_away,
          extra_home: match.extra_home,
          extra_away: match.extra_away,
          penalties_home: match.penalties_home,
          penalties_away: match.penalties_away,
          source: match.source,
          verified_at: match.verified_at,
          comment: match.comment,
        };
        for (const side of ["home", "away"]) {
          const stats = dataset.stats.find(
            (s) =>
              s.match_id === match.id && s.team_id === match[`${side}_team_id`],
          );
          for (const key of [
            "shots",
            "shots_on_target",
            "woodwork",
            "big_chances",
            "team_rating",
            "possession",
            "xg",
          ])
            record[`${side}_${key}`] = stats?.[key] ?? null;
        }
        return record;
      }),
      matchHeaders,
    );
  }
  return (
    <section className="admin-panel">
      <h2>Import & export contrôlés</h2>
      <p className="muted-text">
        Les CSV sont analysés avant toute écriture. Les équipes importées
        restent privées. Les identifiants de clubs et compétitions sont leurs
        slugs ; la saison est son libellé ou son année de début.
      </p>
      <div className="admin-actions">
        {onImport && (
          <button className="button button-primary" onClick={onImport}>
            Importer des matchs avec correspondances
          </button>
        )}
        <button
          className="button button-secondary"
          onClick={() =>
            downloadCSV(
              "calcito-resultats-rapides.csv",
              dataset.simplified || [],
              [
                "id",
                "team_id",
                "opponent_name",
                "opponent_team_id",
                "kickoff",
                "season_start_year",
                "season_end_year",
                "competition_name",
                "venue",
                "goals_for",
                "goals_against",
                "is_published",
                "converted_match_id",
                "converted_at",
                "updated_at",
              ],
            )
          }
        >
          Exporter les résultats rapides & conversions
        </button>
        <button className="button button-secondary" onClick={exportMatches}>
          Exporter matchs & statistiques
        </button>
        <button
          className="button button-secondary"
          onClick={() =>
            downloadCSV("calcito-equipes.csv", dataset.teams, teamHeaders)
          }
        >
          Exporter les équipes
        </button>
        <button
          className="button button-secondary"
          onClick={() =>
            downloadCSV(
              `modele-${kind}.csv`,
              [],
              kind === "teams" ? teamHeaders : matchHeaders,
            )
          }
        >
          Télécharger le modèle vide
        </button>
      </div>
      <div className="admin-grid">
        <div className="admin-field">
          <label htmlFor="import-type">Type d’import</label>
          <select
            id="import-type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setPreview([]);
            }}
          >
            <option value="matches">Matchs</option>
            <option value="teams">Équipes</option>
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="import-file">Fichier CSV UTF-8</label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={file}
            disabled={busy}
          />
        </div>
        {kind === "matches" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={published}
              onChange={(event) => {
                setPublished(event.target.checked);
                setPreview([]);
              }}
            />{" "}
            Publier les matchs importés (validation source & vérification
            requises)
          </label>
        )}
      </div>
      {preview.length > 0 && (
        <>
          <p className="muted-text">
            Aperçu : {preview.length} lignes ·{" "}
            {preview.filter((p) => p.errors.length).length} lignes à corriger
          </p>
          <div className="table-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Contenu</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 30).map((item) => (
                  <tr key={item.line}>
                    <td>{item.line}</td>
                    <td>
                      {kind === "teams"
                        ? item.row.name
                        : `${item.row.home} – ${item.row.away} · ${item.row.kickoff}`}
                    </td>
                    <td>
                      {item.errors.length ? item.errors.join(" / ") : "Valide"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 30 && (
            <p className="muted-text">
              30 premières lignes affichées ; toutes les lignes sont validées
              avant import.
            </p>
          )}
          <button
            className="button button-primary"
            disabled={busy || preview.some((p) => p.errors.length)}
            onClick={importRows}
          >
            {busy
              ? "Import en cours…"
              : `Confirmer l’import de ${preview.length} lignes`}
          </button>
        </>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
