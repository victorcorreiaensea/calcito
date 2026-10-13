import { useEffect, useRef, useState } from "react";
import { localDateTime } from "../domain/match";
import { TeamSearch } from "./MatchForm";
import {
  inferSeason,
  normalizeClub,
  resultLetter,
  simplifiedPayload,
  validateSimplified,
} from "../domain/simplified";
import { saveSimplified } from "../services/manualRepository";
const today = () => localDateTime().slice(0, 10);
function blank(teamId = "") {
  return {
    team_id: teamId,
    opponent_name: "",
    opponent_team_id: "",
    date: today(),
    competition_name: "",
    venue: "home",
    goals_for: "",
    goals_against: "",
    season_start_year: "",
    season_end_year: "",
  };
}
function remembered() {
  try {
    return sessionStorage.getItem("calcito:last-quick-team") || "";
  } catch {
    return "";
  }
}
export default function SimplifiedForm({
  dataset,
  editing,
  initialTeam,
  onSaved,
  onCancel,
}) {
  const [form, setForm] = useState(() => blank(initialTeam || remembered())),
    [errors, setErrors] = useState({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [publish, setPublish] = useState(false);
  const opponentRef = useRef(null);
  useEffect(() => {
    const teamId = initialTeam || remembered();
    if (editing)
      setForm({
        ...editing,
        date: editing.kickoff.slice(0, 10),
        expected_updated_at: editing.updated_at,
      });
    else {
      const b = blank(dataset.teams.some((t) => t.id === teamId) ? teamId : "");
      const s = inferSeason(dataset, b.team_id, b.date);
      setForm({
        ...b,
        season_start_year: s.start,
        season_end_year: s.end,
        competition_name:
          dataset.teams.find((t) => t.id === b.team_id)?.domestic_league || "",
      });
    }
    setErrors({});
    setPublish(editing?.is_published || false);
  }, [editing, initialTeam]);
  function field(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "team_id" || key === "date") {
        const s = inferSeason(dataset, next.team_id, next.date);
        next.season_start_year = s.start;
        next.season_end_year = s.end;
      }
      if (key === "team_id") {
        next.competition_name =
          dataset.teams.find((t) => t.id === value)?.domestic_league ||
          current.competition_name;
        next.opponent_team_id = "";
      }
      if (key === "opponent_name") next.opponent_team_id = "";
      return next;
    });
    setErrors((current) => ({ ...current, [key]: null }));
  }
  const inferred = inferSeason(dataset, form.team_id, form.date);
  const suggested = dataset.teams.filter(
    (t) =>
      t.id !== form.team_id &&
      normalizeClub(t.name) === normalizeClub(form.opponent_name),
  );
  const letter = resultLetter(form.goals_for, form.goals_against);
  async function save(next = false) {
    const validation = validateSimplified(form);
    if (
      normalizeClub(form.opponent_name) ===
      normalizeClub(dataset.teams.find((t) => t.id === form.team_id)?.name)
    )
      validation.opponent_name = "Choisissez un adversaire différent.";
    if (Object.keys(validation).length) {
      setErrors(validation);
      setMessage("Vérifiez les champs indiqués.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const id = await saveSimplified(simplifiedPayload(form, publish));
      try {
        sessionStorage.setItem("calcito:last-quick-team", form.team_id);
      } catch {
        /* Optional comfort setting. */
      }
      await onSaved(id, next);
      if (next) {
        setForm({
          ...form,
          id: undefined,
          expected_updated_at: undefined,
          opponent_name: "",
          opponent_team_id: "",
          goals_for: "",
          goals_against: "",
        });
        setTimeout(() => opponentRef.current?.focus(), 0);
      }
      setMessage(
        publish
          ? "Résultat publié. Historique actualisé."
          : "Brouillon privé enregistré.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  function input(key, label, type = "text", props = {}) {
    return (
      <div className="admin-field">
        <label htmlFor={`quick-${key}`}>{label}</label>
        <input
          id={`quick-${key}`}
          type={type}
          value={form[key] ?? ""}
          onChange={(e) => field(key, e.target.value)}
          aria-invalid={Boolean(errors[key])}
          {...props}
        />
        {errors[key] && <span className="field-error">{errors[key]}</span>}
      </div>
    );
  }
  return (
    <section className="admin-panel simplified-panel">
      <span className="eyebrow">UNE ÉQUIPE. UN RÉSULTAT.</span>
      <h2>
        {editing ? "Modifier le résultat rapide" : "Ajouter un résultat rapide"}
      </h2>
      <p className="muted-text">
        Championnat national non suivi. Aucune fiche adversaire ni statistique
        détaillée nécessaire. Tab pour avancer · Entrée ou Ctrl/Cmd + Entrée
        pour enregistrer et continuer.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!busy) save(true);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="simplified-grid">
            <TeamSearch
              id="quick-team"
              label="Équipe suivie"
              teams={dataset.teams}
              value={form.team_id}
              onChange={(value) => field("team_id", value)}
              error={errors.team_id}
            />
            {input("opponent_name", "Adversaire", "text", {
              ref: opponentRef,
              maxLength: 160,
              placeholder: "Nom libre, sans créer de fiche",
            })}
            {input("date", "Date du match", "date", { max: today() })}
            {input(
              "competition_name",
              "Championnat national non suivi",
              "text",
              { maxLength: 160, placeholder: "Ex. championnat tchèque" },
            )}
            <div className="admin-field">
              <label htmlFor="quick-venue">Terrain</label>
              <select
                id="quick-venue"
                value={form.venue}
                onChange={(e) => field("venue", e.target.value)}
              >
                <option value="home">Domicile</option>
                <option value="away">Extérieur</option>
              </select>
            </div>
            <div className="quick-result-score">
              {input("goals_for", "Buts marqués", "number", {
                min: 0,
                max: 32767,
                step: 1,
                inputMode: "numeric",
              })}
              {input("goals_against", "Buts encaissés", "number", {
                min: 0,
                max: 32767,
                step: 1,
                inputMode: "numeric",
              })}
              <output aria-live="polite">
                {{ V: "Victoire", N: "Nul", D: "Défaite" }[letter] || "—"}
              </output>
            </div>
          </div>
          {!!suggested.length && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(form.opponent_team_id)}
                onChange={(e) =>
                  field(
                    "opponent_team_id",
                    e.target.checked ? suggested[0].id : "",
                  )
                }
              />
              Lier à la fiche {suggested[0].name} (facultatif)
            </label>
          )}
          <details className="admin-extra">
            <summary>
              Saison : {form.season_start_year}–{form.season_end_year} ·{" "}
              {inferred.inferred ? "déduite des participations" : "à confirmer"}
            </summary>
            <p className="muted-text">
              La date ne suffit pas à connaître le calendrier d’un championnat.
              Confirmez la saison, notamment pour un championnat disputé sur une
              année civile.
            </p>
            <div className="admin-grid">
              {input("season_start_year", "Année de début", "number", {
                min: 1900,
                max: 2200,
              })}
              {input("season_end_year", "Année de fin", "number", {
                min: 1900,
                max: 2201,
              })}
            </div>
            {errors.season_start_year && (
              <p className="field-error">{errors.season_start_year}</p>
            )}
          </details>
          {errors.season_start_year && (
            <p className="field-error">{errors.season_start_year}</p>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Publier ce résultat vérifié (sinon brouillon privé)
          </label>
          <div className="admin-actions">
            <button className="button button-primary" type="submit">
              {busy ? "Enregistrement…" : "Enregistrer et ajouter un autre"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => save(false)}
            >
              Enregistrer
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
