import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, ExternalLink, Download, Plus } from "lucide-react";
import { downloadCSV } from "../domain/csv";
import {
  readMatchCSV,
  matchImportHeaders,
  importMappings,
  planMatchImport,
  executeMatchImport,
  safeSourceURL,
  isFlashscoreSource,
} from "../domain/matchImport";
import { saveMatch } from "../services/manualRepository";
import { Notice } from "../components/FootballUI";
const FLASH_SOURCE =
  "https://www.flashscore.fr/football/portugal/liga-portugal/resultats/";
const outcomeLabel = {
  imported: "Importé",
  updated: "Mis à jour",
  ignored: "Ignoré",
  rejected: "Rejeté",
  uncertain: "À vérifier",
};
const statColumns = [
  ["home_shots", "Tirs domicile"],
  ["away_shots", "Tirs extérieur"],
  ["home_shots_on_target", "Tirs cadrés domicile"],
  ["away_shots_on_target", "Tirs cadrés extérieur"],
  ["home_big_chances", "Grosses occasions domicile"],
  ["away_big_chances", "Grosses occasions extérieur"],
  ["home_rating", "Note domicile / 10"],
  ["away_rating", "Note extérieur / 10"],
];
function newAssisted(comp, season) {
  return {
    date: "",
    competition: comp?.name || "Liga Portugal",
    season: season?.label || "2026-2027",
    home_team: "",
    away_team: "",
    home_goals: "",
    away_goals: "",
    source_url: "",
    ...Object.fromEntries(statColumns.map(([key]) => [key, ""])),
  };
}
export default function MatchImport({
  dataset,
  reload,
  onBusyChange = () => {},
}) {
  const [tab, setTab] = useState("csv"),
    [rows, setRows] = useState([]),
    [fileName, setFileName] = useState(""),
    [paste, setPaste] = useState(""),
    [mapping, setMapping] = useState({ teams: {}, competitions: {} }),
    [duplicates, setDuplicates] = useState("ignore"),
    [published, setPublished] = useState(false),
    [verified, setVerified] = useState(false),
    [flashscoreConsent, setFlashscoreConsent] = useState(false),
    [timeZone, setTimeZone] = useState("Europe/Paris"),
    [message, setMessage] = useState(""),
    [report, setReport] = useState(null),
    [reviewedPlan, setReviewedPlan] = useState(null),
    [progress, setProgress] = useState(null),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const competition = dataset.competitions.find(
    (c) => c.slug === "liga-portugal",
  );
  const initialSeason = dataset.seasons.find(
    (s) => s.competition_id === competition?.id && s.start_year === 2026,
  );
  const [assisted, setAssisted] = useState(() =>
    newAssisted(competition, initialSeason),
  );
  const fileRef = useRef(null),
    saving = useRef(false);
  const livePlan = useMemo(
    () =>
      planMatchImport(rows, dataset, {
        mapping,
        duplicates,
        published,
        verified,
        flashscoreConsent,
        timeZone,
      }),
    [
      rows,
      dataset,
      mapping,
      duplicates,
      published,
      verified,
      flashscoreConsent,
      timeZone,
    ],
  );
  const plan = report && reviewedPlan ? reviewedPlan : livePlan;
  const unknown = importMappings(rows, dataset, mapping);
  const ready = plan.filter(
    (p) => !p.errors.length && p.action !== "ignore",
  ).length;
  const ignored = plan.filter(
    (p) => !p.errors.length && p.action === "ignore",
  ).length;
  const rejected = plan.filter((p) => p.errors.length).length;
  useEffect(() => () => onBusyChange(false), []);
  function changed() {
    setReviewedPlan(null);
    setReport(null);
    setMessage("");
  }
  function load(text, name) {
    try {
      setRows(readMatchCSV(text));
      setFileName(name);
      setMapping({ teams: {}, competitions: {} });
      setVerified(false);
      setReport(null);
      setReviewedPlan(null);
      setPage(0);
      setMessage(
        "Fichier chargé. Contrôlez les correspondances et les scores avant import.",
      );
    } catch (e) {
      setRows([]);
      setReport(null);
      setMessage(e.message);
    }
  }
  async function file(event) {
    const selected = event.target.files[0];
    if (!selected) return;
    if (selected.size > 2 * 1024 * 1024) {
      setMessage("Fichier limité à 2 Mo.");
      event.target.value = "";
      return;
    }
    try {
      load(await selected.text(), selected.name);
    } catch {
      setMessage("Lecture du fichier impossible.");
    }
    event.target.value = "";
  }
  function associate(kind, name, id) {
    setMapping((m) => ({ ...m, [kind]: { ...m[kind], [name]: id } }));
    setVerified(false);
    changed();
  }
  function edit(index, key, value) {
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
    setVerified(false);
    changed();
  }
  async function importRows() {
    if (saving.current || !rows.length || (!ready && !ignored)) return;
    setReviewedPlan(plan);
    saving.current = true;
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    setProgress(null);
    try {
      // Freeze the reviewed plan. Every row uses the existing owner-only atomic save RPC.
      const result = await executeMatchImport(plan, {
        save: (p) => saveMatch(p, { timeoutMs: 30000 }),
        duplicates,
        onProgress: setProgress,
      });
      setReport(result);
      await reload();
    } catch (e) {
      setMessage(
        "Import interrompu. Vérifiez les lignes déjà enregistrées avant de recommencer. " +
          e.message,
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
      saving.current = false;
    }
  }
  function addAssisted(e) {
    e.preventDefault();
    if (rows.length >= 500 && !report) {
      setMessage("500 lignes maximum par lot.");
      return;
    }
    setRows((current) =>
      report ? [{ ...assisted }] : [...current, { ...assisted }],
    );
    setAssisted((current) => ({
      ...newAssisted(),
      competition: current.competition,
      season: current.season,
      date: current.date,
    }));
    setFileName("Relevé manuel Flashscore");
    setVerified(false);
    changed();
    if (report) {
      setMapping({ teams: {}, competitions: {} });
      setPage(0);
    } else setPage(Math.floor(rows.length / 15));
  }
  function sourceInput(key, label, type = "text", extra = {}) {
    return (
      <div className="admin-field">
        <label htmlFor={`assisted-${key}`}>{label}</label>
        <input
          id={`assisted-${key}`}
          type={type}
          value={assisted[key] || ""}
          onChange={(e) =>
            setAssisted((current) => ({ ...current, [key]: e.target.value }))
          }
          {...extra}
        />
      </div>
    );
  }
  return (
    <section className="admin-panel match-import">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            UNE SEULE BASE · VOS DONNÉES VÉRIFIÉES
          </span>
          <h2>Importer des matchs</h2>
        </div>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() =>
            downloadCSV("calcito-modele-matchs.csv", [], matchImportHeaders)
          }
        >
          <Download size={15} />
          Modèle CSV
        </button>
      </div>
      <nav className="entry-modes" aria-label="Modes d’import">
        <button
          disabled={busy}
          aria-pressed={tab === "csv"}
          className={`button ${tab === "csv" ? "button-primary" : "button-secondary"}`}
          onClick={() => setTab("csv")}
        >
          Import CSV
        </button>
        <button
          disabled={busy}
          aria-pressed={tab === "flashscore"}
          className={`button ${tab === "flashscore" ? "button-primary" : "button-secondary"}`}
          onClick={() => setTab("flashscore")}
        >
          Flashscore
        </button>
      </nav>
      <fieldset disabled={busy}>
        {tab === "csv" ? (
          <>
            <p className="muted-text">
              Sélectionnez un CSV, ou collez les cellules d’un tableur avec
              leurs en-têtes. Virgules, points-virgules et tabulations sont
              acceptés. Les noms et identifiants des équipes sont associés aux
              fiches existantes ; aucune équipe n’est créée automatiquement.
            </p>
            <div className="admin-field">
              <label htmlFor="match-import-file">Fichier CSV de matchs</label>
              <input
                ref={fileRef}
                id="match-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={file}
              />
            </div>
            <details className="admin-extra">
              <summary>
                Coller un relevé CSV ou les cellules d’un tableur
              </summary>
              <div className="admin-field">
                <label htmlFor="match-import-paste">Texte avec en-têtes</label>
                <textarea
                  id="match-import-paste"
                  rows={6}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={matchImportHeaders.join(",")}
                />
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  if (paste.length > 2 * 1024 * 1024) {
                    setMessage("Texte limité à 2 Mo.");
                    return;
                  }
                  load(paste, "Relevé collé");
                }}
              >
                Prévisualiser le texte
              </button>
            </details>
          </>
        ) : (
          <>
            <h3>Importer depuis Flashscore</h3>
            <Notice>
              Flashscore réserve l’usage de son site à un usage personnel et
              demande un consentement explicite pour extraire ou publier une
              partie substantielle de sa base. La récupération automatique reste
              désactivée. Avec l’autorisation nécessaire, vous pouvez relever
              les valeurs visibles et les contrôler ici ; sinon, utilisez un
              fichier issu d’une autre source autorisée.{" "}
              <a
                href="https://www.flashscore.fr/terms-of-use/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Consulter les conditions
              </a>
            </Notice>
            <a
              className="button button-secondary"
              href={FLASH_SOURCE}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ouvrir les résultats Liga Portugal <ExternalLink size={15} />
            </a>
            <p className="muted-text">
              Saison visée : 2026–2027. Vérifiez la saison affichée sur
              Flashscore et le fuseau des heures. Les notes d’équipe ne sont
              renseignées que si elles existent : n’utilisez pas une moyenne
              inventée des notes de joueurs. Vous pouvez aussi charger un
              fichier obtenu auprès d’une source autorisée dans Import CSV.
            </p>
            <form onSubmit={addAssisted}>
              <div className="admin-grid">
                <div className="admin-field">
                  <label htmlFor="assisted-competition">
                    Championnat du relevé
                  </label>
                  <select
                    id="assisted-competition"
                    value={assisted.competition}
                    onChange={(e) =>
                      setAssisted((current) => ({
                        ...current,
                        competition: e.target.value,
                        season: "",
                      }))
                    }
                  >
                    <option value="Liga Portugal">Liga Portugal</option>
                    {dataset.competitions
                      .filter((c) => c.name !== "Liga Portugal")
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                {sourceInput("season", "Saison du relevé", "text", {
                  required: true,
                  placeholder: "2026-2027",
                })}
                {sourceInput("date", "Date / heure du match", "text", {
                  required: true,
                  placeholder: "2026-10-12 20:00 ou 2026-10-12",
                })}
                {sourceInput("source_url", "URL de la fiche du match", "url", {
                  required: true,
                  placeholder: "https://www.flashscore.fr/match/…",
                })}
                {sourceInput("home_team", "Équipe domicile du relevé", "text", {
                  required: true,
                  list: "import-team-names",
                })}
                {sourceInput(
                  "away_team",
                  "Équipe extérieure du relevé",
                  "text",
                  { required: true, list: "import-team-names" },
                )}
                {sourceInput(
                  "home_goals",
                  "Score domicile du relevé",
                  "number",
                  { required: true, min: 0, max: 32767, step: 1 },
                )}
                {sourceInput(
                  "away_goals",
                  "Score extérieur du relevé",
                  "number",
                  { required: true, min: 0, max: 32767, step: 1 },
                )}
              </div>
              <details className="admin-extra">
                <summary>
                  Statistiques réellement disponibles (facultatif)
                </summary>
                <div className="admin-grid">
                  {statColumns.map(([key, label]) =>
                    sourceInput(key, label, "number", {
                      min: 0,
                      max: key.includes("rating") ? 10 : 32767,
                      step: key.includes("rating") ? ".01" : "1",
                      placeholder: "Non renseigné",
                    }),
                  )}
                </div>
              </details>
              <button className="button button-secondary" type="submit">
                <Plus size={15} />
                Ajouter à l’aperçu
              </button>
            </form>
          </>
        )}
        <datalist id="import-team-names">
          {dataset.teams.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        {rows.length > 0 && (
          <>
            <div className="import-controls admin-grid">
              <div className="admin-field">
                <label htmlFor="import-duplicates">
                  Doublons déjà enregistrés
                </label>
                <select
                  id="import-duplicates"
                  value={duplicates}
                  onChange={(e) => {
                    setDuplicates(e.target.value);
                    changed();
                  }}
                >
                  <option value="ignore">Ignorer les doublons</option>
                  <option value="update">Mettre à jour les doublons</option>
                </select>
              </div>
              <div className="admin-field">
                <label htmlFor="import-timezone">
                  Fuseau des heures sans décalage explicite
                </label>
                <select
                  id="import-timezone"
                  value={timeZone}
                  onChange={(e) => {
                    setTimeZone(e.target.value);
                    changed();
                  }}
                >
                  <option value="Europe/Paris">Europe/Paris</option>
                  <option value="Europe/Lisbon">Europe/Lisbon</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => {
                    setPublished(e.target.checked);
                    changed();
                  }}
                />
                Publier les nouveaux matchs (sinon brouillons)
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => {
                    setVerified(e.target.checked);
                    changed();
                  }}
                />
                J’ai vérifié les résultats et leurs sources
              </label>
            </div>
            {(rows.some((row) => isFlashscoreSource(row.source_url)) ||
              plan.some((item) => isFlashscoreSource(item.payload.source))) && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={flashscoreConsent}
                  onChange={(e) => {
                    setFlashscoreConsent(e.target.checked);
                    changed();
                  }}
                />
                Je dispose du consentement nécessaire pour réutiliser les
                données Flashscore.
              </label>
            )}
            <p className="muted-text">
              Une mise à jour conserve le statut publié ou privé du match
              existant. Les statistiques vides conservent ses valeurs connues.
              Les doublons internes au fichier sont ignorés après la première
              ligne valide. Pour une date seule, aucune heure réelle n’est
              annoncée.
            </p>
            {(unknown.teams.length > 0 || unknown.competitions.length > 0) && (
              <details open className="admin-extra">
                <summary>Corriger les correspondances non reconnues</summary>
                <div className="admin-grid">
                  {["teams", "competitions"].flatMap((kind) =>
                    unknown[kind].map((name) => (
                      <div className="admin-field" key={`${kind}-${name}`}>
                        <label>
                          {kind === "teams"
                            ? "Associer l’équipe"
                            : "Associer la compétition"}{" "}
                          « {name} »
                          <select
                            aria-label={`Associer ${kind === "teams" ? "équipe" : "compétition"} ${name}`}
                            value={mapping[kind][name] || ""}
                            onChange={(e) =>
                              associate(kind, name, e.target.value)
                            }
                          >
                            <option value="">
                              Choisir une fiche existante
                            </option>
                            {dataset[kind].map((record) => (
                              <option key={record.id} value={record.id}>
                                {record.name} · {record.country}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )),
                  )}
                </div>
              </details>
            )}
            <div className="panel-heading">
              <div>
                <h3>Aperçu · {fileName || "Relevé"}</h3>
                <p className="muted-text">
                  {rows.length} lignes · {ready} à importer / mettre à jour ·{" "}
                  {ignored} à ignorer · {rejected} à corriger
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="official-table import-preview">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Match et score</th>
                    <th>Date / compétition</th>
                    <th>Données et contrôle</th>
                  </tr>
                </thead>
                <tbody>
                  {plan
                    .slice(page * 15, (page + 1) * 15)
                    .map((item, localIndex) => {
                      const index = page * 15 + localIndex,
                        done = report?.rows.find((r) => r.line === item.line);
                      return (
                        <tr key={index}>
                          <td>
                            {item.line}
                            <button
                              className="quiet-button"
                              type="button"
                              aria-label={`Retirer la ligne ${item.line}`}
                              onClick={() => {
                                setRows((current) =>
                                  current.filter((_, i) => i !== index),
                                );
                                changed();
                                setPage(0);
                              }}
                            >
                              Retirer
                            </button>
                          </td>
                          <td>
                            <strong>
                              {item.home?.name || item.row.home_team} —{" "}
                              {item.away?.name || item.row.away_team}
                            </strong>
                            <div className="import-score">
                              <input
                                aria-label={`Buts domicile ligne ${item.line}`}
                                type="number"
                                min="0"
                                step="1"
                                value={rows[index].home_goals || ""}
                                onChange={(e) =>
                                  edit(index, "home_goals", e.target.value)
                                }
                              />
                              <span>–</span>
                              <input
                                aria-label={`Buts extérieur ligne ${item.line}`}
                                type="number"
                                min="0"
                                step="1"
                                value={rows[index].away_goals || ""}
                                onChange={(e) =>
                                  edit(index, "away_goals", e.target.value)
                                }
                              />
                            </div>
                            <details>
                              <summary>
                                Corriger les équipes et statistiques
                              </summary>
                              <div className="import-row-fields">
                                {[
                                  ["home_team", "Domicile"],
                                  ["away_team", "Extérieur"],
                                  ...statColumns,
                                  ["source_url", "URL source"],
                                ].map(([key, label]) => (
                                  <label key={key}>
                                    {label}
                                    <input
                                      aria-label={`${label} ligne ${item.line}`}
                                      value={rows[index][key] || ""}
                                      onChange={(e) =>
                                        edit(index, key, e.target.value)
                                      }
                                      list={
                                        key.endsWith("_team")
                                          ? "import-team-names"
                                          : undefined
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                            </details>
                          </td>
                          <td>
                            <label>
                              Date
                              <input
                                aria-label={`Date ligne ${item.line}`}
                                value={rows[index].date || ""}
                                onChange={(e) =>
                                  edit(index, "date", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Compétition
                              <input
                                aria-label={`Compétition ligne ${item.line}`}
                                value={rows[index].competition || ""}
                                onChange={(e) =>
                                  edit(index, "competition", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Saison
                              <input
                                aria-label={`Saison ligne ${item.line}`}
                                value={rows[index].season || ""}
                                onChange={(e) =>
                                  edit(index, "season", e.target.value)
                                }
                              />
                            </label>
                          </td>
                          <td>
                            <strong>
                              {done
                                ? outcomeLabel[done.status]
                                : item.errors.length
                                  ? "À corriger"
                                  : item.action === "ignore"
                                    ? "Doublon · sera ignoré"
                                    : item.action === "update"
                                      ? "Mise à jour"
                                      : "Nouveau match"}
                            </strong>
                            <p>
                              {item.available} / {item.totalStats} statistiques
                              renseignées
                            </p>
                            {(done
                              ? [done.message]
                              : [...item.errors, ...item.warnings]
                            ).map((text, i) => (
                              <p
                                className={
                                  item.errors.includes(text)
                                    ? "field-error"
                                    : "muted-text"
                                }
                                key={i}
                              >
                                {text}
                              </p>
                            ))}
                            {item.row.source_url &&
                              safeSourceURL(item.row.source_url) && (
                                <a
                                  className="text-link"
                                  href={item.row.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Consulter la source <ExternalLink size={12} />
                                </a>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(rows.length / 15))}
              </span>
              <button
                type="button"
                disabled={(page + 1) * 15 >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </button>
            </div>
            <button
              className="button button-primary"
              type="button"
              disabled={(!ready && !ignored) || Boolean(report)}
              onClick={importRows}
            >
              <FileUp size={16} />
              {report
                ? report.uncertain || report.unprocessed
                  ? "Traitement interrompu"
                  : "Traitement terminé"
                : busy
                  ? `Import en cours · ${progress?.rows.length || 0} / ${rows.length}`
                  : ready
                    ? `Importer les ${ready} matchs valides`
                    : `Ignorer les ${ignored} doublons`}
            </button>
            <p className="muted-text">
              Les lignes invalides restent rejetées ; chaque match et ses deux
              statistiques sont sauvegardés ensemble. Un lot peut être
              partiellement importé si une connexion échoue. Une nouvelle
              validation nécessite de corriger le relevé ou de recharger le
              fichier.
            </p>
          </>
        )}
      </fieldset>
      {report && (
        <section className="import-report" aria-live="polite">
          <h3>Bilan de l’import</h3>
          <p>
            {report.imported} importés · {report.updated} mis à jour ·{" "}
            {report.ignored} ignorés · {report.rejected} rejetés
            {report.unprocessed ? ` · ${report.unprocessed} non traités` : ""}
            {report.uncertain
              ? ` · ${report.uncertain} sauvegarde(s) à vérifier`
              : ""}
          </p>
          {report.uncertain > 0 && (
            <Notice>
              La dernière réponse n’a pas été confirmée. Le match peut avoir été
              enregistré : rechargez les matchs et consultez le journal avant de
              recommencer.
            </Notice>
          )}
          <button
            className="button button-secondary"
            onClick={() =>
              downloadCSV("calcito-bilan-import.csv", report.rows, [
                "line",
                "status",
                "id",
                "message",
              ])
            }
          >
            Télécharger le bilan
          </button>
        </section>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      {!rows.length && (
        <p className="muted-text">
          Aucune donnée n’a été importée. Chargez un fichier ou ajoutez un
          relevé pour commencer.
        </p>
      )}
    </section>
  );
}
