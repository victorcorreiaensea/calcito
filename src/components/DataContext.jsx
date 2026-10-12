import { Info, Radio } from "lucide-react";
import { useFootball } from "../hooks/useFootball";
import { databaseConfig } from "../services/supabaseClient";

export function DataBanner() {
  return (
    <div className="data-banner">
      <div className="container">
        <span>
          <Radio size={14} />
          {databaseConfig.configured
            ? "SOURCE · SAISIE MANUELLE"
            : "CALCITO · FOOTBALL INTELLIGENCE"}
        </span>
        <p>
          {databaseConfig.configured
            ? "Matchs vérifiés et publiés par l’administrateur. Les classements partiels sont signalés."
            : "La nouvelle plateforme se prépare. Les résultats seront disponibles après leur publication."}
        </p>
      </div>
    </div>
  );
}
export function SourceCaption({ result }) {
  if (!result) return null;
  return (
    <p className="source-caption">
      <Info size={13} />
      <span>
        Source : {result.source.name}
        {result.updatedAt
          ? ` · Dernière mise à jour : ${new Date(result.updatedAt).toLocaleString("fr-FR")}`
          : ""}
      </span>
    </p>
  );
}
export function CompetitionSelect({ value, onChange, all = true }) {
  const { result, loading, error, retry } = useFootball("competitions");
  return (
    <div className="filter-field">
      <label htmlFor="competition-filter">Compétition</label>
      <select
        id="competition-filter"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading || Boolean(error)}
      >
        {all ? (
          <option value="">Toutes les compétitions</option>
        ) : (
          <option value="">Choisir une compétition</option>
        )}
        {result?.data.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="field-error">
          Les compétitions ne sont pas encore disponibles.{" "}
          <button onClick={retry}>Réessayer</button>
        </span>
      )}
    </div>
  );
}
export function SeasonSelect({ competition, value, onChange }) {
  const { result } = useFootball("competitions");
  const years = [
    ...new Set(
      (result?.data || [])
        .filter((item) => !competition || item.id === competition)
        .flatMap((item) => item.seasons),
    ),
  ].sort((a, b) => b - a);
  return (
    <div className="filter-field">
      <label htmlFor="season-filter">Saison</label>
      <select
        id="season-filter"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Dernière saison publiée</option>
        {years.map((year) => (
          <option key={year} value={year}>
            {year}–{year + 1}
          </option>
        ))}
      </select>
    </div>
  );
}
