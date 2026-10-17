import { useEffect, useState, useRef } from "react";
import {
  Camera,
  Check,
  CheckCheck,
  Upload,
  RefreshCw,
  Send,
  LockKeyhole,
} from "lucide-react";
import { Notice } from "../components/FootballUI";
import { TeamSearch } from "./MatchForm";
import { statFields } from "../domain/match";
import {
  initialPhotoDraft,
  openPhotoBundle,
  photoReviewPayload,
} from "../domain/photoImport";
import {
  listPhotos,
  photoImage,
  photoHistory,
  photoStatus,
  stagePhoto,
  reviewPhoto,
  publishPhotos,
} from "../services/photoRepository";
const labels = {
  review: "À vérifier",
  verified: "Vérifié",
  published: "Publié",
};
const bundleURL =
  import.meta.env.BASE_URL + "downloads/calcito-europe-72.calcito";
function Editor({ row, dataset, onSave, busy, onDirty }) {
  const originalDialog = useRef(null);
  const [draft, setDraft] = useState(() => initialPhotoDraft(row, dataset)),
    [image, setImage] = useState(""),
    [history, setHistory] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([photoImage(row.sha256), photoHistory(row.sha256)])
      .then(([value, events]) => {
        if (active) {
          setImage(value);
          setHistory(events);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [row.sha256]);
  const edit = (key, value) => {
    setDraft((d) => ({
      ...d,
      [key]: value,
      identity_confirmed: key === "identity_confirmed" ? value : false,
    }));
    onDirty(true);
  };
  const stats = (side, key, value) =>
    edit(side + "_stats", {
      ...draft[side + "_stats"],
      [key]: value === "" ? null : Number(value),
    });
  const p = row.proposed,
    locked = row.status === "published";
  return (
    <article className="photo-editor admin-card">
      <header>
        <div>
          <span className="eyebrow">
            {p.id || row.filename} · {labels[row.status]}
          </span>
          <h3>
            {p.home_name} — {p.away_name}
          </h3>
          <p>À gauche : domicile · À droite : extérieur</p>
        </div>
        {image && (
          <button
            type="button"
            onClick={() => originalDialog.current?.showModal()}
            className="photo-thumbnail"
            aria-label="Agrandir la capture originale"
          >
            <img
              src={image}
              alt={"Capture originale " + p.home_name + " – " + p.away_name}
            />
            <span>Agrandir</span>
          </button>
        )}
      </header>
      <dialog
        ref={originalDialog}
        className="photo-original"
        aria-label="Capture originale agrandie"
      >
        <button
          type="button"
          className="button button-secondary"
          onClick={() => originalDialog.current?.close()}
        >
          Fermer la capture
        </button>
        {image && (
          <img
            src={image}
            alt={
              "Capture originale complète : " +
              p.home_name +
              " – " +
              p.away_name
            }
          />
        )}
      </dialog>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || locked}>
        <div className="photo-fields">
          <label>
            Compétition
            <select
              value={draft.competition_id}
              onChange={(e) => edit("competition_id", e.target.value)}
            >
              <option value="">Choisir…</option>
              {dataset.competitions
                .filter((c) =>
                  ["champions-league", "europa-league"].includes(c.slug),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Journée
            <select
              value={draft.round}
              onChange={(e) => edit("round", e.target.value)}
            >
              <option value="">Choisir…</option>
              <option value="1">Journée 1</option>
              <option value="2">Journée 2</option>
            </select>
          </label>
          <label>
            Date et heure sur la capture
            <input
              type="datetime-local"
              value={draft.date}
              onChange={(e) => edit("date", e.target.value)}
            />
          </label>
          <label>
            Fuseau horaire
            <input
              value={draft.timezone}
              onChange={(e) => edit("timezone", e.target.value)}
              placeholder="Europe/Paris"
            />
          </label>
        </div>
        {["home", "away"].map((side) => (
          <div key={side} className="photo-club">
            <TeamSearch
              label={
                (side === "home" ? "Domicile : " : "Extérieur : ") +
                p[side + "_name"]
              }
              id={"photo-" + side}
              teams={dataset.teams}
              value={draft[side + "_team_id"]}
              exclude={draft[side === "home" ? "away_team_id" : "home_team_id"]}
              onChange={(id) => edit(side + "_team_id", id)}
            />
            {!draft[side + "_team_id"] && (
              <details open>
                <summary>Nouveau club ou correspondance à vérifier</summary>
                <p className="muted-text">
                  Vérifiez d’abord la recherche ci-dessus pour réutiliser une
                  fiche existante. Sans correspondance, ces informations
                  créeront une fiche au moment de la publication. Aucun
                  identifiant externe ni écusson ne sera inventé.
                </p>
                <div className="photo-fields">
                  {[
                    ["name", "Nom du club"],
                    ["slug", "Identifiant lisible stable"],
                    ["country", "Pays"],
                    ["domestic_league", "Championnat d’origine"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={draft["new_" + side]?.[key] || ""}
                        onChange={(e) =>
                          edit("new_" + side, {
                            ...draft["new_" + side],
                            [key]: e.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
        <div className="photo-stat-table">
          <div className="photo-stat-row photo-stat-heading">
            <span>Statistique</span>
            <strong>Domicile</strong>
            <strong>Extérieur</strong>
          </div>
          <div className="photo-stat-row">
            <span>Score final</span>
            {["home", "away"].map((side) => (
              <input
                key={side}
                aria-label={"Buts " + side}
                type="number"
                min="0"
                step="1"
                value={draft["goals_" + side] ?? ""}
                onChange={(e) =>
                  edit(
                    "goals_" + side,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            ))}
          </div>
          {statFields.map(([key, label, type]) => (
            <div className="photo-stat-row" key={key}>
              <span>{label}</span>
              {["home", "away"].map((side) => (
                <input
                  key={side}
                  aria-label={
                    label + " " + (side === "home" ? "domicile" : "extérieur")
                  }
                  type="number"
                  min="0"
                  step={type === "integer" ? "1" : "0.01"}
                  max={
                    type === "possession"
                      ? 100
                      : type === "rating"
                        ? 10
                        : undefined
                  }
                  placeholder="Inconnu"
                  value={draft[side + "_stats"]?.[key] ?? ""}
                  onChange={(e) => stats(side, key, e.target.value)}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="muted-text">
          Vide = inconnu, jamais zéro. Notes et poteaux non visibles restent
          vides. Une valeur déjà renseignée en base est conservée ; une
          contradiction bloque la validation.
        </p>
        {p.warnings?.map((w) => (
          <p className="photo-warning" key={w}>
            {w}
          </p>
        ))}
        {p.missing?.length > 0 && (
          <p className="photo-warning">
            Données absentes sur la capture : {p.missing.join(", ")}.
          </p>
        )}
        <label className="photo-confirm">
          <input
            type="checkbox"
            checked={Boolean(draft.identity_confirmed)}
            onChange={(e) => edit("identity_confirmed", e.target.checked)}
          />
          J’ai vérifié la capture, les deux clubs, la compétition, la journée,
          le score, les statistiques et le fuseau horaire. Les informations de
          nouveaux clubs sont correctes.
        </label>
        <div className="admin-actions">
          <button
            className="button button-secondary"
            onClick={() => onSave(draft, false)}
          >
            <Upload size={16} />
            Enregistrer à vérifier
          </button>
          <button
            className="button button-primary"
            onClick={() => {
              try {
                const payload = photoReviewPayload(draft);
                setError("");
                onSave(payload, true);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <Check size={16} />
            Valider cette capture
          </button>
        </div>
      </fieldset>
      <details className="photo-history">
        <summary>Historique privé de cette capture ({history.length})</summary>
        {history.map((event) => (
          <div key={event.id}>
            <p>
              {new Date(event.at).toLocaleString("fr-FR")} ·{" "}
              {labels[event.after_value.status]} · révision{" "}
              {event.after_value.revision}
            </p>
            <details>
              <summary>Valeurs enregistrées</summary>
              <pre>{JSON.stringify(event.after_value.draft, null, 2)}</pre>
            </details>
          </div>
        ))}
      </details>
      {locked && (
        <Notice>
          Cette capture a été publiée. Le match et ses statistiques sont
          accessibles sur les fiches équipes.
        </Notice>
      )}
    </article>
  );
}
export default function PhotoImport({ dataset, onReload, onBusyChange }) {
  const [ready, setReady] = useState(false),
    [rows, setRows] = useState([]),
    [active, setActive] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [progress, setProgress] = useState(""),
    [selected, setSelected] = useState([]),
    [dirty, setDirty] = useState(false),
    [filter, setFilter] = useState("all"),
    [confirmPublish, setConfirmPublish] = useState(false),
    [report, setReport] = useState(null);
  const row = rows.find((r) => r.sha256 === active);
  const work = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const reload = async () => {
    await photoStatus();
    setReady(true);
    const data = await listPhotos();
    setRows(data);
    setActive((a) =>
      data.some((r) => r.sha256 === a) ? a : data[0]?.sha256 || "",
    );
  };
  useEffect(() => {
    work(reload);
  }, []);
  useEffect(() => {
    onBusyChange?.(busy || dirty);
    return () => onBusyChange?.(false);
  }, [busy, dirty, onBusyChange]);
  async function importBundle(buffer) {
    const captures = await openPhotoBundle(buffer, code);
    let duplicates = 0,
      added = 0;
    const existing = new Set(rows.map((r) => r.sha256));
    for (let i = 0; i < captures.length; i++) {
      setProgress(`Sauvegarde privée : ${i + 1} / ${captures.length}`);
      await stagePhoto(captures[i]);
      if (existing.has(captures[i].sha256)) duplicates++;
      else {
        added++;
        existing.add(captures[i].sha256);
      }
    }
    setCode("");
    setMessage(
      `${captures.length} images analysées · ${added} captures ajoutées · ${duplicates} doublons évités. Aucune publication automatique.`,
    );
    await reload();
  }
  const chosen = rows.filter(
    (r) => selected.includes(r.sha256) && r.status === "verified",
  );
  const groups = [
    "champions-league:1",
    "champions-league:2",
    "europa-league:1",
    "europa-league:2",
  ];
  return (
    <section className="photo-import">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SOURCE → VÉRIFICATION → PUBLICATION</span>
          <h2>
            <Camera size={24} /> Importation des statistiques par images
          </h2>
          <p>
            Captures et brouillons privés, conservés dans Supabase. Seules les
            rencontres validées sont publiées.
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={busy || dirty}
          onClick={() => work(reload)}
        >
          <RefreshCw size={16} />
          Actualiser
        </button>
      </div>
      {error && (
        <Notice>
          <span role="alert">{error}</span>
        </Notice>
      )}
      {message && (
        <p role="status" className="photo-message">
          {message}
        </p>
      )}
      {progress && <p role="status">{progress}</p>}
      {!ready ? (
        <div className="admin-card">
          <h3>Activer l’importation privée</h3>
          <p>
            Dans Supabase → SQL Editor, exécutez la mise à jour 006 après les
            mises à jour précédentes. Revenez ici puis cliquez sur Actualiser.
          </p>
          <a
            className="button button-primary"
            href={
              import.meta.env.BASE_URL + "downloads/calcito-import-photos.sql"
            }
            target="_blank"
            rel="noreferrer"
          >
            Ouvrir le SQL 006
          </a>
        </div>
      ) : (
        <>
          <div className="admin-card photo-upload">
            <div>
              <LockKeyhole size={23} />
              <h3>Ton lot européen est prêt</h3>
              <p>
                72 captures préparées : Champions League et Europa League,
                journées 1 et 2. Saisis le code privé fourni dans la
                conversation, puis charge le lot. Les photos sont déchiffrées
                dans ton navigateur avant leur sauvegarde privée.
              </p>
            </div>
            <label>
              Code du lot
              <input
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              className="button button-primary"
              disabled={busy || !code.trim() || dirty}
              onClick={() =>
                work(async () => {
                  const response = await fetch(bundleURL);
                  if (!response.ok)
                    throw new Error("Téléchargement du lot impossible.");
                  await importBundle(await response.arrayBuffer());
                })
              }
            >
              <Upload size={16} />
              Charger les 72 captures préparées
            </button>
            <label className="photo-file">
              Ou ouvrir un autre lot préparé (.calcito)
              <input
                type="file"
                accept=".calcito"
                disabled={busy || dirty || !code.trim()}
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file)
                    work(async () => importBundle(await file.arrayBuffer()));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="photo-message">
            {rows.length} images enregistrées · {rows.length} rencontres
            proposées · {rows.filter((r) => r.status === "verified").length}{" "}
            vérifiées en attente ·{" "}
            {rows.filter((r) => r.status === "published").length} publiées ·{" "}
            {rows.filter((r) => r.status === "review").length} à vérifier
          </p>
          <div className="photo-progress">
            {groups.map((group) => {
              const [comp, day] = group.split(":");
              const list = rows.filter(
                (r) =>
                  r.proposed.competition === comp &&
                  String(r.draft.round || r.proposed.round) === day,
              );
              const published = list.filter(
                  (r) => r.status === "published",
                ).length,
                verified = list.filter((r) => r.status === "verified").length;
              return (
                <div className="admin-card" key={group}>
                  <span className="eyebrow">
                    {comp === "champions-league"
                      ? "CHAMPIONS LEAGUE"
                      : "EUROPA LEAGUE"}{" "}
                    · J{day}
                  </span>
                  <strong>
                    {published}
                    <small> / {list.length || 18} publiés</small>
                  </strong>
                  <progress max={list.length || 18} value={published} />
                  <span>
                    {verified} vérifiés · {list.length - verified - published} à
                    vérifier
                  </span>
                </div>
              );
            })}
          </div>
          {rows.length > 0 && (
            <>
              <div className="photo-toolbar">
                <label>
                  Afficher
                  <select
                    value={filter}
                    disabled={dirty || busy}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">
                      Toutes les captures ({rows.length})
                    </option>
                    {Object.entries(labels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label} ({rows.filter((r) => r.status === key).length})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  disabled={busy || dirty}
                  onClick={() =>
                    setSelected(
                      rows
                        .filter((r) => r.status === "verified")
                        .map((r) => r.sha256),
                    )
                  }
                >
                  <CheckCheck size={16} />
                  Sélectionner les vérifiés
                </button>
                <button
                  className="button button-primary"
                  disabled={busy || dirty || !chosen.length}
                  onClick={() => setConfirmPublish(true)}
                >
                  <Send size={16} />
                  Publier la sélection ({chosen.length})
                </button>
              </div>
              {confirmPublish && (
                <div className="admin-card" role="alert">
                  <h3>Publier {chosen.length} rencontre(s) vérifiée(s) ?</h3>
                  <p>
                    Les résultats et statistiques deviendront visibles. Les
                    indices et historiques seront actualisés dans l’ordre
                    chronologique. Les pronostics concernés pourront être
                    réglés.
                  </p>
                  <button
                    className="button button-primary"
                    disabled={busy || dirty}
                    onClick={() =>
                      work(async () => {
                        const result = await publishPhotos(
                          chosen.map((r) => r.sha256),
                        );
                        setReport(result);
                        setConfirmPublish(false);
                        setSelected([]);
                        setMessage(
                          `${result.published} rencontre(s) publiée(s), ${result.new_clubs} nouveau(x) club(s).`,
                        );
                        await reload();
                        await onReload?.();
                      })
                    }
                  >
                    Confirmer la publication
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setConfirmPublish(false)}
                  >
                    Annuler
                  </button>
                </div>
              )}
              {report && (
                <p className="muted-text">
                  Dernière publication : {report.published} matchs ·{" "}
                  {report.new_clubs} clubs créés · {report.already_published}{" "}
                  déjà publiés.
                </p>
              )}
              <div className="photo-workspace">
                <nav className="photo-list" aria-label="Captures à traiter">
                  {rows
                    .filter((r) => filter === "all" || r.status === filter)
                    .map((r) => (
                      <div
                        className={
                          "photo-list-item " +
                          (r.sha256 === active ? "is-active" : "")
                        }
                        key={r.sha256}
                      >
                        <input
                          aria-label={
                            "Sélectionner " +
                            r.proposed.home_name +
                            " – " +
                            r.proposed.away_name
                          }
                          type="checkbox"
                          disabled={busy || dirty || r.status !== "verified"}
                          checked={selected.includes(r.sha256)}
                          onChange={(e) =>
                            setSelected((a) =>
                              e.target.checked
                                ? [...a, r.sha256]
                                : a.filter((v) => v !== r.sha256),
                            )
                          }
                        />
                        <button
                          disabled={busy || dirty}
                          onClick={() => {
                            setActive(r.sha256);
                            setError("");
                          }}
                        >
                          <span>
                            {r.proposed.id} · J
                            {r.draft.round || r.proposed.round}
                          </span>
                          <strong>
                            {r.proposed.home_name} — {r.proposed.away_name}
                          </strong>
                          <small>{labels[r.status]}</small>
                        </button>
                      </div>
                    ))}
                </nav>
                {row && (
                  <Editor
                    key={row.sha256 + ":" + row.revision}
                    row={row}
                    dataset={dataset}
                    busy={busy}
                    onDirty={setDirty}
                    onSave={(draft, verify) =>
                      work(async () => {
                        await reviewPhoto(row, draft, verify);
                        setDirty(false);
                        setMessage(
                          verify
                            ? "Capture vérifiée. Elle peut maintenant être sélectionnée pour publication."
                            : "Brouillon privé enregistré.",
                        );
                        await reload();
                      })
                    }
                  />
                )}
              </div>
              {dirty && (
                <p role="status" className="photo-warning">
                  Modifications non enregistrées : enregistre la capture pour
                  poursuivre ou{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setDirty(false);
                      setActive("");
                    }}
                  >
                    abandonne les modifications
                  </button>
                  .
                </p>
              )}
            </>
          )}
          <Notice>
            Le lot préparé contient une lecture des captures fournies, sans
            confirmation indépendante des résultats. Toute nouvelle série de
            photos doit d’abord être analysée et préparée en lot ; cet écran ne
            simule pas une reconnaissance automatique des images. Les
            statistiques ajoutées ne modifient pas la formule Calcito.
          </Notice>
        </>
      )}
    </section>
  );
}
