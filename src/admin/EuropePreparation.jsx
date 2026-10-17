import { useEffect, useRef, useState } from "react";
import { TeamBadge, Notice } from "../components/FootballUI";
import {
  matchPayload,
  completeness,
  statFields,
  validateMatch,
} from "../domain/match";
import {
  europeanCompetitions,
  europeanRound,
  europeHeaders,
  readEuropeanCSV,
  planEuropeanPreparation,
  europeanMatchForm,
  publicationErrors,
} from "../domain/europePreparation";
import {
  europePreparationStatus,
  prepareEuropeanDrafts,
} from "../services/europeRepository";
import { saveMatch } from "../services/manualRepository";
export default function EuropePreparation({
  dataset,
  reload,
  onBusyChange,
  onEdit,
}) {
  const [competition, setCompetition] = useState("champions-league"),
    [round, setRound] = useState("1"),
    [text, setText] = useState(""),
    [choices, setChoices] = useState({}),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [plan, setPlan] = useState(null),
    [aliases, setAliases] = useState({}),
    [status, setStatus] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [publishReview, setPublishReview] = useState(null),
    [publishConfirmed, setPublishConfirmed] = useState(false),
    [pending, setPending] = useState(null),
    [dirtyIds, setDirtyIds] = useState(new Set());
  const lock = useRef(false),
    batch = useRef(null);
  useEffect(() => {
    let alive = true;
    europePreparationStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch((e) => {
        if (alive)
          setStatus({
            installed: false,
            reason: ["PGRST202", "42P01"].includes(e.code)
              ? "Installation SQL requise."
              : "Connexion au module impossible.",
          });
      });
    fetch(`${import.meta.env.BASE_URL}data/season-2026-2027.json`)
      .then((r) => r.json())
      .then((b) => {
        if (alive)
          setAliases(
            Object.fromEntries(b.clubs.map((c) => [c.sourceName, c.name])),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const season = dataset.seasons.find(
    (s) =>
      s.start_year === 2026 &&
      dataset.competitions.find((c) => c.id === s.competition_id)?.slug ===
        competition,
  );
  const selected = dataset.matches
    .filter(
      (m) =>
        m.season_id === season?.id &&
        /phase de ligue/i.test(m.round) &&
        europeanRound(m.round.replace(/.*journ[eé]e\s*/i, "")) === round,
    )
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  function reset() {
    setPlan(null);
    setReviewed(false);
    batch.current = null;
    setPending(null);
  }
  async function preview() {
    if (lock.current) return;
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    try {
      const fresh = await reload();
      if (!fresh) throw Error("Rechargement impossible.");
      const next = planEuropeanPreparation(readEuropeanCSV(text), fresh, {
        choices,
        aliases,
        flashscoreConsent: consent,
      });
      setPlan(next);
      setReviewed(false);
      batch.current = null;
      setPending(null);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function importDrafts() {
    if (
      lock.current ||
      !reviewed ||
      !plan ||
      plan.errors.length ||
      plan.rows.some((r) => r.errors.length) ||
      status?.installed !== true
    )
      return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      if (!batch.current)
        batch.current = {
          nonce: crypto.randomUUID(),
          payload: {
            reviewed: true,
            clubs: plan.clubs,
            matches: plan.rows.map((r) => r.payload),
          },
        };
      const result = await prepareEuropeanDrafts(
        batch.current.payload,
        batch.current.nonce,
      );
      setMessage(
        `Serveur : ${result.drafts} nouveaux brouillons, ${result.existing} rencontres conservées, ${result.newClubs} nouvelles fiches. Aucun match publié.`,
      );
      setPending(null);
      setPlan(null);
      batch.current = null;
      await reload();
    } catch (e) {
      setPending(batch.current);
      setMessage(
        `Import interrompu : ${e.message}. La reprise réutilise la même demande, sans doublon.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  function markDirty(id, dirty) {
    setDirtyIds((previous) => {
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
    setPublishReview(null);
    setPublishConfirmed(false);
  }
  async function preparePublish() {
    if (dirtyIds.size) return;
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    try {
      const fresh = await reload();
      if (!fresh) throw Error("Rechargement impossible.");
      const rows = selected
        .filter((m) => !m.is_published)
        .map((m) => fresh.matches.find((r) => r.id === m.id))
        .filter(Boolean)
        .map((m) => ({
          form: europeanMatchForm(m, fresh),
          errors: publicationErrors(europeanMatchForm(m, fresh), fresh),
        }));
      setPublishReview(rows);
      setPublishConfirmed(false);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function publishDay() {
    if (
      lock.current ||
      dirtyIds.size > 0 ||
      !publishConfirmed ||
      !publishReview?.length ||
      publishReview.some((r) => r.errors.length)
    )
      return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    let count = 0;
    try {
      for (const row of publishReview) {
        const payload = matchPayload(
          {
            ...row.form,
            expected_updated_at: row.form.updated_at,
            verified_at: new Date().toISOString(),
          },
          true,
        );
        await saveMatch(payload);
        count++;
      }
      setMessage(
        `${count} rencontres publiées après votre validation explicite.`,
      );
      setPublishReview(null);
      await reload();
    } catch (e) {
      setMessage(
        `${count} publications confirmées. Dernière demande à vérifier : publication interrompue : ${e.message}. Rechargez les statuts avant une nouvelle validation.`,
      );
      setPublishReview(null);
      await reload();
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="europe-preparation">
      <span className="eyebrow">L’EUROPE, À VOTRE RYTHME</span>
      <h2>Préparation des compétitions européennes</h2>
      <Notice>
        Objectif indicatif : 18 rencontres par journée, 72 au total pour les
        journées 1 et 2 des deux compétitions. Le nombre officiel et les
        participants restent à vérifier. Aucun résultat ni calendrier n’est
        préchargé sans source vérifiée. Les brouillons restent privés et exclus
        des calculs.
      </Notice>
      <div className="filter-bar">
        <label className="admin-field">
          Compétition
          <select
            value={competition}
            disabled={busy || dirtyIds.size > 0}
            onChange={(e) => {
              setCompetition(e.target.value);
              setPublishReview(null);
            }}
          >
            {europeanCompetitions.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          Saison
          <select value="2026-2027" onChange={() => {}}>
            <option>2026-2027</option>
          </select>
        </label>
        <label className="admin-field">
          Journée
          <select
            aria-label="Journée"
            value={round}
            disabled={busy || dirtyIds.size > 0}
            onChange={(e) => {
              setRound(e.target.value);
              setPublishReview(null);
            }}
          >
            <option value="1">Journée 1</option>
            <option value="2">Journée 2</option>
          </select>
        </label>
      </div>
      {dataset.matches
        .filter(
          (m) =>
            m.season_id === season?.id &&
            !/phase de ligue/i.test(m.round) &&
            europeanRound(m.round) === round,
        )
        .map((m) => (
          <p className="info-notice" key={m.id}>
            Rencontre existante à classifier avant de l’inclure dans la phase de
            ligue : {dataset.teams.find((t) => t.id === m.home_team_id)?.name} —{" "}
            {dataset.teams.find((t) => t.id === m.away_team_id)?.name}.{" "}
            <button
              className="text-link"
              disabled={busy}
              onClick={() => onEdit(m)}
            >
              Vérifier la fiche existante
            </button>
          </p>
        ))}
      <p className="result-count">
        {selected.length} rencontres enregistrées pour cette journée ·{" "}
        {selected.filter((m) => !m.is_published).length} brouillons ·{" "}
        {selected.filter((m) => m.is_published).length} publiées.
      </p>
      {status?.installed === false && (
        <Notice>
          {status.reason}{" "}
          <a
            href={`${import.meta.env.BASE_URL}downloads/calcito-preparation-europe.sql`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ouvrir le SQL d’installation
          </a>
          . L’aperçu fonctionne sans installation ; import et enregistrement
          restent désactivés pour protéger les données publiques.
        </Notice>
      )}
      <details className="analysis-panel" open={!selected.length}>
        <summary>Prévisualiser un relevé vérifié avant importation</summary>
        <p className="muted-text">
          Un seul CSV peut contenir les quatre journées. Les lignes vides du
          modèle ne sont pas des rencontres et ne seront jamais enregistrées.
          Date et heure : ISO avec fuseau ou heure locale avec la colonne
          timezone. Phase : league-phase. Aucun identifiant ni écusson n’est
          deviné.
        </p>
        <a
          className="text-link"
          href={`${import.meta.env.BASE_URL}downloads/calcito-europe-modele.csv`}
          download
        >
          Télécharger le modèle CSV →
        </a>
        <label className="admin-field">
          Charger un CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy || Boolean(pending)}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                setMessage("Fichier limité à 2 Mo.");
                return;
              }
              reset();
              setText(await file.text());
            }}
          />
        </label>
        <label className="admin-field">
          Relevé CSV
          <textarea
            rows="7"
            value={text}
            disabled={busy || Boolean(pending)}
            onChange={(e) => {
              reset();
              setText(e.target.value);
            }}
            placeholder={europeHeaders.join(";")}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || Boolean(pending)}
            onChange={(e) => {
              reset();
              setConsent(e.target.checked);
            }}
          />
          Je dispose des droits nécessaires pour utiliser et publier ce relevé
          Flashscore.
        </label>
        <button
          className="button button-secondary"
          disabled={busy || !text || Boolean(pending)}
          onClick={preview}
        >
          Prévisualiser sans enregistrer
        </button>
        {plan && (
          <>
            <div className="europe-summary">
              {Object.entries({
                "Rencontres trouvées": plan.summary.found,
                "Scores renseignés à vérifier": plan.summary.verified,
                "Déjà enregistrées": plan.summary.existing,
                "Nouveaux brouillons prêts": plan.summary.drafts,
                "Fiches connues": plan.summary.knownClubs,
                "Nouvelles fiches": plan.summary.newClubs,
                "Logos sourcés à contrôler": plan.summary.logos,
              }).map(([label, n]) => (
                <div key={label}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {plan.errors.map((error) => (
              <p className="field-error" key={error}>
                {error}
              </p>
            ))}
            <div className="europe-club-mapping">
              {plan.clubs.map((club) => (
                <label className="admin-field" key={club.key}>
                  Associer {club.name}
                  <select
                    value={choices[club.key] || club.existing_id || ""}
                    disabled={busy || Boolean(pending)}
                    onChange={(e) => {
                      setChoices({ ...choices, [club.key]: e.target.value });
                      setReviewed(false);
                      setPlan(null);
                    }}
                  >
                    <option value="">
                      Nouvelle fiche (identité sourcée requise)
                    </option>
                    {dataset.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.country}
                      </option>
                    ))}
                  </select>
                  <small>
                    {club.existing_id
                      ? "Identifiant et écusson existants conservés."
                      : club.logo_url
                        ? "Vérifier le logo et son origine."
                        : "Visuel de remplacement neutre ; aucun logo deviné."}
                  </small>
                </label>
              ))}
            </div>
            <div className="table-scroll">
              <table className="official-table">
                <thead>
                  <tr>
                    <th>Compétition / Journée</th>
                    <th>Rencontre</th>
                    <th>Date UTC</th>
                    <th>Scores</th>
                    <th>Contrôle</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.index}>
                      <td>
                        {r.payload.competition} · J{r.payload.round}
                      </td>
                      <td>
                        {r.raw.home_team} — {r.raw.away_team}
                      </td>
                      <td>{r.payload.kickoff || "—"}</td>
                      <td>
                        {r.payload.goals_home ?? "—"} –{" "}
                        {r.payload.goals_away ?? "—"}
                      </td>
                      <td>
                        {r.errors.join(" ") ||
                          (r.existing
                            ? "Existe déjà : préservée"
                            : "Brouillon à créer")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              J’ai vérifié la phase, les participants, les dates, les scores et
              les sources. Créer uniquement des brouillons ; les nouvelles
              fiches clubs seront visibles sans indice fictif.
            </label>
            <button
              className="button button-primary"
              disabled={
                busy ||
                !reviewed ||
                status?.installed !== true ||
                plan.errors.length > 0 ||
                plan.rows.some((r) => r.errors.length)
              }
              onClick={importDrafts}
            >
              {busy
                ? "Enregistrement…"
                : pending
                  ? "Reprendre la même importation"
                  : "Créer les brouillons vérifiés"}
            </button>
          </>
        )}
      </details>
      <div className="europe-draft-list">
        {selected.map((match) => (
          <EuropeanDraft
            key={`${match.id}:${match.updated_at}`}
            match={match}
            dataset={dataset}
            reload={reload}
            enabled={status?.installed === true}
            parentBusy={busy}
            onDirty={markDirty}
            onMessage={setMessage}
            onBusyChange={(value) => {
              setBusy(value);
              onBusyChange(value);
            }}
          />
        ))}
      </div>
      {!selected.length && (
        <div className="analysis-panel">
          <h3>Cette journée attend son relevé vérifié.</h3>
          <p>
            18 rencontres sont attendues selon le format à 36 clubs. Aucun
            emplacement vide n’est présenté comme un match officiel. Vous pouvez
            préparer le fichier ci-dessus puis contrôler l’aperçu.
          </p>
        </div>
      )}
      {dirtyIds.size > 0 && (
        <p role="status" className="info-notice">
          {dirtyIds.size} rencontre(s) avec des modifications non enregistrées.
          Enregistrez ou annulez ces changements avant de valider la journée.
        </p>
      )}
      <p className="muted-text">
        Enregistrez les brouillons avant de valider une journée : seule leur
        version enregistrée sera publiée.
      </p>
      <button
        className="button button-secondary"
        onClick={preparePublish}
        disabled={
          busy ||
          dirtyIds.size > 0 ||
          !selected.some((m) => !m.is_published) ||
          status?.installed !== true
        }
      >
        Préparer la validation de cette journée
      </button>
      {publishReview && (
        <div className="analysis-panel">
          <h3>Validation explicite de la journée</h3>
          {publishReview.map((row) => (
            <p key={row.form.id}>
              {dataset.teams.find((t) => t.id === row.form.home_team_id)?.name}{" "}
              —{" "}
              {dataset.teams.find((t) => t.id === row.form.away_team_id)?.name}{" "}
              : {row.form.goals_home ?? "—"} – {row.form.goals_away ?? "—"} ·{" "}
              {new Date(row.form.kickoff).toLocaleString("fr-FR")} ·{" "}
              {row.form.status} · Source : {row.form.source || "Manquante"}.{" "}
              {row.errors.join(" ") ||
                "Résultat prêt, statistiques facultatives."}
            </p>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={publishConfirmed}
              onChange={(e) => setPublishConfirmed(e.target.checked)}
            />
            Je confirme la publication de cette journée et son intégration aux
            indices et règlements des pronostics concernés.
          </label>
          <button
            className="button button-primary"
            disabled={
              busy ||
              !publishConfirmed ||
              !publishReview.length ||
              publishReview.some((r) => r.errors.length)
            }
            onClick={publishDay}
          >
            Publier les {publishReview.length} rencontres de la journée
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="info-notice">
          {message}
        </p>
      )}
    </section>
  );
}
function EuropeanDraft({
  match,
  dataset,
  reload,
  enabled,
  parentBusy,
  onBusyChange,
  onMessage,
  onDirty,
}) {
  const [form, setForm] = useState(() => europeanMatchForm(match, dataset)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);
  const home = dataset.teams.find((t) => t.id === match.home_team_id),
    away = dataset.teams.find((t) => t.id === match.away_team_id);
  const complete = completeness(form);
  async function save(published) {
    if (
      lock.current ||
      match.is_published ||
      !enabled ||
      (published && !confirmed)
    )
      return;
    const errors = published
      ? publicationErrors(form, dataset)
      : Object.values(validateMatch(form, false));
    if (errors.length) {
      setMessage(errors.join(" "));
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      await saveMatch(
        matchPayload(
          {
            ...form,
            expected_updated_at: match.updated_at,
            ...(published ? { verified_at: new Date().toISOString() } : {}),
          },
          published,
        ),
      );
      setMessage(
        published
          ? "Rencontre publiée après validation."
          : "Brouillon enregistré. Aucune publication.",
      );
      onDirty(match.id, false);
      onMessage(
        published
          ? "Rencontre publiée après votre validation."
          : "Brouillon enregistré : aucune publication ni modification d’indice.",
      );
      await reload();
    } catch (e) {
      setMessage(
        `Enregistrement non confirmé : ${e.message}. Rechargez avant de réessayer.`,
      );
    } finally {
      setBusy(false);
      lock.current = false;
      onBusyChange(false);
    }
  }
  function set(key, value) {
    onDirty(match.id, true);
    setForm({ ...form, [key]: value });
    setConfirmed(false);
  }
  return (
    <article className="analysis-panel european-draft">
      <header>
        <TeamBadge team={{ ...home, logo: home.logo_url }} small />
        <h3>
          {home.name} — {away.name}
        </h3>
        <TeamBadge team={{ ...away, logo: away.logo_url }} small />
      </header>
      <p className="status-pill">
        {match.is_published
          ? "Publié · lecture seule"
          : "BROUILLON — NON PUBLIÉ"}{" "}
        · {complete.percent} % des champs renseignés
      </p>
      <fieldset disabled={busy || parentBusy || match.is_published || !enabled}>
        <legend className="sr-only">
          Données de {home.name} contre {away.name}
        </legend>
        <div className="europe-score-inputs">
          <label className="admin-field">
            Buts domicile
            <input
              type="number"
              min="0"
              step="1"
              value={form.goals_home ?? ""}
              onChange={(e) => set("goals_home", e.target.value)}
            />
          </label>
          <label className="admin-field">
            Buts extérieur
            <input
              type="number"
              min="0"
              step="1"
              value={form.goals_away ?? ""}
              onChange={(e) => set("goals_away", e.target.value)}
            />
          </label>
          <label className="admin-field">
            Date et heure · UTC
            <input
              type="text"
              value={form.kickoff}
              onChange={(e) => set("kickoff", e.target.value)}
            />
          </label>
          <label className="admin-field">
            Statut
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="finished">Terminé</option>
              <option value="scheduled">Programmé</option>
              <option value="postponed">Reporté</option>
              <option value="cancelled">Annulé</option>
            </select>
          </label>
        </div>
        <div className="europe-stat-inputs">
          {statFields
            .filter(([key]) =>
              [
                "shots",
                "shots_on_target",
                "big_chances",
                "team_rating",
              ].includes(key),
            )
            .flatMap(([key, label, type]) =>
              ["home", "away"].map((side) => (
                <label className="admin-field" key={`${side}-${key}`}>
                  {label} · {side === "home" ? "domicile" : "extérieur"}
                  <input
                    type="number"
                    min="0"
                    max={type === "rating" ? 10 : 32767}
                    step={type === "rating" ? "0.1" : "1"}
                    value={form[side + "_stats"][key] ?? ""}
                    onChange={(e) =>
                      set(side + "_stats", {
                        ...form[side + "_stats"],
                        [key]: e.target.value,
                      })
                    }
                  />
                </label>
              )),
            )}
        </div>
        <label className="admin-field">
          Source du résultat
          <input
            value={form.source || ""}
            onChange={(e) => set("source", e.target.value)}
          />
        </label>
        <label className="admin-field">
          Commentaires
          <textarea
            value={form.comment || ""}
            rows="2"
            onChange={(e) => set("comment", e.target.value)}
          />
        </label>
        {!match.is_published && (
          <>
            <button
              className="button button-secondary"
              onClick={() => save(false)}
            >
              Enregistrer le brouillon
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setForm(europeanMatchForm(match, dataset));
                setConfirmed(false);
                onDirty(match.id, false);
              }}
            >
              Annuler les modifications
            </button>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Résultat et source contrôlés : je souhaite publier ce match.
            </label>
            <button
              className="button button-primary"
              disabled={!confirmed}
              onClick={() => save(true)}
            >
              Valider et publier ce match
            </button>
          </>
        )}
      </fieldset>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
