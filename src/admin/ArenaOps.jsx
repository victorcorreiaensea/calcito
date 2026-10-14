import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  arenaStatus,
  arenaCalibrate,
  arenaCorrectVoid,
  arenaAdminLog,
} from "../services/arenaRepository";
import { Notice } from "../components/FootballUI";

export default function ArenaOps({ dataset, onPrepare }) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [match, setMatch] = useState(""),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false),
    [log, setLog] = useState([]);
  async function reload() {
    try {
      setStatus(await arenaStatus());
      setLog(await arenaAdminLog());
    } catch (e) {
      if (["PGRST202", "42P01", "PGRST205"].includes(e.code))
        setStatus({ installed: false });
      else setMessage(e.message);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  async function action(callback) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await callback();
      setMessage(
        r.recomputed != null
          ? `${r.recomputed} ticket(s) recalculé(s).`
          : r.enabled
            ? "Modèle validé : seules les cotes autorisées par le contrôle historique seront proposées."
            : `Cotes désactivées. ${r.reason}`,
      );
      setConfirm(false);
      await reload();
    } catch (e) {
      setMessage(
        `Opération non confirmée : ${e.message}. Recharge l’état avant de relancer.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel arena-ops">
      <span className="eyebrow">ARÈNE · CONTRÔLE SERVEUR</span>
      <h2>Calendrier, cotes et règlements.</h2>
      <p className="muted-text">
        Les résultats officiels règlent les tickets dans la même transaction. La
        forme V4 et ses courbes se recalculent à partir des données actualisées.
      </p>
      <button
        className="button button-secondary"
        onClick={onPrepare}
        disabled={busy}
      >
        Préparer une journée
      </button>
      <Link className="button button-secondary" to="/arene">
        Voir l’Arène
      </Link>
      <button
        className="button button-secondary"
        onClick={reload}
        disabled={busy}
      >
        Recharger l’état
      </button>
      {status?.installed === false ? (
        <Notice>
          Installe la migration 003 une seule fois dans le SQL Editor de
          Supabase.{" "}
          <a
            className="text-link"
            href={`${import.meta.env.BASE_URL}downloads/calcito-v5-arene.sql`}
            download
          >
            Télécharger le script SQL
          </a>{" "}
          Aucun portefeuille n’est simulé.
        </Notice>
      ) : (
        status && (
          <>
            <h3>Validation du modèle probabiliste</h3>
            <output>
              État : {status.enabled ? "validé" : "cotes désactivées"} ·{" "}
              {status.version}
              <br />
              {status.model?.reason}
              <br />
              {status.model?.training ?? "—"} rencontres d’apprentissage /{" "}
              {status.model?.validation ?? "—"} de contrôle · dernière exécution
              :{" "}
              {status.trainedAt
                ? new Date(status.trainedAt).toLocaleString("fr-FR")
                : "aucune"}
            </output>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => action(arenaCalibrate)}
            >
              {busy
                ? "Traitement serveur…"
                : "Tester et calibrer sur l’historique"}
            </button>
            <p className="form-footnote">
              Minimum 100 rencontres exploitables pour apprendre et 60 pour
              contrôler, sans résultats futurs. Les scores de contrôle doivent
              battre la référence. Une modification de résultat suspend les
              nouvelles cotes jusqu’au prochain contrôle ; les tickets déjà
              figés restent valides.
            </p>
            <h3>Correction d’une annulation erronée</h3>
            <p className="muted-text">
              Les corrections de scores passent par « Matchs & brouillons ». Un
              report ou une annulation neutralise définitivement la sélection.
              Ce formulaire permet au propriétaire de réexaminer une
              neutralisation faite par erreur, avec justification enregistrée.
            </p>
            <div className="admin-grid">
              <label className="admin-field">
                Rencontre concernée
                <select
                  value={match}
                  onChange={(e) => setMatch(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Choisir une rencontre</option>
                  {dataset.matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      {dataset.teams.find((t) => t.id === m.home_team_id)?.name}{" "}
                      —{" "}
                      {dataset.teams.find((t) => t.id === m.away_team_id)?.name}{" "}
                      · {m.round}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                Justification de la correction
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  minLength={10}
                  placeholder="Au moins 10 caractères"
                />
              </label>
            </div>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                disabled={busy}
              />
              J’ai vérifié la rencontre et souhaite recalculer ses tickets
              neutralisés.
            </label>
            <button
              className="button button-secondary"
              disabled={busy || !match || reason.trim().length < 10 || !confirm}
              onClick={() =>
                action(() => arenaCorrectVoid(match, reason.trim()))
              }
            >
              Appliquer la correction auditée
            </button>
            <h3>Journal des neutralisations corrigées</h3>
            {log.length ? (
              log.map((row) => (
                <p key={row.id} className="muted-text">
                  {new Date(row.created_at).toLocaleString("fr-FR")} ·{" "}
                  {row.reason}
                </p>
              ))
            ) : (
              <p className="muted-text">
                Aucune correction de neutralisation enregistrée. Les corrections
                de scores figurent aussi dans l’onglet Journal.
              </p>
            )}
          </>
        )
      )}
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
    </section>
  );
}
