import { useEffect, useMemo, useState, useRef } from "react";
import {
  resolveCatalog,
  prepareSeasonCatalog,
  mappedSeasonRows,
} from "../domain/seasonSetup";
import { downloadCSV } from "../domain/csv";
import { matchImportHeaders } from "../domain/matchImport";
import {
  getDataset,
  invalidateManualData,
  mutate,
  requireOwner,
} from "../services/manualRepository";
import { Notice } from "../components/FootballUI";

export default function SeasonSetup({
  dataset,
  reload,
  onReady,
  onBusyChange,
  disabled,
}) {
  const [bundle, setBundle] = useState(null),
    [error, setError] = useState(""),
    [choices, setChoices] = useState({}),
    [confirmed, setConfirmed] = useState(false),
    [published, setPublished] = useState(true),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [result, setResult] = useState(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/season-2026-2027.json`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error("Le relevé est indisponible.");
        return r.json();
      })
      .then(setBundle)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const plan = useMemo(
    () => (bundle ? resolveCatalog(bundle.clubs, dataset, choices) : []),
    [bundle, dataset, choices],
  );
  const errors = plan.filter((p) => p.error).length;
  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setResult(null);
    try {
      await requireOwner();
      invalidateManualData();
      const fresh = await getDataset();
      const prepared = await prepareSeasonCatalog(bundle, fresh, {
        choices,
        published,
        mutate,
        onProgress: setProgress,
      });
      setResult(prepared);
      await reload();
    } catch (e) {
      setError(
        "Préparation interrompue : certaines fiches peuvent déjà être enregistrées. Rechargez le catalogue avant de réessayer. " +
          e.message,
      );
      await reload().catch(() => {});
    } finally {
      setBusy(false);
      onBusyChange(false);
      lock.current = false;
    }
  }
  return (
    <details className="admin-extra">
      <summary>Préparer les six championnats 2026–2027</summary>
      <p className="muted-text">
        Catalogue vérifié contre les fiches publiées de Calcito, puis contrôlé
        dans votre session privée. Les fiches existantes, écussons et
        corrections de points sont conservés.
      </p>
      {bundle && (
        <>
          <Notice>
            Relevé partiel : {bundle.rows.length} résultats, complétés par des
            fiches de matchs datées d’octobre. Les statistiques avancées restent
            inconnues. La préparation crée les fiches et participants, puis
            ouvre l’aperçu des matchs sans les importer automatiquement.
          </Notice>
          {bundle.conflicts?.length > 0 && (
            <Notice>
              {bundle.conflicts.length} rencontres exclues : les sources donnent
              des dates différentes. Les matchs existants sont conservés sans
              correction automatique.
              <a
                href={`${import.meta.env.BASE_URL}downloads/calcito_dates_a_verifier.csv`}
                download
              >
                {" "}
                Télécharger la liste à vérifier
              </a>
            </Notice>
          )}
          <div className="table-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Championnat</th>
                  <th>Clubs</th>
                  <th>Résultats disponibles</th>
                  <th>Scores non renseignés</th>
                </tr>
              </thead>
              <tbody>
                {bundle.report.map((r) => (
                  <tr key={r.slug}>
                    <td>{r.name}</td>
                    <td>{r.teams}</td>
                    <td>{r.results}</td>
                    <td>{r.missingScores}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset disabled={disabled || busy}>
            <div className="table-scroll season-catalog-scroll">
              <table className="official-table">
                <thead>
                  <tr>
                    <th>Club de la source</th>
                    <th>Correspondance Calcito</th>
                    <th>Écusson</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(({ club, existing, error, action }) => (
                    <tr key={club.sourceName}>
                      <td>
                        {club.sourceName}
                        <small className="muted-text">
                          {" "}
                          · {club.leagueName}
                        </small>
                      </td>
                      <td>
                        <select
                          aria-label={`Correspondance ${club.sourceName}`}
                          value={
                            choices[club.sourceName] ||
                            existing?.id ||
                            (club.allowCreate ? "new" : "")
                          }
                          onChange={(e) => {
                            setChoices((c) => ({
                              ...c,
                              [club.sourceName]: e.target.value,
                            }));
                            setConfirmed(false);
                            setResult(null);
                          }}
                        >
                          <option value="">À associer</option>
                          {club.allowCreate && (
                            <option value="new">Créer : {club.name}</option>
                          )}
                          {dataset.teams
                            .filter((t) => t.country === club.country)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                        <small className={error ? "field-error" : "muted-text"}>
                          {error ||
                            (action === "reuse"
                              ? "Fiche conservée"
                              : "Nouvelle fiche proposée")}
                        </small>
                      </td>
                      <td>
                        {existing?.logo_url || club.logo_url ? (
                          <img
                            src={existing?.logo_url || club.logo_url}
                            alt={`Écusson ${club.name}`}
                            width="32"
                            height="40"
                            loading="lazy"
                            style={{ objectFit: "contain" }}
                          />
                        ) : (
                          "Non renseigné"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Publier les nouvelles fiches et les championnats/saisons préparés.
              Les fiches d’équipes existantes gardent leur statut.
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              J’ai vérifié les correspondances, les participants et les écussons
              proposés.
            </label>
            <button
              className="button button-primary"
              disabled={!confirmed || errors > 0 || !!result}
              onClick={prepare}
            >
              {busy ? "Préparation…" : "Préparer les fiches et participants"}
            </button>
          </fieldset>
          {progress && (
            <p role="status">
              {progress.processed} / {progress.total} clubs traités ·{" "}
              {progress.teams} créés · {progress.members} participants ajoutés.
            </p>
          )}
          {result && (
            <>
              <p role="status">
                Catalogue préparé. {result.report.teams} nouvelles équipes,{" "}
                {result.report.seasons} saisons. Aucun match importé à cette
                étape.
              </p>
              <button
                className="button button-primary"
                disabled={disabled || busy}
                onClick={() =>
                  onReady(
                    mappedSeasonRows(bundle, result.mapping, { ids: true }),
                  )
                }
              >
                Prévisualiser les {bundle.rows.length} résultats
              </button>{" "}
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadCSV(
                    "calcito_resultats_2026_2027.csv",
                    mappedSeasonRows(bundle, result.mapping),
                    matchImportHeaders,
                  )
                }
              >
                Télécharger le CSV avec les noms exacts
              </button>{" "}
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadCSV(
                    "calcito_correspondance_interne.csv",
                    bundle.clubs.map((c) => ({
                      source_name: c.sourceName,
                      official_name: c.officialName,
                      calcito_name: result.mapping[c.sourceName].name,
                      internal_id: result.mapping[c.sourceName].id,
                      competition_id:
                        result.mapping[c.sourceName].competitionId,
                      season_id: result.mapping[c.sourceName].seasonId,
                    })),
                  )
                }
              >
                Télécharger les correspondances
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
