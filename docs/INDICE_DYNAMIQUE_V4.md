# Indice dynamique Calcito V4

Version `results-relative-v4`, ajout relatif à la base `results-context-v2`. Identité noire et bleue conservée. Aucun match, statistique, fiche ou résultat existant n’est modifié. Aucune migration Supabase ni service payant supplémentaire n’est nécessaire.

## Trois couches

1. **Performance intrinsèque** : le moteur v2 existant donne une performance de match dans [0,100], issue des résultats, buts et terrain. Ses poids et sa normalisation restent inchangés.
2. **Performance relative** : références propres et adverses figées avant la rencontre, résultat attendu, surprise bornée, ajustement plafonné. La performance finale reste dans [0,100].
3. **Forme** : moyenne des cinq dernières performances finales ; un ajustement est intégré une seule fois et sort de cette fenêtre avec son match.

Avec S et O les indices avant match, h = +4 domicile / −4 extérieur :

- Attente E = 1 / (1 + exp(−(S − O + h)/18)). C’est un score attendu de résultat, **pas une probabilité de victoire**.
- Résultat R = 1 victoire, 0,5 nul, 0 défaite. La convention du résultat relatif est distincte des points de championnat conservés dans le contexte.
- Surprise = R − E, dans [−1,1], affichée de −100 à +100.
- Ajustement demandé = 8 × surprise, dans [−8,+8].
- Performance finale = min(100, max(0, performance intrinsèque + ajustement)).
- Ajustement effectivement appliqué = performance finale − performance intrinsèque. La différence vient éventuellement du plafond ou du plancher.

La borne ±8 porte sur une performance de match : son influence directe dans une fenêtre complète de cinq matchs est au plus ±1,6. La **variation totale** après match remplace aussi une ancienne performance dans la fenêtre : elle peut être plus importante et n’est jamais appelée « bonus d’exploit ».

Ces paramètres sont une proposition explicite, non calibrée, dans `src/config/dynamicFormModel.js`. Les statistiques avancées et le coefficient européen 1,20 ne participaient pas à la base provisoire v2 : ils ne sont pas ajoutés arbitrairement ici. Les statistiques restent disponibles comme informations complémentaires ; la configuration du futur moteur propriétaire est conservée.

## Initialisation

Référence neutre 50 au démarrage de chaque saison, toutes compétitions enregistrées de cette saison réunies. Pour n<5 résultats, l’estimation est (somme des performances connues + (5−n)×50)/5. Il s’agit d’un prior, **pas de matchs ou de résultats inventés**. Les points de courbe initialisés sont creux et signalés ; les références avant match sont étiquetées. Ces estimations ne classent pas les équipes : le score public courant reste indisponible avant cinq résultats exploitables.

Un adversaire sans identité confirmée ne reçoit pas une force supposée : référence, surprise et ajustement restent nulls. Le match conserve seulement sa performance intrinsèque. Les résultats rapides affectent uniquement l’équipe suivie, conformément au modèle de saisie existant ; ils ne créent pas un historique supplémentaire pour l’adversaire.

## Chronologie

Les matchs terminés publiés sont rejoués dans l’ordre croissant du temps, avec une fenêtre indépendante par équipe. La même référence avant match est utilisée pour calculer chaque côté, puis les deux historiques sont mis à jour. Le match courant n’entre jamais dans sa propre référence et les événements postérieurs n’entrent jamais dans une référence ancienne.

Les coups d’envoi simultanés partagent un état figé. Si une date contient une heure manquante, toute cette journée de stockage UTC utilise les références disponibles avant la journée ; ce choix conservateur est signalé. Plusieurs rencontres impliquant une même équipe dans ce lot rendent l’ordre ambigu : elles sont écartées du calcul, sans supprimer les résultats enregistrés. Les résultats invalides ou datés dans le futur sont écartés. La date de connaissance est l’option `asOf` du moteur, actuelle par défaut ; elle peut être fixée pour reproduire un relevé historique.

Le résultat comporte les deux côtés d’un match complet, chacun avec `before`, `after`, `opponentBefore`, `delta`, initialisation, performance intrinsèque, surprise, ajustement demandé/appliqué et version. Ces champs sont reconstruits depuis les données sources ; ils ne réutilisent pas l’indice actuel pour qualifier une ancienne performance.

## Exploits

Un label exige **cinq résultats antérieurs pour chaque équipe**. Les références initialisées ne suffisent pas.

| Label | Résultat | Écart adverse minimal | Surprise minimale |
| --- | --- | --- | --- |
| Exploit Calcito | Victoire | 20 | 0,35 |
| Belle performance | Victoire | 5 | 0,20 |
| Nul arraché | Nul | 15 | 0,15 |

Le supplément est continu ; ces seuils servent uniquement à nommer une performance. Une victoire attendue garde une valeur positive, sans label d’exploit artificiel.

## Historique et corrections

Les indices ne sont pas stockés dans de nouvelles tables. La reconstruction pure est déterministe pour les mêmes données, version et date de connaissance. Le cache est lié au jeu de données lu : publication, correction, import ancien ou conversion de résultat rapide invalident la lecture et déclenchent un nouveau replay. Les effets d’une correction se propagent chronologiquement aux rencontres suivantes, y compris aux futurs adversaires ; les rencontres antérieures ne changent pas.

Le moteur accepte explicitement `modelVersion: 'results-relative-v4'` ou `'results-context-v2'`. La v2 historique reproduit la base sans surprise. Une version inconnue est refusée. Les sources et anciennes formules restent conservées ; une future version doit ajouter sa propre configuration et son moteur, sans modifier les archives v2/v4. Les groupes de comparaison et les courbes publiques actuelles utilisent uniquement v4.

Dans **l’historique des matchs**, l’affichage principal montre les indices avant la rencontre. Les indices après match sont séparés, avec leur variation. Une correction historique peut recalculer les références concernées ; elles ne sont jamais remplacées par les indices actuels.

## Graphiques et accessibilité

Courbes alignées sur les dates réelles, axe vertical 0–100. Comparateur bleu continu / ambre discontinu : la couleur n’est pas le seul repère. Survol, clic, focus clavier et sélection native de rencontre donnent les détails ; précédent/suivant facilite l’usage mobile. Filtres 5, 10 et saison entière. Les grandes variations (≥8 points) ont des points élargis. Les segments relient des observations, sans inventer des indices entre deux matchs.

Les périodes de cinq ou dix matchs des deux équipes peuvent couvrir des dates différentes. Le comparateur affiche les progressions individuelles avec leurs dates, puis compare aussi une période commune lorsque celle-ci existe. À chaque borne commune, il utilise la dernière mesure complète déjà connue, sans emprunter un point futur ni inventer une mesure quotidienne. Sans période commune suffisante, aucun classement de progression n’est donné. Les performances marquantes utilisent la période affichée et gardent séparées surprise, ajustement et variation totale.

Les contrôles automatisés couvrent les bornes, favoris/outsiders, nuls, attentes domicile/extérieur, absence de données, initialisation, suppression des bonus sortis de la fenêtre, absence de fuite future, simultanéité, corrections/imports anciens, indépendance de l’ordre des données et reconstruction v2. Les tests de navigateur utilisent uniquement des données locales simulées ; ils ne modifient pas Supabase en production.
