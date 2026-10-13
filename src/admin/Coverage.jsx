import { useState } from "react";
import { coverageRows } from "../domain/simplified";
export default function Coverage({ dataset, onAdd }) {
  const years = [
    ...new Set([
      ...dataset.seasons.map((s) => s.start_year),
      ...(dataset.simplified || []).map((r) => r.season_start_year),
    ]),
  ].sort((a, b) => b - a);
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState("");
  const year = Number(selected) || years[0] || new Date().getFullYear();
  const rows = coverageRows(dataset, year);
  const complete = rows.filter((r) => r.status === "complete").length;
  return (
    <section className="admin-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PRIORITÉ AUX HISTORIQUES À COMPLÉTER</span>
          <h2>Suivi de couverture</h2>
        </div>
        <div className="admin-field">
          <label htmlFor="coverage-year">Saison</label>
          <select
            id="coverage-year"
            value={year}
            onChange={(e) => setSelected(e.target.value)}
          >
            {(years.length ? years : [year]).map((y) => (
              <option key={y} value={y}>
                {y}–{y + 1}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="admin-metrics">
        {[
          [rows.length, "Équipes suivies"],
          [dataset.matches.length, "Matchs complets"],
          [
            (dataset.simplified || []).filter((r) => !r.converted_at).length,
            "Résultats simplifiés",
          ],
          [
            rows.filter((r) => r.recorded === 5).length,
            "Équipes avec 5 résultats saisis",
          ],
          [
            rows.filter((r) => r.recorded < 5).length,
            "Équipes avec moins de 5 résultats",
          ],
          [complete, "Indices complets"],
          [rows.length - complete, "Indices provisoires ou indisponibles"],
        ].map(([n, label]) => (
          <div key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="muted-text">
        Couverture des saisies, brouillons compris. Les indices utilisent
        uniquement les résultats publiés. Les totaux de matchs concernent toutes
        les saisons.
      </p>
      <div className="admin-field">
        <label htmlFor="coverage-search">Rechercher une équipe</label>
        <input
          id="coverage-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom de l’équipe…"
        />
      </div>
      <div className="coverage-list">
        {rows
          .filter((r) =>
            r.team.name
              .toLocaleLowerCase("fr")
              .includes(search.toLocaleLowerCase("fr")),
          )
          .map((r) => (
            <button key={r.team.id} onClick={() => onAdd(r.team.id)}>
              <strong>{r.team.name}</strong>
              <span>
                {r.recorded} / 5 saisis · {r.missingToEnter} à ajouter ·{" "}
                {r.sampleSize} publiés
              </span>
              <small>
                {r.label}
                {r.drafts ? ` · ${r.drafts} brouillon(s)` : ""} → Ajouter un
                résultat
              </small>
            </button>
          ))}
      </div>
      {!rows.length && (
        <p className="muted-text">
          Créez votre première équipe pour commencer le suivi.
        </p>
      )}
    </section>
  );
}
