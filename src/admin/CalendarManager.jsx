import { useEffect, useRef, useState } from "react";
import { calendarLeagues, planCalendar } from "../domain/calendar";
import {
  fetchCalendar,
  calendarStatus,
  applyCalendar,
} from "../services/calendarRepository";
import { Notice } from "../components/FootballUI";

export default function CalendarManager({
  dataset,
  reload,
  onEdit,
  onPrepare,
}) {
  const [plan, setPlan] = useState(null),
    [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [ack, setAck] = useState(false);
  const pending = useRef(null),
    lock = useRef(false);
  async function readStatus() {
    try {
      setStatus(await calendarStatus());
    } catch (e) {
      if (e.code === "PGRST202") setStatus({ installed: false });
      else setMessage(e.message);
    }
  }
  useEffect(() => {
    readStatus();
  }, []);
  async function preview() {
    if (lock.current || pending.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const bundle = await fetchCalendar();
      const fresh = await reload();
      if (!fresh)
        throw new Error("Le catalogue Calcito ne peut pas être relu.");
      setPlan(planCalendar(bundle, fresh));
      setAck(false);
    } catch (e) {
      setMessage(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function apply() {
    if (lock.current || (!pending.current && (!plan || !ack))) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    pending.current ||= { entries: plan.rows, nonce: crypto.randomUUID() };
    try {
      const r = await applyCalendar(
        pending.current.entries,
        pending.current.nonce,
      );
      setMessage(
        `${r.added} ajoutés · ${r.updated} mis à jour · ${r.unchanged} conservés. Synchronisation confirmée par Supabase.`,
      );
      pending.current = null;
      setPlan(null);
      setAck(false);
      await reload();
      await readStatus();
    } catch (e) {
      setMessage(
        e.code
          ? e.message
          : "Réponse non confirmée. Réessayer utilise le même identifiant ; aucun doublon.",
      );
      if (e.code) pending.current = null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const future = dataset.matches.filter(
    (m) => m.status === "scheduled" && Date.parse(m.kickoff) > Date.now(),
  );
  return (
    <section className="admin-panel calendar-manager">
      <span className="eyebrow">CALENDRIER DES PRONOSTICS</span>
      <h2>Les deux prochaines rencontres.</h2>
      <p className="muted-text">
        Calendriers OpenFootball CC0, saison 2026–2027. Prévisualisation avant
        publication. Les heures absentes restent à vérifier ; aucun club n’est
        créé automatiquement.
      </p>
      <button
        className="button button-primary"
        disabled={busy || Boolean(pending.current)}
        onClick={preview}
      >
        {busy ? "Traitement…" : "Actualiser les prochains matchs"}
      </button>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={onPrepare}
      >
        Préparer une journée manuellement
      </button>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={async () => {
          await reload();
          await readStatus();
        }}
      >
        Recharger le bilan serveur
      </button>
      {status?.installed === false && (
        <Notice>
          La synchronisation et le bookmaker autonome nécessitent la migration
          004.{" "}
          <a
            className="text-link"
            href={`${import.meta.env.BASE_URL}downloads/calcito-calendrier-bookmaker.sql`}
            download
          >
            Télécharger le script d’activation
          </a>
          . La prévisualisation reste disponible.
        </Notice>
      )}
      <p className="muted-text">
        Dernière synchronisation confirmée :{" "}
        {status?.lastSync
          ? new Date(status.lastSync).toLocaleString("fr-FR")
          : "aucune"}
        . Mise à jour manuelle : aucun robot permanent n’est lancé depuis GitHub
        Pages.
      </p>
      <div className="admin-metrics">
        {calendarLeagues.map((l) => {
          const comp = dataset.competitions.find((c) => c.slug === l.slug);
          return (
            <div key={l.code}>
              <strong>
                {
                  future.filter(
                    (m) =>
                      dataset.seasons.find((s) => s.id === m.season_id)
                        ?.competition_id === comp?.id,
                  ).length
                }
              </strong>
              <span>{l.name}</span>
            </div>
          );
        })}
      </div>
      {plan && (
        <>
          <h3>
            {plan.rows.length} rencontres reconnues · {plan.issues.length}{" "}
            points à vérifier
          </h3>
          <p className="muted-text">
            Collecte : {new Date(plan.fetchedAt).toLocaleString("fr-FR")} ·
            version {plan.sourceCommit.slice(0, 8)}.
          </p>
          <div className="table-scroll">
            <table className="official-table">
              <thead>
                <tr>
                  <th>Rencontre</th>
                  <th>Championnat / journée</th>
                  <th>Heure locale</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.external_key}>
                    <td>
                      {r.home} — {r.away}
                    </td>
                    <td>
                      {r.league} · {r.round}
                    </td>
                    <td>
                      {new Date(r.kickoff).toLocaleString("fr-FR", {
                        timeZone: r.timezone,
                      })}{" "}
                      · {r.timezone}
                    </td>
                    <td>
                      {
                        {
                          insert: "Ajouter et publier",
                          update: "Mettre à jour",
                          unchanged: "Conserver",
                        }[r.action]
                      }{" "}
                      · {r.status}
                      <a
                        className="text-link"
                        href={r.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Couverture de chaque équipe et anomalies</summary>
            {plan.coverage
              .filter((c) => c.found < 2)
              .map((c) => (
                <p key={c.club}>
                  {c.league} · {c.club} : {c.found}/2 horaires exploitables.
                </p>
              ))}
            {plan.issues.map((i, n) => (
              <p key={n}>
                {i.league} · {i.home} — {i.away} {i.date} : {i.reason}
              </p>
            ))}
          </details>
          <Notice>
            Une correction d’horaire, un report ou une annulation conserve les
            tickets et leurs cotes dans l’historique, mais neutralise les
            sélections concernées selon les règles de l’Arène. Les résultats
            officiels existants ne sont pas remplacés.
          </Notice>
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={busy || Boolean(pending.current)}
            />
            J’ai contrôlé la prévisualisation et souhaite publier ces rencontres
            et corrections.
          </label>
          <button
            className="button button-primary"
            disabled={
              busy ||
              !status?.installed ||
              (!ack && !pending.current) ||
              !plan.rows.length
            }
            onClick={apply}
          >
            {pending.current
              ? "Réessayer la même synchronisation"
              : "Publier le calendrier vérifié"}
          </button>
        </>
      )}
      <h3>État des cotes et corrections</h3>
      <p className="muted-text">
        {status?.fixtures?.filter(
          (f) => f.status === "scheduled" && f.available,
        ).length ?? "—"}{" "}
        rencontres avec données permettant des cotes ·{" "}
        {status?.fixtures?.filter(
          (f) => f.status === "scheduled" && !f.available,
        ).length ?? "—"}{" "}
        sans cotes. Les cotes ne sont créées qu’à la demande, avec leur version
        et leur date.
      </p>
      <div className="catalog-list">
        {dataset.matches
          .filter(
            (m) =>
              future.includes(m) ||
              ["postponed", "cancelled"].includes(m.status),
          )
          .map((m) => (
            <button key={m.id} onClick={() => onEdit(m)} disabled={busy}>
              {dataset.teams.find((t) => t.id === m.home_team_id)?.name} —{" "}
              {dataset.teams.find((t) => t.id === m.away_team_id)?.name}
              <span>
                {m.round} · {m.status} · Corriger manuellement
              </span>
            </button>
          ))}
      </div>
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
    </section>
  );
}
