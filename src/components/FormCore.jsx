import { formAppreciation } from "../domain/formPresentation";
export default function FormCore({
  score,
  compact = false,
  demo = false,
  variant,
  dataMode,
  children,
  dimensions = [],
}) {
  const available = Number.isFinite(score) && score >= 0 && score <= 100;
  const value = available
    ? Number(score.toFixed(1)).toLocaleString("fr-FR")
    : "—";
  const label = formAppreciation(score);
  const showDimensions =
    available &&
    dimensions.length > 0 &&
    Math.abs(dimensions.reduce((sum, d) => sum + d.value, 0) - score) < 0.00001;
  return (
    <div
      className={`form-core ${compact ? "form-core-compact" : "form-core-detailed"} ${available ? "" : "form-core-empty"}`}
    >
      <div
        className="form-core-dial"
        role="img"
        aria-label={
          available
            ? `Forme ${demo ? "de démonstration " : ""}${value} sur 100 : ${label}`
            : "Indice indisponible, données insuffisantes"
        }
      >
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="core-orbit" cx="100" cy="100" r="94" />
          {Array.from({ length: 40 }, (_, i) => (
            <line
              key={i}
              x1="100"
              x2="100"
              y1="7"
              y2={i % 5 === 0 ? "14" : "11"}
              transform={`rotate(${i * 9} 100 100)`}
              className="core-tick"
            />
          ))}
          <circle className="core-track" cx="100" cy="100" r="80" />
          <circle
            className="core-progress"
            cx="100"
            cy="100"
            r="80"
            pathLength="100"
            strokeDasharray={`${available ? score : 0} 100`}
            transform="rotate(-90 100 100)"
          />
          <circle className="core-inner" cx="100" cy="100" r="67" />
        </svg>
        <div className="core-readout" aria-hidden="true">
          <span>CALCITO</span>
          <strong>{value}</strong>
          <small>/ 100</small>
        </div>
      </div>
      <div className="core-caption">
        <strong>{label}</strong>
        <span>
          {demo
            ? "Démonstration fictive"
            : available
              ? variant === "provisional"
                ? "Indice simplifié · provisoire"
                : "Indice Calcito"
              : "Cinq résultats valides requis"}
        </span>
        {dataMode && available && (
          <small>
            Données{" "}
            {{
              complet: "complètes",
              mixte: "mixtes",
              simplifié: "simplifiées",
            }[dataMode] || dataMode}
          </small>
        )}
      </div>
      {!compact && showDimensions && (
        <div
          className="core-dimensions"
          aria-label="Contributions des dimensions à l’indice sur 100"
        >
          <small className="core-dimensions-label">
            Parts de l’indice / 100
          </small>
          {dimensions.map((d) => (
            <div key={d.key}>
              <span>{d.label}</span>
              <strong>
                {d.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
              </strong>
              <i
                aria-hidden="true"
                style={{ width: `${Math.min(100, d.value)}%` }}
              />
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
