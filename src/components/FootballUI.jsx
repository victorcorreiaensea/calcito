import { useState } from "react";
import { Shield, Info, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import CalcitoMascot from "./CalcitoMascot";

export function DemoLabel({ compact = false }) {
  return (
    <span className="demo-label">
      {compact ? "DÉMO" : "DONNÉES DE DÉMONSTRATION"}
    </span>
  );
}
export function TeamBadge({ team, small = false }) {
  const [failedLogo, setFailedLogo] = useState(null);
  // Only use logos from a configured provider; never construct guessed image URLs.
  if (team.logo && failedLogo !== team.logo) {
    return (
      <img
        className={`club-logo ${small ? "small" : ""}`}
        src={team.logo}
        alt={`Logo de ${team.name}`}
        onError={() => setFailedLogo(team.logo)}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={`team-badge ${small ? "small" : ""}`}
      style={{ "--team-color": team.color || "#2F8CFF" }}
      aria-hidden="true"
    >
      <Shield size={small ? 23 : 34} strokeWidth={1.3} />
      <b>{(team.short || team.name).slice(0, 1)}</b>
    </span>
  );
}
export function FormBar({ score }) {
  return (
    <div className="form-track" aria-hidden="true">
      <span style={{ width: `${score}%` }} />
    </div>
  );
}
export function Results({ results = [], demo = true }) {
  if (!results.length)
    return <span className="muted-text">Résultats indisponibles</span>;
  return (
    <div
      className="results"
      aria-label={`Derniers résultats${demo ? " fictifs" : ""}, du plus ancien au plus récent : ${results.map((r) => ({ V: "victoire", N: "nul", D: "défaite" })[r] || "indisponible").join(", ")}`}
    >
      {results.map((r, i) => (
        <span
          key={i}
          className={`result result-${r.toLowerCase()}`}
          aria-hidden="true"
        >
          {r}
        </span>
      ))}
    </div>
  );
}
export function FormValue({ score, demo = false, variant, dataMode }) {
  return (
    <div className="form-value">
      <strong>
        {Number.isFinite(score) ? `${Number(score.toFixed(1))} %` : "—"}
      </strong>
      <span>
        {demo
          ? "Indice simulé"
          : Number.isFinite(score)
            ? variant === "provisional"
              ? "Indice résultats provisoire"
              : "Indice Calcito"
            : "Données insuffisantes"}
      </span>
      {Number.isFinite(score) && dataMode && (
        <small>
          Données{" "}
          {{ complet: "complètes", mixte: "mixtes", simplifié: "simplifiées" }[
            dataMode
          ] || dataMode}
        </small>
      )}
      {Number.isFinite(score) && <FormBar score={score} />}
    </div>
  );
}
export function PageHeading({ label, title, description }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{label}</span>
      <h1>
        {title}
        <span>.</span>
      </h1>
      <p>{description}</p>
    </div>
  );
}
export function DataState({ loading, error, empty, retry, children }) {
  if (loading)
    return (
      <div className="state-panel" role="status">
        <span className="loading-spinner" />
        Chargement des données…
      </div>
    );
  if (error || empty)
    return (
      <div className="state-panel" role={error ? "alert" : "status"}>
        <CalcitoMascot
          variant={error ? "error" : "empty"}
          title={
            error?.code === "NOT_CONFIGURED"
              ? "Les résultats arrivent bientôt"
              : error
                ? "Données indisponibles"
                : "Aucun résultat"
          }
          message={
            error?.message ||
            "Essayez une autre recherche ou une autre compétition."
          }
        />
        {retry && (
          <button className="button button-secondary" onClick={retry}>
            <RefreshCw size={16} />
            Réessayer
          </button>
        )}
      </div>
    );
  return children;
}
export function Notice({ children }) {
  return (
    <div className="info-notice">
      <Info size={16} />
      <p>{children}</p>
    </div>
  );
}
export function TeamLink({ team }) {
  if (!team.id)
    return (
      <span className="team-link">
        <TeamBadge team={team} small />
        <span>{team.name}</span>
      </span>
    );
  return (
    <Link className="team-link" to={`/equipes/${encodeURIComponent(team.id)}`}>
      <TeamBadge team={team} small />
      <span>{team.name}</span>
    </Link>
  );
}
