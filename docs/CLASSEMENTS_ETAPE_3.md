# Étape 3 — les prédictions et les cotes intéressantes

## Fonctionnement

Deux sections compactes du comparateur remplacent les anciens trois résultats expérimentaux mis en avant et le panneau « écarts de cote en développement » :

- **Les prédictions de Calcito** : trois événements officiels maximum, classés par probabilité et diversifiés.
- **Les cotes intéressantes** : trois événements maximum, classés par écart `probabilité officielle × cote proposée − 1`.

Le modèle expérimental du comparateur conserve ses probabilités et ses autres marchés. Ses cotes théoriques ne sont plus affichées : elles ne sont pas autorisées comme cotes officielles. Le moteur de recherche de l’étape 2 reste séparé. Ni nouvelle formule, ni nouvelle calibration, ni conversion d’indice de forme en probabilité.

## Source admissible et disponibilité

L’unique source officielle actuellement réutilisable est la réponse **authentifiée** du RPC existant `arena_quote`, version `poisson-goals-v1`. Le serveur ne délivre ses quotes que si son modèle est activé après sa validation existante, et uniquement pour les marchés présents dans son rapport de calibration. Le client n’active ni ne calibre ce modèle.

Dans un match réel, l’utilisateur connecté clique sur **Charger les prévisions officielles**. Le chargement est partagé avec le bouton déjà présent dans « Prévisions serveur et accès à l’Arène » : aucune double requête automatique. Attention : le RPC existant crée ses références de cotes virtuelles temporaires, comme avant ; il ne s’agit pas d’un RPC purement en lecture. Cette opération reste explicite ; aucune nouvelle écriture, table, RPC ou opération de mise n’est ajoutée.

Contrôles à la réception :

- Rencontre publiée à venir, horaire précis, utilisateur courant.
- Même identifiant de match, coup d’envoi et révision `updated_at`.
- Version officielle autorisée, même calibration pour tous les événements.
- Probabilités numériques cohérentes ; 1/N/2 totalisant 1.
- Chaque marché doit posséder sa propre quote admissible renvoyée par le serveur : les absents ne sont pas reconstitués depuis le modèle expérimental.
- Complémentaires cohérents, seuils de buts ordonnés, doublons contradictoires rejetés.
- Référence créée dans le passé, non expirée, durée au plus 15 minutes et expiration avant le coup d’envoi.

Les classements sont retirés à l’expiration, lors d’une erreur de rechargement ou d’un événement `calcito:data-changed`. Les réponses tardives après un changement de rencontre, révision, connexion ou mode sont ignorées. Les cotes manuelles sont isolées par comparaison et utilisateur et restent uniquement en mémoire.

**Disponibles conditionnellement** : 1/N/2, équipe qui marque/ne marque pas, BTTS oui/non et totaux 1,5/2,5/3,5, uniquement parmi les quotes effectivement autorisées par le serveur. Le calcul de cote théorique est alors `1/p`, avec `null` pour une probabilité nulle.

**Indisponibles** : tirs cadrés, corners, joueurs, modèles de recherche de l’étape 2, versions inconnues, simulations sans source officielle validée, prévisions expirées ou historique insuffisant. En visiteur, les estimations expérimentales restent consultables mais aucun Top 3 officiel n’est fabriqué. Il faut se connecter pour accéder à la source serveur existante. Un serveur dont le modèle est désactivé renvoie sa raison ; les classements restent vides. Cette étape ne l’active pas.

## Tri et diversité

Probabilités : ordre décroissant, puis identifiant ASCII en cas d’égalité. Sélection gloutonne, **une sélection maximum par famille**, jusqu’à trois : résultat 1/N/2, buts de l’équipe A, buts de l’équipe B, BTTS, total de buts. Tous les seuils de totaux appartiennent à la même famille. Les complémentaires ne peuvent donc pas occuper deux places. Ce classement privilégie les plus fortes probabilités sous cette contrainte de diversité ; ce n’est pas nécessairement le trio brut de probabilités le plus élevé. Aucune place vide n’est complétée artificiellement.

Cotes : écart décroissant, puis identifiant, cote décroissante et provenance pour départager les égalités. Un seul résultat par événement, donc la meilleure cote proposée parmi celles admissibles. La diversité par famille n’est pas imposée ici : ce classement présente les écarts disponibles. Les écarts négatifs et nuls sont autorisés et clairement qualifiés « défavorable » / « nul » ; ils ne deviennent pas des recommandations positives. Aucun gain garanti.

## Cotes manuelles et externes

Une cote manuelle décimale, virgule ou point, doit être numérique, finie et strictement supérieure à 1. Elle peut être ajoutée/remplacée ou retirée pour chaque événement. Sans probabilité officielle, elle reste visible comme saisie manuelle mais aucun écart n’est produit.

Les cotes externes passent par l’adaptateur déjà présent : même rencontre, marché reconnu, fournisseur et bookmaker identifiés, date non future et fraîcheur de cinq minutes maximum. **Aucun fournisseur n’est configuré dans le projet** ; aucune cote externe ne sera donc inventée pour remplir ce classement. Aucun ajout de bookmaker, aucune connexion Winamax et aucun scraping. Les cotes virtuelles générées par l’Arène fournissent des références de probabilité : elles ne sont jamais transformées en cotes commerciales proposées.

## Contrat préparé pour l’étape 4

`createComparisonRankings` dans `predictionService.js` expose les résultats purs de `predictionRankings.js`. Chaque ligne du classement de valeur contient :

```text
schemaVersion: 1
contextId: match:<id> ou identifiant déterministe de simulation
matchId
marketId / selection / label
 officialProbability / theoreticalOdds / offeredOdds
oddsSource: { type: manual | external-verified, ...provenance }
edge / assessment
modelVersion / probabilitySource
quoteId
predictionRef: { modelAt, matchRevision, createdAt, expiresAt }
```

`marketId` et `selection` reprennent la clé événement du serveur (ex. `over_2_5`) : aucune correspondance implicite par nom d’équipe. Une simulation possède un identifiant distinct selon les équipes, la saison et le terrain, mais ne produit pas de contrat officiel sans source admissible.

Ce contrat est une **préparation de données en mémoire**, pas une autorisation de pari. La future négociation devra revalider côté serveur propriétaire, quote, révision, expiration et conditions du modèle ; elle ne pourra pas faire confiance au contenu du navigateur. Aucun compteur de tentatives, acceptation/refus, décision émotionnelle ou mouvement de portefeuille n’est développé. `negotiationContract.js` et `calcitoPersonality.js` sont inchangés. Les anciens champs expérimentaux de `predictionService` restent disponibles pour compatibilité, mais ne sont pas consommés par ces classements officiels.

## Fichiers

- `src/services/predictionRankings.js` : normalisation de la source officielle, admissibilité, tri, diversité, comparaison de cotes, contrat.
- `src/services/predictionService.js` : interface des classements et identifiant de contexte ; moteurs inchangés.
- `src/hooks/useOfficialForecast.js` : chargement explicite partagé, états, invalidation, protection contre réponses tardives.
- `src/components/PredictionRankings.jsx` : deux sections, saisie de cotes et états chargement/absence/erreur/expiration.
- `src/components/ComparatorForecast.jsx` : intégration, retrait des anciens highlights expérimentaux et des cotes théoriques non validées.
- `src/components/MatchForecast.jsx` : réutilisation du même chargement, sans changement de calcul serveur.
- `src/pages/Compare.jsx` et `Compare.css` : passage du contrôleur, styles compacts et responsive.
- `tests/prediction-rankings.test.js` : tests dédiés.

Aucune migration ni modification des règles de l’Arène, des Calcithunes, de la personnalité ou de la négociation.

## Limites statistiques

Un modèle validé par les règles existantes du serveur reste une estimation, pas une certitude. Les probabilités de buts supposent une distribution de Poisson et l’indépendance des scores ; la calibration n’intègre pas nécessairement blessures ou compositions. Un écart favorable dépend entièrement de cette probabilité et de la cote saisie : il n’établit ni un gain futur ni une opportunité commerciale vérifiée. Les seuils/coefficients et la validation serveur existants ne sont pas modifiés pour remplir les Top 3.

## Vérifications exécutées

- `npm test` : **133 tests réussis**, dont 11 tests dédiés aux classements ; tests SQL et financiers existants conservés.
- `npm run build` : réussi.
- Chromium, données et session synthétiques interceptées : visiteur et connecté ; deux modes ; chargement explicite ; trois prédictions officielles maximum ; saisie manuelle et signe de l’écart ; erreurs/rechargement ; disparition à expiration et invalidation ; aucun appel de mise ajouté ; mobile/ordinateur 320–1440 px sans débordement global ni erreur JavaScript.

Ces tests ne constituent pas une nouvelle validation statistique du modèle réel et n’activent aucune calibration de production.
