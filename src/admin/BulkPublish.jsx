import { useRef, useState } from "react";
import {
  planDraftPublication,
  executeDraftPublication,
} from "../domain/bulkPublish";
import { publishDraft } from "../services/manualRepository";
import { downloadCSV } from "../domain/csv";
import { Notice } from "../components/FootballUI";

export default function BulkPublish({ dataset, reload, onBusyChange }) {
  const [plan, setPlan] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState(null),
    [progress, setProgress] = useState(null),
    [error, setError] = useState("");
  const lock = useRef(false);
  const count =
    dataset.matches.filter((m) => !m.is_published).length +
    (dataset.simplified || []).filter((m) => !m.is_published && !m.converted_at)
      .length;
  const ready = plan?.filter((p) => !p.errors.length).length || 0;
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setReport(null);
    setConfirmed(false);
    setProgress(null);
    try {
      const fresh = await reload();
      if (!fresh) throw new Error("Impossible de recharger les brouillons.");
      setPlan(planDraftPublication(fresh));
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function publish() {
    if (lock.current || !confirmed || !ready || report) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await executeDraftPublication(plan, {
        publish: publishDraft,
        onProgress: setProgress,
      });
      setReport(result);
      await reload();
    } catch (e) {
      setError(
        "Publication interrompue : rechargez et vérifiez les statuts avant de réessayer. " +
          e.message,
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <div className="bulk-publish-panel">
      <button
        className="button button-primary"
        disabled={busy || (!count && !report)}
        onClick={preview}
      >
        Publier tous les brouillons ({count})
      </button>
      {plan && (
        <>
          <Notice>
            {ready} brouillons publiables sur {plan.length}. Cette action
            concerne tous les brouillons, même ceux hors de la page ou du filtre
            actuel. Les scores, statistiques et sources sont conservés. La date
            de vérification des matchs sera enregistrée au moment de cette
            validation.
          </Notice>
          <div className="table-scroll season-catalog-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Rencontre</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={`${p.table}:${p.id}`}>
                    <td>{p.label}</td>
                    <td>{new Date(p.date).toLocaleDateString("fr-FR")}</td>
                    <td>
                      {/^https:\/\//i.test(p.source || "") ? (
                        <a
                          href={p.source}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Voir la source
                        </a>
                      ) : (
                        p.source || "Source manquante"
                      )}
                    </td>
                    <td>
                      {p.errors.length ? p.errors.join(" ") : "Prêt à publier"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                J’ai vérifié les résultats et les sources des matchs à publier.
              </label>
              <button
                className="button button-primary"
                disabled={busy || !confirmed || !ready}
                onClick={publish}
              >
                {busy
                  ? "Publication…"
                  : `Confirmer la publication des ${ready} brouillons`}
              </button>
            </>
          )}
          {progress && busy && (
            <p role="status">
              {progress.processed} / {progress.total} traités ·{" "}
              {progress.published} publiés.
            </p>
          )}
          {report && (
            <>
              <p role="status">
                {report.published} publiés · {report.blocked} bloqués ·{" "}
                {report.stale} modifiés ou déjà publiés · {report.failed} échecs
                · {report.uncertain} à vérifier · {report.remaining} non
                traités.
              </p>
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadCSV(
                    "calcito-bilan-publication.csv",
                    report.rows.map((r) => ({
                      id: r.id,
                      rencontre: r.label,
                      etat: r.outcome,
                    })),
                  )
                }
              >
                Télécharger le bilan
              </button>
              <p className="muted-text">
                Les brouillons bloqués restent privés. Pour une publication
                incertaine, rechargez et contrôlez le statut avant de relancer
                l’aperçu.
              </p>
            </>
          )}
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
