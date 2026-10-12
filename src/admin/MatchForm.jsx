import { useEffect, useRef, useState } from "react";
import { Save, Send, Copy, ArrowRight, CalendarDays } from "lucide-react";
import {
  blankMatch,
  localDateTime,
  matchPayload,
  statFields,
  validateMatch,
} from "../domain/match";
import { Notice } from "../components/FootballUI";
import { saveMatch } from "../services/manualRepository";

function TeamSearch({
  label,
  value,
  onChange,
  teams,
  exclude,
  error,
  id,
  focusRef,
}) {
  const teamLabel = (team) =>
    teams.filter((t) => t.name === team.name).length > 1
      ? `${team.name} · ${team.country} · ${team.slug}`
      : team.name;
  const [query, setQuery] = useState("");
  const selectedTeam = teams.find((team) => team.id === value);
  const selectedName = selectedTeam ? teamLabel(selectedTeam) : "";
  useEffect(() => {
    setQuery(selectedName);
  }, [value, selectedName]);
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={focusRef}
        id={id}
        list={`${id}-list`}
        value={query}
        autoComplete="off"
        placeholder="Rechercher une équipe…"
        onChange={(event) => {
          const text = event.target.value;
          setQuery(text);
          const selected = teams.find(
            (team) => teamLabel(team) === text && team.id !== exclude,
          );
          onChange(selected?.id || "");
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <datalist id={`${id}-list`}>
        {teams
          .filter((team) => team.id !== exclude)
          .map((team) => (
            <option key={team.id} value={teamLabel(team)}>
              {team.short} · {team.country}
            </option>
          ))}
      </datalist>
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
export default function MatchForm({ dataset, editing, onSaved, onCancel }) {
  const [form, setForm] = useState(blankMatch),
    [errors, setErrors] = useState({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [publishNext, setPublishNext] = useState(false);
  const firstTeam = useRef(null),
    lastSaved = useRef(null);
  useEffect(() => {
    if (editing) {
      const stats = dataset.stats.filter((row) => row.match_id === editing.id);
      setForm({
        ...editing,
        expected_updated_at: editing.updated_at,
        kickoff: localDateTime(new Date(editing.kickoff)),
        verified_at: editing.verified_at
          ? localDateTime(new Date(editing.verified_at))
          : "",
        home_stats: stats.find((s) => s.team_id === editing.home_team_id) || {},
        away_stats: stats.find((s) => s.team_id === editing.away_team_id) || {},
      });
    } else
      setForm((current) => ({
        ...blankMatch(),
        season_id: current.season_id,
        round: current.round,
        source: current.source,
        kickoff: current.kickoff,
        verified_at: current.verified_at,
      }));
    setErrors({});
    setMessage("");
  }, [editing]);
  const season = dataset.seasons.find((item) => item.id === form.season_id);
  const competition = dataset.competitions.find(
    (item) => item.id === season?.competition_id,
  );
  const participants = dataset.teams.filter((team) =>
    dataset.members.some(
      (member) =>
        member.season_id === form.season_id && member.team_id === team.id,
    ),
  );
  function field(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: null }));
  }
  function stat(side, key, value) {
    setForm((current) => ({
      ...current,
      [`${side}_stats`]: { ...current[`${side}_stats`], [key]: value },
    }));
  }
  async function submit(published, next = false) {
    const validation = validateMatch(form, published);
    if (Object.keys(validation).length) {
      setErrors(validation);
      setMessage("Vérifiez les champs indiqués avant d’enregistrer.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = matchPayload(form, published);
      payload.kickoff = new Date(form.kickoff).toISOString();
      payload.verified_at = form.verified_at
        ? new Date(form.verified_at).toISOString()
        : null;
      const id = await saveMatch(payload);
      lastSaved.current = form;
      setMessage(
        published
          ? "Match publié. Les deux équipes sont mises à jour."
          : "Brouillon enregistré dans la base privée.",
      );
      if (next) {
        setForm({
          ...blankMatch(),
          season_id: form.season_id,
          round: form.round,
          kickoff: form.kickoff,
          source: form.source,
          verified_at: form.verified_at,
        });
        onSaved(id, true);
        setTimeout(() => firstTeam.current?.focus(), 0);
      } else {
        onSaved(id, false);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  function numeric(key, label, step = "1", max) {
    return (
      <div className="admin-field">
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          type="number"
          inputMode={step === "1" ? "numeric" : "decimal"}
          min="0"
          max={max}
          step={step}
          value={form[key] ?? ""}
          onChange={(event) => field(key, event.target.value)}
          aria-invalid={Boolean(errors[key])}
        />
        {errors[key] && <span className="field-error">{errors[key]}</span>}
      </div>
    );
  }
  return (
    <section className="admin-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">UN MATCH. DEUX ÉQUIPES.</span>
          <h2>{editing ? "Modifier le match" : "Saisie rapide"}</h2>
        </div>
        <span className="status-pill">
          <CalendarDays size={13} /> Week-end & coupes
        </span>
      </div>
      <p className="muted-text">
        Tab pour avancer. Entrée enregistre puis passe au match suivant. Un
        champ vide reste non renseigné ; zéro signifie une valeur réellement
        constatée.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(publishNext, true);
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">Informations du match</legend>
          <div className="admin-grid">
            <div className="admin-field">
              <label htmlFor="match-season">Compétition et saison</label>
              <select
                id="match-season"
                value={form.season_id}
                onChange={(event) => {
                  field("season_id", event.target.value);
                  field("home_team_id", "");
                  field("away_team_id", "");
                }}
              >
                <option value="">Choisir une saison</option>
                {dataset.seasons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {
                      dataset.competitions.find(
                        (c) => c.id === item.competition_id,
                      )?.name
                    }{" "}
                    · {item.label}
                  </option>
                ))}
              </select>
              {errors.season_id && (
                <span className="field-error">{errors.season_id}</span>
              )}
            </div>
            <div className="admin-field">
              <label htmlFor="match-round">Journée ou phase</label>
              <input
                id="match-round"
                placeholder="J8, phase de ligue…"
                value={form.round}
                onChange={(event) => field("round", event.target.value)}
              />
              {errors.round && (
                <span className="field-error">{errors.round}</span>
              )}
            </div>
            <div className="admin-field">
              <label htmlFor="match-kickoff">Date et heure du match</label>
              <input
                id="match-kickoff"
                type="datetime-local"
                value={form.kickoff}
                onChange={(event) => field("kickoff", event.target.value)}
              />
              {errors.kickoff && (
                <span className="field-error">{errors.kickoff}</span>
              )}
            </div>
            <div className="admin-field">
              <label htmlFor="match-status">Statut</label>
              <select
                id="match-status"
                value={form.status}
                onChange={(event) => field("status", event.target.value)}
              >
                {[
                  ["finished", "Terminé"],
                  ["scheduled", "À venir"],
                  ["live", "En cours"],
                  ["postponed", "Reporté"],
                  ["cancelled", "Annulé"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {season && !participants.length && (
            <p role="alert" className="field-error">
              Ajoutez les équipes participantes à cette saison dans «
              Compétitions & saisons ».
            </p>
          )}
          <>
            {season && (!season.is_published || !competition?.is_published) && (
              <Notice>
                Cette saison ou sa compétition est privée. Les matchs resteront
                invisibles aux visiteurs jusqu’à sa publication.
              </Notice>
            )}
          </>
          <div className="quick-score-grid">
            <TeamSearch
              id="home-search"
              label="Domicile"
              value={form.home_team_id}
              onChange={(value) => field("home_team_id", value)}
              teams={participants}
              exclude={form.away_team_id}
              error={errors.home_team_id}
              focusRef={firstTeam}
            />
            {numeric("goals_home", "Buts domicile")}
            {numeric("goals_away", "Buts extérieur")}
            <TeamSearch
              id="away-search"
              label="Extérieur"
              value={form.away_team_id}
              onChange={(value) => field("away_team_id", value)}
              teams={participants}
              exclude={form.home_team_id}
              error={errors.away_team_id}
            />
          </div>
          <div className="quick-stats-table">
            <div className="quick-stats-heading">
              <span>Statistique</span>
              <strong>Domicile</strong>
              <strong>Extérieur</strong>
            </div>
            {statFields.slice(0, 5).map(([key, label, type]) => (
              <div className="quick-stats-row" key={key}>
                <span>{label}</span>
                {["home", "away"].map((side) => (
                  <div key={side}>
                    <label className="sr-only" htmlFor={`${side}-${key}`}>
                      {label} {side === "home" ? "domicile" : "extérieur"}
                    </label>
                    <input
                      id={`${side}-${key}`}
                      type="number"
                      inputMode={type === "integer" ? "numeric" : "decimal"}
                      min="0"
                      max={type === "rating" ? 10 : undefined}
                      step={type === "integer" ? 1 : 0.01}
                      placeholder="—"
                      value={form[`${side}_stats`][key] ?? ""}
                      onChange={(event) => stat(side, key, event.target.value)}
                      aria-invalid={Boolean(errors[`${side}_${key}`])}
                    />
                    {errors[`${side}_${key}`] && (
                      <span className="field-error">
                        {errors[`${side}_${key}`]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <details className="admin-extra">
            <summary>
              Mi-temps, prolongation, tirs au but, possession & xG
            </summary>
            <div className="admin-grid">
              {[
                ["halftime_home", "Mi-temps domicile"],
                ["halftime_away", "Mi-temps extérieur"],
                ["extra_home", "Prolongation domicile"],
                ["extra_away", "Prolongation extérieur"],
                ["penalties_home", "Tirs au but domicile"],
                ["penalties_away", "Tirs au but extérieur"],
              ].map(([key, label]) => numeric(key, label))}
              {statFields.slice(5).flatMap(([key, label, type]) =>
                ["home", "away"].map((side) => (
                  <div className="admin-field" key={`${side}-${key}`}>
                    <label htmlFor={`${side}-${key}`}>
                      {label} {side === "home" ? "domicile" : "extérieur"}
                    </label>
                    <input
                      id={`${side}-${key}`}
                      type="number"
                      min="0"
                      max={type === "possession" ? 100 : undefined}
                      step=".01"
                      value={form[`${side}_stats`][key] ?? ""}
                      onChange={(event) => stat(side, key, event.target.value)}
                    />
                    {errors[`${side}_${key}`] && (
                      <span className="field-error">
                        {errors[`${side}_${key}`]}
                      </span>
                    )}
                  </div>
                )),
              )}
            </div>
          </details>
          <div className="admin-grid verification-grid">
            <div className="admin-field">
              <label htmlFor="match-source">Source des statistiques</label>
              <input
                id="match-source"
                placeholder="Source consultée ou URL"
                value={form.source ?? ""}
                onChange={(event) => field("source", event.target.value)}
              />
              {errors.source && (
                <span className="field-error">{errors.source}</span>
              )}
            </div>
            <div className="admin-field">
              <label htmlFor="match-verified">Vérifié le</label>
              <input
                id="match-verified"
                type="datetime-local"
                value={form.verified_at ?? ""}
                onChange={(event) => field("verified_at", event.target.value)}
              />
              {errors.verified_at && (
                <span className="field-error">{errors.verified_at}</span>
              )}
            </div>
            <div className="admin-field full">
              <label htmlFor="match-comment">
                Commentaire public (facultatif)
              </label>
              <input
                id="match-comment"
                value={form.comment ?? ""}
                onChange={(event) => field("comment", event.target.value)}
              />
            </div>
          </div>
          <div className="quick-save-choice">
            <label>
              <input
                type="checkbox"
                checked={publishNext}
                onChange={(event) => setPublishNext(event.target.checked)}
              />{" "}
              Publier après saisie rapide (sinon brouillon privé)
            </label>
            <span>{competition?.name || "Choisissez une compétition"}</span>
          </div>
          <div className="admin-actions">
            <button className="button button-primary" type="submit">
              <ArrowRight size={16} />
              {busy ? "Enregistrement…" : "Enregistrer puis suivant"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => submit(false)}
            >
              <Save size={15} />
              Brouillon
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => submit(true)}
            >
              <Send size={15} />
              Publier
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setForm((current) => ({
                  ...current,
                  id: undefined,
                  expected_updated_at: undefined,
                  is_published: false,
                }));
                setMessage(
                  "Formulaire dupliqué : changez les équipes ou la date pour créer un nouveau match.",
                );
              }}
            >
              <Copy size={15} />
              Dupliquer
            </button>
            <button type="button" className="quiet-button" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </fieldset>
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
