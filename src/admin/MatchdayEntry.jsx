import { useEffect, useMemo, useRef, useState } from "react";
import { TeamSearch } from "./MatchForm";
import { statFields } from "../domain/match";
import {
  createMatchdaySlots,
  planMatchday,
  suggestedMatchCount,
} from "../domain/matchday";
import { executeMatchImport, isFlashscoreSource } from "../domain/matchImport";
import { saveMatch } from "../services/manualRepository";
import { useAuth } from "./AuthProvider";
import { Notice } from "../components/FootballUI";

export default function MatchdayEntry({ dataset, reload, onBusyChange }) {
  const auth = useAuth();
  const storageKey = `calcito:matchday:${auth.user.id}`;
  const [initial] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey));
      return value?.version === 1 &&
        Array.isArray(value.slots) &&
        value.slots.length <= 40
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [header, setHeader] = useState(
      initial?.header || {
        competition_id: "",
        season_id: "",
        round: "Journée 1",
        source_url: "",
        date: "",
      },
    ),
    [count, setCount] = useState(initial?.count || 9),
    [slots, setSlots] = useState(initial?.slots || []),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [report, setReport] = useState(initial?.report || null),
    [progress, setProgress] = useState(null),
    [editingHeader, setEditingHeader] = useState(
      initial?.editingHeader ?? true,
    );
  const lock = useRef(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          header,
          count,
          slots,
          report,
          editingHeader,
        }),
      );
    } catch {
      /* The form remains usable if browser storage is unavailable. */
    }
  }, [storageKey, header, count, slots, report, editingHeader]);

  const competition = dataset.competitions.find(
    (c) => c.id === header.competition_id,
  );
  const seasons = dataset.seasons.filter(
    (s) => s.competition_id === header.competition_id,
  );
  const teams = dataset.teams.filter((t) =>
    dataset.members.some(
      (m) => m.season_id === header.season_id && m.team_id === t.id,
    ),
  );
  const plan = useMemo(
    () => planMatchday(slots, header, dataset),
    [slots, header, dataset],
  );
  const ready = plan.filter(
    (p) => !p.errors.length && p.action !== "ignore",
  ).length;
  const usesFlashscore = slots.some((row) =>
    isFlashscoreSource(row.source_url || header.source_url),
  );
  const hasErrors = plan.some((p) => p.errors.length);
  function field(index, key, value) {
    setSlots((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    setMessage("");
  }
  function selectCompetition(id) {
    const c = dataset.competitions.find((c) => c.id === id);
    const s = dataset.seasons
      .filter((s) => s.competition_id === id)
      .sort((a, b) => b.start_year - a.start_year)[0];
    setHeader((h) => ({ ...h, competition_id: id, season_id: s?.id || "" }));
    setCount(suggestedMatchCount(c, s, dataset));
  }
  function create() {
    try {
      if (!header.season_id || !header.round.trim())
        throw new Error("Choisissez la saison et indiquez la journée.");
      if (teams.length < 2)
        throw new Error(
          "Inscrivez d’abord les équipes participantes à cette saison.",
        );
      setSlots(createMatchdaySlots(count, header.date));
      setEditingHeader(false);
      setReport(null);
      setMessage(
        "Grille prête : les lignes vides restent locales, seuls les matchs remplis seront enregistrés en brouillon.",
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function save() {
    if (lock.current || !ready || hasErrors || report) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    try {
      const fresh = await reload();
      if (!fresh) throw new Error("Impossible de recharger les données.");
      const checked = planMatchday(slots, header, fresh);
      if (checked.some((p) => p.errors.length))
        throw new Error(
          "Des données ont changé : contrôlez les lignes signalées avant de réessayer.",
        );
      const result = await executeMatchImport(checked, {
        save: (p) => saveMatch(p, { timeoutMs: 20000 }),
        onProgress: setProgress,
      });
      setReport(result);
      await reload();
      setMessage(
        `${result.imported} brouillons enregistrés · ${result.ignored} doublons ignorés · ${result.rejected} erreurs · ${result.uncertain} sauvegardes à vérifier.`,
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="admin-panel">
      <div className="panel-heading">
        <h2>Saisie par journée</h2>
        <span className="muted-text">Équipes → scores → brouillons</span>
      </div>
      <fieldset disabled={busy} className="admin-operation-guard">
        <fieldset disabled={!editingHeader} className="admin-operation-guard">
          <div className="admin-grid">
            <div className="admin-field">
              <label htmlFor="day-competition">Championnat ou coupe</label>
              <select
                id="day-competition"
                value={header.competition_id}
                onChange={(e) => selectCompetition(e.target.value)}
              >
                <option value="">Choisir</option>
                {dataset.competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="day-season">Saison de la journée</label>
              <select
                id="day-season"
                value={header.season_id}
                onChange={(e) => {
                  setHeader((h) => ({ ...h, season_id: e.target.value }));
                  setCount(
                    suggestedMatchCount(
                      competition,
                      dataset.seasons.find((s) => s.id === e.target.value),
                      dataset,
                    ),
                  );
                }}
              >
                <option value="">Choisir</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="day-round">Journée ou tour</label>
              <input
                id="day-round"
                value={header.round}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, round: e.target.value }))
                }
                placeholder="Journée 8 / Quart de finale aller"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="day-count">Nombre de matchs à préparer</label>
              <input
                id="day-count"
                type="number"
                min="1"
                max="40"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="day-date">
                Date commune (modifiable par match)
              </label>
              <input
                id="day-date"
                type="date"
                value={header.date}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, date: e.target.value }))
                }
              />
            </div>
          </div>
          <button className="button button-primary" onClick={create}>
            Préparer les {count} matchs
          </button>
        </fieldset>
        {slots.length > 0 && (
          <>
            <Notice>
              Les affiches ne sont pas inventées : choisissez les équipes de
              chaque rencontre. Dates et scores sont requis pour enregistrer un
              résultat. Les statistiques absentes restent inconnues. Pour une
              coupe, ajustez le nombre de matchs au tour concerné.
            </Notice>
            <div className="admin-field">
              <label htmlFor="day-source">
                Source commune (facultative en brouillon)
              </label>
              <input
                id="day-source"
                value={header.source_url}
                onChange={(e) =>
                  setHeader((h) => ({
                    ...h,
                    source_url: e.target.value,
                    flashscoreConsent: false,
                  }))
                }
                placeholder="https://…"
                disabled={!!report}
              />
            </div>
            {usesFlashscore && (
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={header.flashscoreConsent === true}
                  disabled={!!report}
                  onChange={(e) =>
                    setHeader((h) => ({
                      ...h,
                      flashscoreConsent: e.target.checked,
                    }))
                  }
                />
                Je dispose de l’autorisation de réutiliser les données
                Flashscore concernées.
              </label>
            )}
            <div className="matchday-grid">
              {slots.map((row, index) => {
                const item = plan.find((p) => p.slot === index);
                return (
                  <article className="matchday-row" key={index}>
                    <header>
                      <strong>Match {index + 1}</strong>
                      <span className="muted-text">
                        {item?.action === "ignore"
                          ? "Déjà enregistré"
                          : item?.errors.length
                            ? "À corriger"
                            : item
                              ? "Prêt"
                              : "À remplir"}
                      </span>
                    </header>
                    <fieldset
                      className="admin-operation-guard"
                      disabled={!!report}
                    >
                      <div className="matchday-fields">
                        <TeamSearch
                          id={`day-home-${index}`}
                          label={`Domicile · match ${index + 1}`}
                          value={row.home_team}
                          onChange={(v) => field(index, "home_team", v)}
                          teams={teams}
                          exclude={row.away_team}
                        />
                        <TeamSearch
                          id={`day-away-${index}`}
                          label={`Extérieur · match ${index + 1}`}
                          value={row.away_team}
                          onChange={(v) => field(index, "away_team", v)}
                          teams={teams}
                          exclude={row.home_team}
                        />
                        {["home", "away"].map((side) => (
                          <div className="admin-field" key={side}>
                            <label htmlFor={`day-${side}-score-${index}`}>
                              Score {side === "home" ? "domicile" : "extérieur"}{" "}
                              · match {index + 1}
                            </label>
                            <input
                              id={`day-${side}-score-${index}`}
                              type="number"
                              min="0"
                              max="32767"
                              inputMode="numeric"
                              value={row[`${side}_goals`]}
                              onChange={(e) =>
                                field(index, `${side}_goals`, e.target.value)
                              }
                            />
                          </div>
                        ))}
                        <div className="admin-field">
                          <label htmlFor={`day-date-${index}`}>
                            Date · match {index + 1}
                          </label>
                          <input
                            id={`day-date-${index}`}
                            type="date"
                            value={row.date}
                            onChange={(e) =>
                              field(index, "date", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <details className="admin-extra">
                        <summary>
                          {competition?.type === "european-cup"
                            ? "Statistiques du match européen"
                            : "Ajouter les statistiques et la source du match"}
                        </summary>
                        <div className="admin-grid">
                          {statFields.flatMap(([key, label, type]) =>
                            ["home", "away"].map((side) => {
                              const column = `${side}_${key === "team_rating" ? "rating" : key}`;
                              return (
                                <div className="admin-field" key={column}>
                                  <label
                                    htmlFor={`day-stat-${index}-${column}`}
                                  >
                                    {label} ·{" "}
                                    {side === "home" ? "domicile" : "extérieur"}{" "}
                                    · match {index + 1}
                                  </label>
                                  <input
                                    id={`day-stat-${index}-${column}`}
                                    type="number"
                                    min="0"
                                    step={type === "integer" ? "1" : "any"}
                                    max={
                                      type === "rating"
                                        ? 10
                                        : type === "possession"
                                          ? 100
                                          : undefined
                                    }
                                    value={row[column]}
                                    onChange={(e) =>
                                      field(index, column, e.target.value)
                                    }
                                    placeholder="Non renseigné"
                                  />
                                </div>
                              );
                            }),
                          )}
                          <div className="admin-field full">
                            <label htmlFor={`day-source-${index}`}>
                              Source particulière · match {index + 1}
                            </label>
                            <input
                              id={`day-source-${index}`}
                              value={row.source_url}
                              onChange={(e) =>
                                field(index, "source_url", e.target.value)
                              }
                              placeholder="Remplace la source commune"
                            />
                          </div>
                        </div>
                      </details>
                    </fieldset>
                    {item?.errors.length > 0 && (
                      <p className="field-error">
                        {[...new Set(item.errors)].join(" ")}
                      </p>
                    )}
                    {report && (
                      <p className="muted-text">
                        {report.rows.find(
                          (r) =>
                            r.line ===
                            plan.findIndex((p) => p.slot === index) + 2,
                        )?.message ||
                          (item
                            ? "Voir le bilan"
                            : "Ligne vide, non enregistrée")}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            {!report && (
              <button
                className="button button-primary"
                disabled={!ready || hasErrors}
                onClick={save}
              >
                {busy
                  ? "Enregistrement…"
                  : `Enregistrer les ${ready} matchs en brouillon`}
              </button>
            )}
            {progress && busy && (
              <p role="status">
                {progress.rows.length} / {plan.length} traités.
              </p>
            )}
            {report && (
              <Notice>
                Les lignes traitées sont verrouillées pour éviter une double
                sauvegarde. Vérifiez les opérations incertaines dans « Matchs &
                brouillons » avant toute nouvelle tentative.
              </Notice>
            )}
            <button
              className="button button-secondary"
              onClick={() => {
                setSlots([]);
                setEditingHeader(true);
                setReport(null);
                setProgress(null);
                setMessage("");
              }}
            >
              Terminer cette grille / préparer une autre journée
            </button>
          </>
        )}
      </fieldset>
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
