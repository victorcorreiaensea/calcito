const number = (n) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const metrics = [
  ["Buts marqués", (p) => p.goalsFor],
  ["Buts encaissés", (p) => p.goalsAgainst],
  ["Tirs", (p) => p.for.shots],
  ["Tirs concédés", (p) => p.against.shots],
  ["Tirs cadrés", (p) => p.for.shots_on_target],
  ["Tirs cadrés concédés", (p) => p.against.shots_on_target],
  ["Corners", (p) => p.for.corners],
  ["Corners concédés", (p) => p.against.corners],
  ["Possession (%)", (p) => p.for.possession],
];
export default function StatisticalResearch({ report, home, away }) {
  if (!report) return null;
  const model = report.validation.goals?.recent;
  return (
    <details className="comparator-details">
      <summary>Nouveau moteur statistique · Expérimental</summary>
      <p className="comparator-note">{report.reason}</p>
      <h3>Historique exploitable · {report.coverage.matches} matchs</h3>
      <p className="muted-text">
        Moyenne et nombre d’observations par statistique ; — signifie donnée
        absente.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Statistique</th>
              <th scope="col">{home.name}</th>
              <th scope="col">{away.name}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, get]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {["home", "away"].map((side) => {
                  const value = get(report.profiles[side]);
                  return (
                    <td key={side}>
                      {number(value.mean)} · n={value.n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Comparaison historique</h3>
      {model ? (
        <>
          <p className="muted-text">
            Rejeu chronologique, compétition sélectionnée ; Brier plus faible =
            meilleure erreur moyenne.
          </p>
          <ul>
            <li>
              Nouveau modèle : {model.all.n} prédictions · Brier{" "}
              {number(model.all.brier)} · log loss {number(model.all.logLoss)}.
            </li>
            <li>
              Référence simple, mêmes matchs : Brier{" "}
              {number(model.all.baselineBrier)}.
            </li>
            <li>
              V1, mêmes matchs : Brier{" "}
              {number(model.versusLegacy.all.baselineBrier)} · n=
              {model.versusLegacy.all.n}.
            </li>
            <li>
              Période de contrôle séparée : n={model.holdout.n} ; minimum
              d’étude : {report.validation.policy.holdoutMinimum}.
            </li>
          </ul>
          <p>{report.validation.selection.reason}</p>
        </>
      ) : (
        <p>{report.validation.reason}</p>
      )}
      <h3>Tirs cadrés et corners</h3>
      <p>
        {report.countMarkets.some((m) => m.poisson.status === "experimental")
          ? "Modèles de comptage calculables en étude ; aucune probabilité validée ni cote activée."
          : "Marchés indisponibles : historiques statistiques insuffisants."}
      </p>
      <details>
        <summary>Échantillons par marché</summary>
        <ul>
          {report.countMarkets.map((m) => (
            <li key={`${m.statistic}:${m.side}:${m.threshold}`}>
              {m.side === "home" ? home.name : away.name} ·{" "}
              {m.statistic === "corners" ? "corners" : "tirs cadrés"} ≥{" "}
              {m.threshold} : n={m.poisson.quality?.home || 0} / adversaire n=
              {m.poisson.quality?.away || 0} ·{" "}
              {m.poisson.status === "unavailable"
                ? "indisponible"
                : "expérimental"}
              .
            </li>
          ))}
        </ul>
      </details>
    </details>
  );
}
