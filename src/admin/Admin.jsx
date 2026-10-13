import { useEffect, useState } from "react";
import {
  LockKeyhole,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  EyeOff,
  Eye,
} from "lucide-react";
import { useAuth } from "./AuthProvider";
import { databaseConfig, supabase } from "../services/supabaseClient";
import {
  getDataset,
  invalidateManualData,
  mutate,
  readAll,
} from "../services/manualRepository";
import { completeness } from "../domain/match";
import { PageHeading, Notice } from "../components/FootballUI";
import MatchForm from "./MatchForm";
import SimplifiedForm from "./SimplifiedForm";
import Coverage from "./Coverage";
import { normalizeClub } from "../domain/simplified";
import CatalogManager from "./CatalogManager";
import DataTools from "./DataTools";
import MatchImport from "./MatchImport";
import BulkPublish from "./BulkPublish";
import { DATE_ONLY_MARKER } from "../domain/matchImport";

function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const auth = useAuth();
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPassword("");
      if (error) setMessage("Connexion impossible. Vérifiez vos identifiants.");
    } catch {
      setMessage("Le service de connexion est indisponible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-login">
      <div className="admin-login-icon">
        <LockKeyhole size={30} />
      </div>
      <span className="eyebrow">ESPACE PRIVÉ</span>
      <h1>
        Administration<span>.</span>
      </h1>
      <p>
        Connexion réservée au propriétaire de Calcito. Les visiteurs consultent
        les données publiées sans compte.
      </p>
      {!databaseConfig.configured ? (
        <Notice>
          L’administration n’est pas encore activée. La base Supabase et le
          compte propriétaire doivent être configurés suivant le guide fourni
          dans le dépôt.
        </Notice>
      ) : auth.user && !auth.admin ? (
        <>
          <Notice>
            {auth.error ||
              "Ce compte ne possède pas les autorisations administrateur."}
          </Notice>
          <button className="button button-secondary" onClick={auth.signOut}>
            Se déconnecter
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="admin-field">
            <label htmlFor="admin-email">Adresse e-mail</label>
            <input
              type="email"
              id="admin-email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="admin-password">Mot de passe</label>
            <input
              type="password"
              id="admin-password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Connexion…" : "Se connecter"}
            <LockKeyhole size={15} />
          </button>
          {message && (
            <p role="alert" className="field-error">
              {message}
            </p>
          )}
        </form>
      )}
      <small>
        <ShieldCheck size={13} /> Authentification et autorisations vérifiées
        côté base de données.
      </small>
    </section>
  );
}
const tabs = [
  ["dashboard", "Vue d’ensemble"],
  ["entry", "Saisie rapide"],
  ["coverage", "Suivi de couverture"],
  ["matches", "Matchs & brouillons"],
  ["teams", "Équipes"],
  ["competitions", "Compétitions"],
  ["seasons", "Saisons & participants"],
  ["imports", "Importer des matchs"],
  ["tools", "Import / Export"],
  ["audit", "Journal"],
];
function Dashboard() {
  const auth = useAuth();
  const [dataset, setDataset] = useState(null),
    [error, setError] = useState(null),
    [tab, setTab] = useState("dashboard"),
    [editing, setEditing] = useState(null),
    [entryMode, setEntryMode] = useState("complete"),
    [initialTeam, setInitialTeam] = useState(""),
    [importBusy, setImportBusy] = useState(false),
    [page, setPage] = useState(0),
    [deleteId, setDeleteId] = useState(null),
    [message, setMessage] = useState(""),
    [audit, setAudit] = useState([]),
    [filter, setFilter] = useState("all");
  async function reload() {
    invalidateManualData();
    try {
      const result = await getDataset();
      setDataset(result);
      setError(null);
      return result;
    } catch (error) {
      setError(error.message);
      return null;
    }
  }
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    if (tab === "audit")
      readAll("admin_audit_log", "*", (query) =>
        query.order("occurred_at", { ascending: false }),
      )
        .then(setAudit)
        .catch((error) => setError(error.message));
  }, [tab]);
  async function saved(id, next) {
    const result = await reload();
    setMessage(
      next
        ? entryMode === "simplified"
          ? "Résultat enregistré. Prêt pour le suivant."
          : "Match enregistré. Prêt pour le suivant."
        : entryMode === "simplified"
          ? "Résultat enregistré dans la base."
          : "Match enregistré dans la base.",
    );
    if (!next && result)
      setEditing(
        entryMode === "simplified"
          ? result.simplified.find((m) => m.id === id)
          : result.matches.find((m) => m.id === id),
      );
    else if (next) setEditing(null);
  }
  async function action(callback, success) {
    try {
      await callback();
      await reload();
      setMessage(success);
    } catch (error) {
      setMessage(error.message);
    }
  }
  if (error)
    return (
      <section className="container page-content">
        <Notice>{error}</Notice>
        <button className="button button-primary" onClick={reload}>
          Réessayer
        </button>
      </section>
    );
  if (!dataset)
    return (
      <div className="container state-panel" role="status">
        Chargement de l’administration…
      </div>
    );
  const enriched = dataset.matches.map((match) => ({
    ...match,
    home_stats: dataset.stats.find(
      (s) => s.match_id === match.id && s.team_id === match.home_team_id,
    ),
    away_stats: dataset.stats.find(
      (s) => s.match_id === match.id && s.team_id === match.away_team_id,
    ),
  }));
  const quickResults = (dataset.simplified || [])
    .filter((r) => !r.converted_at)
    .map((r) => ({ ...r, entry_type: "simplified" }));
  const allEntries = [...enriched, ...quickResults].sort(
    (a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff),
  );
  function openEntry(mode = "complete", teamId = "", row = null) {
    setEntryMode(mode);
    setInitialTeam(teamId);
    setEditing(row);
    setTab("entry");
  }
  function convert(row) {
    const opponent =
      dataset.teams.find((t) => t.id === row.opponent_team_id) ||
      dataset.teams.find(
        (t) => normalizeClub(t.name) === normalizeClub(row.opponent_name),
      );
    if (!opponent) {
      setMessage(
        "Créez ou liez la fiche de cet adversaire avant la conversion, puis ajoutez les deux équipes aux participants d’une saison.",
      );
      return;
    }
    const season = dataset.seasons.find(
      (s) =>
        s.start_year === row.season_start_year &&
        dataset.members.some(
          (m) => m.season_id === s.id && m.team_id === row.team_id,
        ) &&
        dataset.members.some(
          (m) => m.season_id === s.id && m.team_id === opponent.id,
        ) &&
        dataset.competitions.find((c) => c.id === s.competition_id)?.type ===
          "league",
    );
    if (!season) {
      setMessage(
        "La conversion nécessite une saison complète et ses deux équipes participantes. Configurez-les dans Saisons & participants.",
      );
      return;
    }
    openEntry("complete", "", {
      id: row.id,
      converting: true,
      season_id: season.id,
      round: "À préciser",
      kickoff: row.kickoff,
      status: "finished",
      home_team_id: row.venue === "home" ? row.team_id : opponent.id,
      away_team_id: row.venue === "home" ? opponent.id : row.team_id,
      goals_home: row.venue === "home" ? row.goals_for : row.goals_against,
      goals_away: row.venue === "home" ? row.goals_against : row.goals_for,
      source: "",
      verified_at: new Date().toISOString(),
      is_published: false,
    });
  }
  const visible = allEntries.filter(
    (match) =>
      filter === "all" ||
      (filter === "draft" && !match.is_published) ||
      (filter === "published" && match.is_published) ||
      (filter === "incomplete" &&
        match.entry_type !== "simplified" &&
        completeness(match).percent < 100) ||
      (filter === "simplified" && match.entry_type === "simplified") ||
      (filter === "complete" && match.entry_type !== "simplified"),
  );
  return (
    <section className="container page-content admin-page">
      <div className="admin-title">
        <PageHeading
          label="PRIVATE CONTROL ROOM"
          title="Administration"
          description="La saisie du week-end et des coupes, dans un seul espace privé. Match complet pour deux équipes, résultat rapide pour une équipe suivie."
        />
        <button
          className="button button-secondary"
          disabled={importBusy}
          onClick={auth.signOut}
        >
          <LogOut size={15} /> Déconnexion
        </button>
      </div>
      <nav className="admin-tabs" aria-label="Administration">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            disabled={importBusy}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setTab(key);
              setPage(0);
              setMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
      {tab === "dashboard" && (
        <>
          <div className="admin-metrics">
            {[
              [
                allEntries.filter((m) => m.is_published).length,
                "Matchs publiés",
              ],
              [
                allEntries.filter((m) => !m.is_published).length,
                "Brouillons privés",
              ],
              [dataset.teams.length, "Équipes"],
              [
                enriched.filter((m) => completeness(m).percent < 100).length,
                "Matchs incomplets",
              ],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="admin-panel">
            <span className="eyebrow">VOTRE ROUTINE DE SAISIE</span>
            <h2>Le terrain le week-end. L’Europe en semaine.</h2>
            <p className="muted-text">
              Créez d’abord les équipes, la saison et ses participants. Préparez
              les matchs via un CSV ou saisissez-les à la suite. La compétition,
              la journée et la source sont conservées entre deux entrées.
            </p>
            <button
              className="button button-primary"
              onClick={() => {
                openEntry("complete");
              }}
            >
              <Plus size={16} />
              Ajouter un match complet
            </button>
            <button
              className="button button-secondary"
              onClick={() => openEntry("simplified")}
            >
              Ajouter un résultat rapide
            </button>
          </section>
          <Notice>
            Les classements restent partiels jusqu’à confirmation des règles, de
            la couverture et des données. La formule Calcito et le modèle de
            pronostics ne sont pas encore fournis.
          </Notice>
        </>
      )}
      {tab === "coverage" && (
        <Coverage
          dataset={dataset}
          onAdd={(id) => openEntry("simplified", id)}
        />
      )}
      {tab === "entry" && (
        <>
          <div className="entry-modes">
            <button
              className={`button ${entryMode === "complete" ? "button-primary" : "button-secondary"}`}
              onClick={() => openEntry("complete")}
            >
              Ajouter un match complet
            </button>
            <button
              className={`button ${entryMode === "simplified" ? "button-primary" : "button-secondary"}`}
              onClick={() => openEntry("simplified")}
            >
              Ajouter un résultat rapide
            </button>
          </div>
          {entryMode === "simplified" && !dataset.simplifiedReady ? (
            <Notice>
              Le résultat rapide attend la migration Supabase 002. Les matchs
              complets restent disponibles. Appliquez le fichier
              supabase/migrations/002_simplified_results.sql dans le SQL Editor,
              puis rechargez cette page.
            </Notice>
          ) : entryMode === "simplified" ? (
            <SimplifiedForm
              dataset={dataset}
              editing={editing}
              initialTeam={initialTeam}
              onSaved={saved}
              onCancel={() => {
                setEditing(null);
                setTab("matches");
              }}
            />
          ) : (
            <MatchForm
              dataset={dataset}
              editing={editing}
              onSaved={saved}
              onCancel={() => {
                setEditing(null);
                setTab("matches");
              }}
            />
          )}
          <section className="admin-panel">
            <h2>Dernières saisies</h2>
            <div className="catalog-list">
              {[...allEntries]
                .sort(
                  (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
                )
                .slice(0, 5)
                .map((row) => (
                  <button
                    key={row.id}
                    onClick={() =>
                      openEntry(
                        row.entry_type === "simplified"
                          ? "simplified"
                          : "complete",
                        "",
                        row,
                      )
                    }
                  >
                    {row.entry_type === "simplified"
                      ? `${dataset.teams.find((t) => t.id === row.team_id)?.name} · ${row.opponent_name}`
                      : `${dataset.teams.find((t) => t.id === row.home_team_id)?.name} · ${dataset.teams.find((t) => t.id === row.away_team_id)?.name}`}
                    <span>
                      {row.entry_type === "simplified"
                        ? "Résultat rapide"
                        : "Match complet"}{" "}
                      · {row.is_published ? "Publié" : "Brouillon"} ·{" "}
                      {new Date(row.updated_at).toLocaleString("fr-FR")}
                    </span>
                  </button>
                ))}
            </div>
            {!allEntries.length && (
              <p className="muted-text">
                Vos prochaines saisies apparaîtront ici.
              </p>
            )}
          </section>
        </>
      )}
      {tab === "matches" && (
        <section className="admin-panel">
          <fieldset disabled={importBusy} className="admin-operation-guard">
            <div className="panel-heading">
              <h2>Matchs & brouillons</h2>
              <button
                className="button button-secondary"
                onClick={() => setTab("imports")}
              >
                Importer des matchs
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  openEntry("complete");
                }}
              >
                <Plus size={15} />
                Ajouter
              </button>
            </div>
            <BulkPublish
              dataset={dataset}
              reload={reload}
              onBusyChange={setImportBusy}
            />
            <div className="filter-field">
              <label htmlFor="admin-match-filter">Afficher</label>
              <select
                id="admin-match-filter"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Tous</option>
                <option value="draft">Brouillons</option>
                <option value="published">Publiés</option>
                <option value="complete">Matchs complets</option>
                <option value="simplified">Résultats rapides</option>
                <option value="incomplete">Statistiques manquantes</option>
              </select>
            </div>
            <div className="admin-match-list">
              {visible.slice(page * 20, (page + 1) * 20).map((match) => (
                <article key={match.id}>
                  <div>
                    <span className="eyebrow">
                      {match.entry_type === "simplified"
                        ? match.competition_name
                        : dataset.competitions.find(
                            (c) =>
                              c.id ===
                              dataset.seasons.find(
                                (s) => s.id === match.season_id,
                              )?.competition_id,
                          )?.name}{" "}
                      ·{" "}
                      {match.entry_type === "simplified"
                        ? "Résultat rapide"
                        : match.round}
                    </span>
                    <h3>
                      {
                        dataset.teams.find(
                          (t) =>
                            t.id ===
                            (match.entry_type === "simplified"
                              ? match.team_id
                              : match.home_team_id),
                        )?.name
                      }{" "}
                      <span>
                        {(match.entry_type === "simplified"
                          ? match.goals_for
                          : match.goals_home) ?? "—"}{" "}
                        –{" "}
                        {(match.entry_type === "simplified"
                          ? match.goals_against
                          : match.goals_away) ?? "—"}
                      </span>{" "}
                      {match.entry_type === "simplified"
                        ? match.opponent_name
                        : dataset.teams.find((t) => t.id === match.away_team_id)
                            ?.name}
                    </h3>
                    <p>
                      {match.entry_type === "simplified" ||
                      (match.comment || "").includes(DATE_ONLY_MARKER)
                        ? new Date(match.kickoff).toLocaleDateString("fr-FR")
                        : new Date(match.kickoff).toLocaleString("fr-FR")}{" "}
                      · {match.is_published ? "Publié" : "Brouillon privé"} ·
                      {match.entry_type === "simplified"
                        ? "Résultat seul · statistiques non renseignées"
                        : `Complétude ${completeness(match).percent} %`}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      aria-label="Modifier le match"
                      onClick={() => {
                        openEntry(
                          match.entry_type === "simplified"
                            ? "simplified"
                            : "complete",
                          "",
                          match,
                        );
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    {match.entry_type === "simplified" && (
                      <button
                        onClick={() => convert(match)}
                        aria-label="Convertir en match complet"
                      >
                        Convertir
                      </button>
                    )}
                    {match.is_published && (
                      <button
                        aria-label="Dépublier le match"
                        onClick={() =>
                          action(
                            () =>
                              mutate(
                                match.entry_type === "simplified"
                                  ? "simplified_results"
                                  : "matches",
                                "update",
                                { is_published: false },
                                match.id,
                              ),
                            "Match dépublié.",
                          )
                        }
                      >
                        <EyeOff size={16} />
                      </button>
                    )}
                    <button
                      aria-label="Supprimer le match"
                      onClick={() => setDeleteId(match.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {deleteId === match.id && (
                    <div className="delete-confirm">
                      <span>
                        Supprimer ce match et ses statistiques ? Le classement
                        sera recalculé.
                      </span>
                      <button
                        onClick={() =>
                          action(async () => {
                            await mutate(
                              match.entry_type === "simplified"
                                ? "simplified_results"
                                : "matches",
                              "delete",
                              null,
                              match.id,
                            );
                            setDeleteId(null);
                          }, "Match supprimé et opération auditée.")
                        }
                      >
                        Confirmer la suppression
                      </button>
                      <button onClick={() => setDeleteId(null)}>Annuler</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!visible.length && (
              <p className="muted-text">Aucun match dans cette sélection.</p>
            )}
            <div className="pagination">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </button>
              <span>
                Page {page + 1} / {Math.max(1, Math.ceil(visible.length / 20))}
              </span>
              <button
                disabled={(page + 1) * 20 >= visible.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </button>
            </div>
          </fieldset>
        </section>
      )}
      {["teams", "competitions", "seasons"].includes(tab) && (
        <CatalogManager
          key={tab}
          kind={tab}
          dataset={dataset}
          reload={reload}
        />
      )}
      {tab === "imports" && (
        <MatchImport
          dataset={dataset}
          reload={reload}
          onBusyChange={setImportBusy}
        />
      )}
      {tab === "tools" && (
        <DataTools
          dataset={dataset}
          reload={reload}
          onImport={() => setTab("imports")}
        />
      )}
      {tab === "audit" && (
        <section className="admin-panel">
          <h2>Journal des modifications</h2>
          <p className="muted-text">
            Journal produit par la base : il ne peut pas être modifié ou effacé
            depuis le navigateur.
          </p>
          {audit.slice(page * 20, (page + 1) * 20).map((row) => (
            <details className="audit-entry" key={row.id}>
              <summary>
                {new Date(row.occurred_at).toLocaleString("fr-FR")} ·{" "}
                {row.entity} · {row.operation}
              </summary>
              <pre>
                {JSON.stringify(
                  { avant: row.old_data, après: row.new_data },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
          {!audit.length && (
            <p className="muted-text">Aucune modification enregistrée.</p>
          )}
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Précédent
            </button>
            <span>Page {page + 1}</span>
            <button
              disabled={(page + 1) * 20 >= audit.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
export default function Admin() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <div className="container state-panel" role="status">
        Vérification de la session privée…
      </div>
    );
  return auth.admin ? (
    <Dashboard />
  ) : (
    <div className="container page-content">
      <Login />
    </div>
  );
}
