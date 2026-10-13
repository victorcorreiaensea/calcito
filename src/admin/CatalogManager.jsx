import { useState } from "react";
import { mutate, setParticipants } from "../services/manualRepository";

const slugify = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function Controls({ children, busy }) {
  return <fieldset disabled={busy}>{children}</fieldset>;
}
export default function CatalogManager({ kind, dataset, reload }) {
  const [editing, setEditing] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [seasonId, setSeasonId] = useState(""),
    [selected, setSelected] = useState([]),
    [adjustment, setAdjustment] = useState({
      team_id: "",
      point_adjustment: "0",
      adjustment_reason: "",
      group_name: "",
    });
  const [form, setForm] = useState({
    name: "",
    short: "",
    country: "",
    logo_url: "",
    slug: "",
    is_published: false,
    type: "league",
    competition_id: "",
    label: "2026–2027",
    start_year: 2026,
    end_year: 2027,
    win_points: 3,
    draw_points: 1,
    loss_points: 0,
    tie_breakers: "points,goalDifference,goalsFor",
    rules_confirmed: false,
    expected_matches: "",
    verified_complete: false,
  });
  const table =
    kind === "teams"
      ? "teams"
      : kind === "competitions"
        ? "competitions"
        : "seasons";
  const rows = dataset[table];
  function edit(row) {
    setEditing(row.id);
    setForm({
      ...row,
      tie_breakers: Array.isArray(row.tie_breakers)
        ? row.tie_breakers.join(",")
        : row.tie_breakers || "points,goalDifference,goalsFor",
      logo_url: row.logo_url || "",
      expected_matches: row.expected_matches ?? "",
    });
    setMessage("");
  }
  async function task(callback, success) {
    setBusy(true);
    setMessage("");
    try {
      await callback();
      await reload();
      setMessage(success);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    const payload =
      table === "teams"
        ? {
            slug: form.slug || slugify(form.name),
            name: form.name.trim(),
            short: form.short.toUpperCase(),
            country: form.country,
            logo_url: form.logo_url || null,
            ...(dataset.simplifiedReady
              ? { domestic_league: form.domestic_league?.trim() || null }
              : {}),
            is_published: form.is_published,
          }
        : table === "competitions"
          ? {
              slug: form.slug || slugify(form.name),
              name: form.name,
              country: form.country,
              type: form.type,
              is_published: form.is_published,
              form_coefficient:
                form.form_coefficient === "" || form.form_coefficient == null
                  ? null
                  : Number(form.form_coefficient),
            }
          : {
              competition_id: form.competition_id,
              label: form.label,
              start_year: Number(form.start_year),
              end_year: Number(form.end_year),
              win_points: Number(form.win_points),
              draw_points: Number(form.draw_points),
              loss_points: Number(form.loss_points),
              tie_breakers: form.tie_breakers
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              rules_confirmed: form.rules_confirmed,
              expected_matches:
                form.expected_matches === ""
                  ? null
                  : Number(form.expected_matches),
              verified_complete: form.verified_complete,
              is_published: form.is_published,
            };
    await task(
      () => mutate(table, editing ? "update" : "insert", payload, editing),
      "Données enregistrées.",
    );
  }
  function field(key, label, type = "text") {
    return (
      <div className="admin-field">
        <label htmlFor={`catalog-${key}`}>{label}</label>
        <input
          id={`catalog-${key}`}
          required={[
            "name",
            "short",
            "country",
            "competition_id",
            "label",
            "start_year",
            "end_year",
          ].includes(key)}
          type={type}
          step={key === "form_coefficient" ? "any" : undefined}
          value={form[key] ?? ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, [key]: event.target.value }))
          }
        />
      </div>
    );
  }
  function selectSeason(id) {
    setSeasonId(id);
    setSelected(
      dataset.members
        .filter((row) => row.season_id === id)
        .map((row) => row.team_id),
    );
  }
  return (
    <div>
      <section className="admin-panel">
        <div className="panel-heading">
          <h2>
            {kind === "teams"
              ? "Équipes"
              : kind === "competitions"
                ? "Compétitions"
                : "Saisons & règles"}
          </h2>
          <button
            className="button button-secondary"
            onClick={() => {
              setEditing(null);
              setForm((current) => ({
                ...current,
                name: "",
                slug: "",
                short: "",
                logo_url: "",
                is_published: false,
                verified_complete: false,
              }));
            }}
          >
            Nouvelle fiche
          </button>
        </div>
        <form onSubmit={save}>
          <Controls busy={busy}>
            <div className="admin-grid">
              {table === "seasons" ? (
                <>
                  <div className="admin-field">
                    <label htmlFor="catalog-competition">Compétition</label>
                    <select
                      id="catalog-competition"
                      required
                      value={form.competition_id}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          competition_id: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sélectionner</option>
                      {dataset.competitions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {field("label", "Nom de la saison")}
                  {field("start_year", "Année de début", "number")}
                  {field("end_year", "Année de fin", "number")}
                  {field("win_points", "Points victoire", "number")}
                  {field("draw_points", "Points nul", "number")}
                  {field("loss_points", "Points défaite", "number")}
                  {field(
                    "expected_matches",
                    "Nombre total de matchs attendus",
                    "number",
                  )}
                  <div className="admin-field full">
                    {field(
                      "tie_breakers",
                      "Départages, dans l’ordre (séparés par des virgules)",
                    )}
                    <small className="muted-text">
                      points, headToHeadPoints, headToHeadGoalDifference,
                      goalDifference, goalsFor, wins. Validez les règles réelles
                      de la compétition avant de les confirmer.
                    </small>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.rules_confirmed}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          rules_confirmed: event.target.checked,
                        }))
                      }
                    />{" "}
                    Règles officielles vérifiées
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.verified_complete}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          verified_complete: event.target.checked,
                        }))
                      }
                    />{" "}
                    Tous les matchs nécessaires ont été vérifiés
                  </label>
                </>
              ) : (
                <>
                  {field("name", "Nom")}
                  {field(
                    "slug",
                    "Identifiant lisible stable (automatique si vide)",
                  )}
                  {field("country", "Pays")}
                  {table === "teams" ? (
                    <>
                      {field("short", "Abréviation")}
                      {dataset.simplifiedReady &&
                        field(
                          "domestic_league",
                          "Championnat d’origine (facultatif)",
                        )}
                      {field("logo_url", "URL HTTPS du logo", "url")}
                    </>
                  ) : (
                    <>
                      <div className="admin-field">
                        <label htmlFor="catalog-type">Type</label>
                        <select
                          id="catalog-type"
                          value={form.type}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              type: event.target.value,
                            }))
                          }
                        >
                          <option value="league">Championnat</option>
                          <option value="european-cup">Coupe européenne</option>
                        </select>
                      </div>
                      {field(
                        "form_coefficient",
                        "Coefficient Calcito confirmé (facultatif)",
                        "number",
                      )}
                    </>
                  )}
                </>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={Boolean(form.is_published)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_published: event.target.checked,
                    }))
                  }
                />{" "}
                Publier cette fiche
              </label>
            </div>
            <button className="button button-primary" type="submit">
              {editing ? "Enregistrer les modifications" : "Créer"}
            </button>
          </Controls>
        </form>
        <div className="catalog-list">
          {rows.map((row) => (
            <button key={row.id} onClick={() => edit(row)}>
              {row.name ||
                `${dataset.competitions.find((c) => c.id === row.competition_id)?.name} · ${row.label}`}
              <span>{row.is_published ? "Publié" : "Privé"} · Modifier</span>
            </button>
          ))}
        </div>
      </section>
      {table === "seasons" && (
        <section className="admin-panel">
          <h2>Équipes participantes & sanctions</h2>
          <div className="admin-field">
            <label htmlFor="member-season">Saison à gérer</label>
            <select
              id="member-season"
              value={seasonId}
              onChange={(event) => selectSeason(event.target.value)}
            >
              <option value="">Choisir</option>
              {dataset.seasons.map((row) => (
                <option key={row.id} value={row.id}>
                  {
                    dataset.competitions.find(
                      (c) => c.id === row.competition_id,
                    )?.name
                  }{" "}
                  · {row.label}
                </option>
              ))}
            </select>
          </div>
          {seasonId && (
            <>
              <div className="participant-options">
                {dataset.teams.map((team) => (
                  <label key={team.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(team.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, team.id]
                            : current.filter((id) => id !== team.id),
                        )
                      }
                    />
                    {team.name}
                    <small>{team.country}</small>
                  </label>
                ))}
              </div>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  task(
                    () =>
                      setParticipants(
                        seasonId,
                        selected.map((team_id) => ({
                          ...dataset.members.find(
                            (m) =>
                              m.season_id === seasonId && m.team_id === team_id,
                          ),
                          team_id,
                        })),
                      ),
                    "Participants enregistrés.",
                  )
                }
              >
                Enregistrer les participants
              </button>
              <h3>Correction de points justifiée</h3>
              <div className="admin-grid">
                <div className="admin-field">
                  <label htmlFor="adjust-team">Équipe</label>
                  <select
                    id="adjust-team"
                    value={adjustment.team_id}
                    onChange={(event) => {
                      const team_id = event.target.value;
                      const member = dataset.members.find(
                        (m) =>
                          m.season_id === seasonId && m.team_id === team_id,
                      );
                      setAdjustment({
                        team_id,
                        point_adjustment: member?.point_adjustment || 0,
                        adjustment_reason: member?.adjustment_reason || "",
                        group_name: member?.group_name || "",
                      });
                    }}
                  >
                    <option value="">Choisir</option>
                    {dataset.teams
                      .filter((t) => selected.includes(t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="admin-field">
                  <label htmlFor="adjust-points">Ajustement (+ / −)</label>
                  <input
                    id="adjust-points"
                    type="number"
                    value={adjustment.point_adjustment}
                    onChange={(event) =>
                      setAdjustment((current) => ({
                        ...current,
                        point_adjustment: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="admin-field">
                  <label htmlFor="adjust-reason">Justification</label>
                  <input
                    id="adjust-reason"
                    value={adjustment.adjustment_reason}
                    onChange={(event) =>
                      setAdjustment((current) => ({
                        ...current,
                        adjustment_reason: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="admin-field">
                  <label htmlFor="adjust-group">Groupe (si applicable)</label>
                  <input
                    id="adjust-group"
                    value={adjustment.group_name}
                    onChange={(event) =>
                      setAdjustment((current) => ({
                        ...current,
                        group_name: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <button
                className="button button-secondary"
                disabled={busy || !adjustment.team_id}
                onClick={() => {
                  if (
                    Number(adjustment.point_adjustment) !== 0 &&
                    !adjustment.adjustment_reason.trim()
                  ) {
                    setMessage("Une sanction nécessite une justification.");
                    return;
                  }
                  task(
                    () =>
                      mutate("season_teams", "upsert", {
                        ...adjustment,
                        season_id: seasonId,
                        point_adjustment: Number(adjustment.point_adjustment),
                        group_name: adjustment.group_name || null,
                      }),
                    "Correction enregistrée et auditée.",
                  );
                }}
              >
                Enregistrer la correction
              </button>
            </>
          )}
        </section>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
