# Forme provisoire v2

> Base intrinsèque archivée et conservée dans la [V4 dynamique](INDICE_DYNAMIQUE_V4.md). Les indices publics actuels utilisent la V4.

Proposition demandée par le propriétaire : résultats, buts et contexte domicile/extérieur. Version `results-context-v2`, distincte de la formule propriétaire non intégrée. Les poids sont explicites, modifiables dans `src/config/resultsFormModel.js` et ne proviennent pas d’une calibration prédictive. Un changement de formule ou de poids doit changer la version.

Sur chacun des cinq derniers matchs publiés de la saison, toutes compétitions confondues, avec F = buts marqués et A = buts encaissés :

| Contribution | Valeur | Poids |
| --- | --- | --- |
| Résultat | 1 victoire, 1/3 nul, 0 défaite | 55 |
| Différence de buts | (1 + tanh((F−A)/2))/2 | 20 |
| Défense | 1/(A+1) | 10 |
| Attaque | F/(F+2) | 5 |
| Résultat à l’extérieur | 1 victoire, 0,5 nul, 0 sinon | 4 |
| Buts à l’extérieur | F/(F+2), 0 hors extérieur | 3 |
| Clean sheet à domicile | 1 si domicile et A=0, 0 sinon | 3 |

Le total d’un match est la somme des contributions multipliées par leur poids. Les cinq matchs ont le même poids. **Indice = 100 × moyenne des totaux / 97**. Le plafond de 97 est commun : résultat+différence+défense+attaque ≤90 ; les bonus domicile (≤3) et extérieur (≤7) sont mutuellement exclusifs. Le score reste donc dans [0,100] sans renormalisation différente par terrain ni bruit ajouté pour créer des décimales. Certaines contributions atteignent leur plafond seulement à la limite : cinq victoires ordinaires ne valent plus automatiquement 100.

Les buts ont un effet progressivement réduit, pour qu’un 8–0 n’écrase pas la moyenne. Marquer davantage ne diminue jamais la forme et encaisser davantage ne l’augmente jamais. La victoire extérieure reçoit son bonus, les buts extérieurs le leur ; un nul extérieur reçoit un demi-bonus de résultat. Le bonus domicile requiert effectivement zéro but encaissé.

Les matchs complets déduisent le terrain des identifiants domicile/extérieur ; les résultats rapides utilisent le terrain renseigné. Un terrain inconnu ne reçoit aucun bonus, et sa couverture est signalée. Les scores invalides ou moins de cinq résultats rendent l’indice indisponible. Les statistiques avancées manquantes restent nulles et ne participent pas à ce modèle. Les points classiques sur 15 restent une information contextuelle.

L’affichage arrondit à une décimale, les classements conservent la précision. Les anciens snapshots `results-points-v1` ne sont pas réutilisés : la forme est recalculée depuis les résultats actuels. Les groupes de modèles sont séparés. Aucune probabilité de victoire n’est produite ; ce modèle ne corrige pas encore la difficulté des adversaires ou des compétitions.
