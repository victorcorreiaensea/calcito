import { useState } from "react";
import { useFootball } from "../hooks/useFootball";
import { footballService } from "../services/footballService";
import {
  PageHeading,
  DataState,
  TeamLink,
  Notice,
} from "../components/FootballUI";
import { CompetitionSelect, SourceCaption } from "../components/DataContext";
import { Ranking } from "./Home";

export default function Standings() {
  const [competition, setCompetition] = useState("");
  const demo = footballService.mode === "demo";
  const state = useFootball("standings", competition, {
    enabled: !demo && Boolean(competition),
  });
  return (
    <section className="container page-content">
      <PageHeading
        label="LA SAISON EN PERSPECTIVE"
        title="Classements"
        description="Les classements officiels et l’indice de forme répondent à deux questions différentes. Les points du championnat ne mesurent pas la dynamique récente."
      />
      {demo ? (
        <>
          <Notice>
            Données indisponibles : aucun classement officiel n’est connecté. Le
            tableau ci-dessous illustre uniquement des indices de forme fictifs.
          </Notice>
          <Ranking />
        </>
      ) : (
        <>
          <div className="filter-bar">
            <CompetitionSelect
              value={competition}
              onChange={setCompetition}
              all={false}
            />
          </div>
          {!competition ? (
            <Notice>
              Sélectionnez une compétition pour afficher son classement
              officiel.
            </Notice>
          ) : (
            <DataState {...state} empty={state.result?.data.length === 0}>
              <div className="table-scroll">
                <table className="official-table">
                  <caption>
                    Classement officiel de la compétition sélectionnée
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "#",
                        "Équipe",
                        "MJ",
                        "V",
                        "N",
                        "D",
                        "BP",
                        "BC",
                        "Points",
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.result?.data.map((row) => (
                      <tr key={row.team.id}>
                        <td>{row.position}</td>
                        <td>
                          <TeamLink team={row.team} />
                        </td>
                        {[
                          "played",
                          "won",
                          "drawn",
                          "lost",
                          "goalsFor",
                          "goalsAgainst",
                          "points",
                        ].map((key) => (
                          <td key={key}>{row[key] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SourceCaption result={state.result} />
            </DataState>
          )}
        </>
      )}
    </section>
  );
}
