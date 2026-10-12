import { Info, Radio } from "lucide-react";
import { footballService } from "../services/footballService";
import { useFootball } from "../hooks/useFootball";

export function DataBanner() {
  const demo = footballService.mode === "demo";
  return (
    <div className={`data-banner ${demo ? "" : "real-mode"}`}>
      <div className="container">
        <span>
          <Radio size={14} />
          {demo ? "MODE DÉMONSTRATION" : "SOURCE FOOTBALL CONFIGURÉE"}
        </span>
        <p>
          {demo
            ? "Équipes et indices fictifs. Aucune donnée sportive réelle connectée."
            : "Résultats et classements issus de l’API. Les indices simulés sont signalés et restent distincts des données officielles."}
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
      {result.mode === "demo" ? (
        "Exemples fictifs — aucune statistique réelle."
      ) : (
        <>
          Source : {result.source.name} · Récupéré le{" "}
          {new Date(result.fetchedAt).toLocaleString("fr-FR")}
        </>
      )}
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
        {all && <option value="">Toutes les compétitions</option>}
        {!all && <option value="">Choisir une compétition</option>}
        {result?.data.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="field-error">
          Compétitions indisponibles. <button onClick={retry}>Réessayer</button>
        </span>
      )}
    </div>
  );
}
