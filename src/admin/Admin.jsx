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
import CatalogManager from "./CatalogManager";
import DataTools from "./DataTools";

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
  ["matches", "Matchs & brouillons"],
  ["teams", "Équipes"],
  ["competitions", "Compétitions"],
  ["seasons", "Saisons & participants"],
  ["tools", "Import / Export"],
  ["audit", "Journal"],
];
function Dashboard() {
  const auth = useAuth();
  const [dataset, setDataset] = useState(null),
    [error, setError] = useState(null),
    [tab, setTab] = useState("dashboard"),
    [editing, setEditing] = useState(null),
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
        ? "Match enregistré. Prêt pour le suivant."
        : "Match enregistré dans la base.",
    );
    if (!next && result) setEditing(result.matches.find((m) => m.id === id));
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
  const visible = enriched.filter(
    (match) =>
      filter === "all" ||
      (filter === "draft" && !match.is_published) ||
      (filter === "published" && match.is_published) ||
      (filter === "incomplete" && completeness(match).percent < 100),
  );
  return (
    <section className="container page-content admin-page">
      <div className="admin-title">
        <PageHeading
          label="PRIVATE CONTROL ROOM"
          title="Administration"
          description="La saisie du week-end et des coupes, dans un seul espace privé. Un match saisi met à jour ses deux équipes."
        />
        <button className="button button-secondary" onClick={auth.signOut}>
          <LogOut size={15} /> Déconnexion
        </button>
      </div>
      <nav className="admin-tabs" aria-label="Administration">
        {tabs.map(([key, label]) => (
          <button
            key={key}
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
                dataset.matches.filter((m) => m.is_published).length,
                "Matchs publiés",
              ],
              [
                dataset.matches.filter((m) => !m.is_published).length,
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
                setEditing(null);
                setTab("entry");
              }}
            >
              <Plus size={16} />
              Saisir un match
            </button>
          </section>
          <Notice>
            Les classements restent partiels jusqu’à confirmation des règles, de
            la couverture et des données. La formule Calcito et le modèle de
            pronostics ne sont pas encore fournis.
          </Notice>
        </>
      )}
      {tab === "entry" && (
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
      {tab === "matches" && (
        <section className="admin-panel">
          <div className="panel-heading">
            <h2>Matchs & brouillons</h2>
            <button
              className="button button-primary"
              onClick={() => {
                setEditing(null);
                setTab("entry");
              }}
            >
              <Plus size={15} />
              Ajouter
            </button>
          </div>
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
              <option value="incomplete">Statistiques manquantes</option>
            </select>
          </div>
          <div className="admin-match-list">
            {visible.slice(page * 20, (page + 1) * 20).map((match) => (
              <article key={match.id}>
                <div>
                  <span className="eyebrow">
                    {
                      dataset.competitions.find(
                        (c) =>
                          c.id ===
                          dataset.seasons.find((s) => s.id === match.season_id)
                            ?.competition_id,
                      )?.name
                    }{" "}
                    · {match.round}
                  </span>
                  <h3>
                    {
                      dataset.teams.find((t) => t.id === match.home_team_id)
                        ?.name
                    }{" "}
                    <span>
                      {match.goals_home ?? "—"} – {match.goals_away ?? "—"}
                    </span>{" "}
                    {
                      dataset.teams.find((t) => t.id === match.away_team_id)
                        ?.name
                    }
                  </h3>
                  <p>
                    {new Date(match.kickoff).toLocaleString("fr-FR")} ·{" "}
                    {match.is_published ? "Publié" : "Brouillon privé"} ·
                    Complétude {completeness(match).percent} %
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    aria-label="Modifier le match"
                    onClick={() => {
                      setEditing(match);
                      setTab("entry");
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  {match.is_published && (
                    <button
                      aria-label="Dépublier le match"
                      onClick={() =>
                        action(
                          () =>
                            mutate(
                              "matches",
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
                          await mutate("matches", "delete", null, match.id);
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
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
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
      {tab === "tools" && <DataTools dataset={dataset} reload={reload} />}
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
