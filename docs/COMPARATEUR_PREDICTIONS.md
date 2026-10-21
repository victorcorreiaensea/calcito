# Comparateur : probabilités et simulations

## Analyse préalable et périmètre

Le comparateur possédait déjà la sélection de clubs, les saisons, les statistiques comparatives, les courbes, les contributions et l’historique publié. Ces fonctions restent accessibles dans les panneaux repliables. `MatchPreview.jsx`, `MatchForecast.jsx`, `calcitoEngine.js`, les tables Supabase et les opérations de l’Arène sont inchangés. Le panneau serveur existant reste disponible pour une rencontre réelle.

`predictionEngine.js` fournit déjà la validation 1/N/2 et les cotes théoriques : le nouveau moteur réutilise ces fonctions sans changer le contrat des modèles calibrés existants. Le modèle SQL `_arena_probs` utilise des moyennes de buts d’une population et les cinq derniers résultats ; cette structure Poisson est reprise dans une version frontend expérimentale distincte, sans toucher aux cotes de tickets ni à leur validation financière.

## Modes

- **Match réel** : uniquement une rencontre future publiée, avec équipes domicile/extérieur, compétition, saison et date issues du calendrier existant. Aucun match fictif n’est persisté. Les liens historiques `?team=…&against=…&match=…` restent compatibles ; une rencontre disparue ou commencée ne produit pas de pronostic rétroactif.
- **Simulation libre** : deux clubs distincts, choix du domicile A, du domicile B ou d’un terrain neutre. Aucun identifiant de match artificiel ni cote commerciale. Les anciens liens avec deux équipes sans rencontre ouvrent ce mode.

La source reste `footballService → manualAdapter → publicDataset → Supabase`. Le moteur ne lit ni une clé de service ni un jeu de données de remplacement. Il est consultable sans authentification.

## Modèle expérimental `poisson-comparator-v1`

Ce modèle ne transforme jamais l’indice Calcito en probabilité. Les paramètres proposés sont fixes, publics et distincts de la formule de forme : cinq résultats récents par équipe, au moins trente matchs pour chaque compétition de référence et mélange de 50 % de population / 50 % de performances récentes.

Les observations utilisent les scores finaux publiés. Une saisie rapide n’est utilisable que si son adversaire est identifié, son terrain connu et son championnat rattachable sans ambiguïté à une saison publiée. Les miroirs sont dédupliqués par compétition/saison/jour/équipes ; un résultat détaillé a priorité. Des miroirs contradictoires sont exclus. Aucun tir, corner, score ni adversaire manquant n’est inventé.

Pour chaque club, on calcule l’attaque (buts marqués) et la défense (buts encaissés) sur les cinq résultats antérieurs. Lorsque l’adversaire possède cinq observations disponibles avant la rencontre historique considérée, ses moyennes corrigent ces buts : facteur `(moyenne adverse + moyenne de référence) / (2 × moyenne de référence)`, borné entre 0,5 et 2. Sans cet historique, l’observation reste non corrigée. Le panneau technique donne le nombre de corrections effectivement possibles.

Pour A et B :

- `λA = 0,5 × moyenne de référence A sur le terrain choisi + 0,5 × (attaque A + défense B) / 2`.
- `λB = 0,5 × moyenne de référence B sur le terrain choisi + 0,5 × (attaque B + défense A) / 2`.
- Les intensités sont bornées entre 0,05 et 6 buts. En terrain neutre, la référence est la moyenne domicile/extérieur. Le modèle ne calibre pas les différences de niveau entre championnats : cette limite est indiquée lors des simulations concernées.

Les deux distributions de Poisson sont combinées en une matrice 0…40 buts puis normalisées. Toutes les probabilités dérivent de cette même matrice : 1/N/2, BTTS oui/non, chaque équipe marque/ne marque pas, over/under 1,5, 2,5 et 3,5. Les événements binaires sont complémentaires. L’arrondi 1/N/2 emploie la méthode des plus forts restes pour afficher exactement 100,0 %. La cote théorique vaut `1 / p` ; une probabilité nulle ou une cote non finie affiche « — ».

L’hypothèse d’indépendance des buts et les paramètres fixes ne constituent pas une certification prédictive. Blessures, compositions, fatigue, ajustement du niveau des championnats et corrélation des petits scores ne sont pas modélisés. Les corners et tirs cadrés restent indisponibles : disposer de quelques valeurs ne suffit pas à valider un modèle de ces marchés. Aucune donnée individuelle de joueur n’est disponible.

## Chronologie et validation

Pour une analyse, la coupure est l’instant courant, au plus tard le coup d’envoi. Les observations sont limitées à la saison sélectionnée et aux jours UTC strictement antérieurs. La date de disponibilité est le maximum de `verified_at`, `updated_at` et du coup d’envoi ; une correction ou une importation postérieure à la coupure est exclue. Pour les saisies rapides, `updated_at` remplit ce rôle. Cette règle est volontairement conservatrice : une importation récente d’anciens scores ne permet pas de prétendre qu’ils étaient enregistrés avant les matchs historiques.

Le rejeu historique utilise au maximum les soixante dernières rencontres candidates, sans injecter leurs résultats dans leurs propres prévisions. Il calcule le Brier multiclasse 1/N/2 non divisé par trois (0 à 2), une référence fondée sur les fréquences strictement antérieures, le Brier moyen des six événements binaires (0 à 1) et dix tranches de calibration. Les prévisions non calculables sont ignorées avec un effectif réel affiché. Moins de trente rencontres évaluables signifie validation insuffisante ; même au-delà, le rejeu n’est pas présenté comme une certification hors échantillon. Aucun pourcentage de confiance arbitraire.

Il reste à construire un corpus temporel suffisamment ancien, une comparaison hors échantillon par championnat et une éventuelle sélection/estimation de paramètres sur une fenêtre d’entraînement distincte. Les tests synthétiques vérifient l’algorithme, pas sa précision commerciale.

## Cotes externes : interface préparée, aucun fournisseur connecté

`externalOdds.js` expose une fabrique injectable. Un futur adaptateur backend autorisé doit implémenter `getQuotes({ identity, signal })`, après avoir résolu exactement les identifiants du fournisseur vers les UUID Calcito. L’identité comprend match, clubs dans leur ordre domicile/extérieur, compétition, saison et coup d’envoi ISO. Une heure inconnue ou un match commencé est refusé.

Chaque cote comporte `match`, `bookmaker`, `market`, `selection`, `decimal`, `quotedAt`. Les marchés/sélections sont contrôlés ; les cotes non finies ou ≤ 1, les identités différentes, les dates futures et les données de plus de cinq minutes sont exclues. La réponse ajoute `retrievedAt` et le fournisseur déclaré. Les erreurs n’empêchent pas les estimations locales. Aucun scraping, aucune clé frontend et aucune dépendance payante ne sont ajoutés. Aucun accès Winamax n’est prétendu.

La comparaison prépare la probabilité implicite brute `1 / cote`, la cote théorique `1 / p` et l’écart théorique `p × cote − 1`. Ce ne sont ni une probabilité débarrassée de la marge du bookmaker, ni un gain garanti. Le mode simulation n’appelle pas ce service et n’affiche jamais sa section commerciale.

## Vérifications

Tests unitaires : cohérence de tous les marchés, zéro but, arrondis, données manquantes, saisons/chronologie, invariance aux indices de forme, miroirs, terrain neutre, Brier/calibration et filtrage des cotes. Vérifications navigateur : deux modes, vrai calendrier, terrain, développement des marchés et des statistiques, absence de cotes fictives, navigation et responsive. Exécuter `npm test` puis `npm run build` ; la publication du site n’écrit aucune prévision dans Supabase et ne modifie aucune position de l’Arène.
