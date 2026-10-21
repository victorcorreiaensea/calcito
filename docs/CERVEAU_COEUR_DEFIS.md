# Calcito V1 — Cerveau, Cœur et Défis

Cette livraison est structurelle : aucun nouveau modèle, aucune nouvelle économie, aucune migration et aucun historique de confrontation simulé.

## Réutilisation

- `goalPredictionEngine`, `predictionEngine`, `calcitoEngine` et `dynamicFormEngine` restent inchangés. Les probabilités expérimentales ne deviennent pas « officielles » ou validées par le simple changement de structure.
- `predictionService` assemble une vue commune des indices existants, prévisions, événements, cotes théoriques et évaluations historiques. Le calcul du top 3 déjà présent est déplacé depuis le composant, sans nouvelle stratégie de classement. Les statistiques détaillées et les contributions gardent leurs composants et services actuels.
- `externalOdds.compareOdds` reste l’évaluateur mathématique des cotes. Aucune intégration Winamax, aucun nouveau prix et aucune modification des fournisseurs.
- L’Arène conserve ses RPC, ses plafonds, sa marge d’acceptation, ses mises, ses règles de validation et ses opérations de portefeuille. Son accès reste proposé depuis le comparateur. Les défis existants ne sont pas présentés comme une négociation limitée à trois tentatives.

## Espaces du comparateur

1. **Analyse des équipes** : statistiques, forme, historique et sources existants, repliables.
2. **Prédictions Calcito** : moteur et marchés existants, top 3 actuel et emplacement « En développement » pour les meilleurs écarts de cote. Le futur classement des écarts est vide : aucun prix de remplacement.
3. **Défier Calcito** : emplacement désactivé pour choisir un événement et proposer une cote. La limite prévue est trois ; les tentatives restantes restent « — » puisque la négociation n’est pas activée. L’utilisateur peut toujours ouvrir les défis existants de l’Arène.
4. **Personnalité et réactions** : mascotte existante, humeur stable « Scientifique », commentaire de présentation, verdict statistique calculé et emplacement distinct pour une décision personnelle encore indisponible.

## Séparation Cerveau / Cœur

`calcitoPersonality` contient les cinq identités prévues : Scientifique, Euphorique, Frustré, Méfiant, Passionné. Le défaut est fixe, sans hasard, sans fausses réussites/erreurs passées et sans lecture d’un portefeuille. Les quatre autres humeurs sont des états de présentation préparés, sans déclenchement automatique.

La personnalité reçoit un texte de verdict ; elle n’a aucun accès aux fonctions de calcul ni aux probabilités. La décision émotionnelle reste `{ status: 'development', decision: null, reason: null }`. Aucun pari défavorable n’est accepté par émotion dans cette V1.

## Contrat de négociation : préparé, pas déployé côté serveur

`negotiationContract` décrit et teste un protocole futur ; ce n’est ni une API active, ni un contrôle de sécurité serveur. Le champ `authority: 'server'` est un marqueur de format, pas une preuve d’authentification. L’interface ne crée aucune négociation, ne stocke aucun compteur local et n’envoie aucune offre à Supabase.

Une réponse future doit contenir :

- UUID de négociation, propriétaire, match, événement et révision.
- Référence scientifique figée : identifiant de la cote serveur, version du modèle, révision du match, probabilité, date du calcul.
- Historique ordonné d’au plus trois tentatives : numéro, nonce de demande unique, cote proposée, horodatage, verdict scientifique et décision personnelle avec explication.
- Statut `open`, `accepted` ou `exhausted`. Une acceptation clôt immédiatement l’historique ; trois refus l’épuisent.

La préparation d’une demande ne modifie ni l’historique ni son compteur. Une cote invalide est rejetée avant toute consommation. Les bornes 1,01…1000 et le format à vingt décimales maximum reprennent le domaine d’offres de l’Arène existante ; la demande conserve la chaîne décimale d’origine pour le futur serveur. Une demande porte l’identifiant de négociation, la révision attendue, un nonce et la cote ; elle ne transmet ni humeur, ni probabilité choisie par le navigateur, ni décision d’acceptation.

Le verdict scientifique est le signe de `p × cote − 1`, du point de vue de **Calcito qui prend le pari** dans le mode bookmaker existant. Une tolérance de 10⁻¹² sert uniquement aux arrondis numériques autour de zéro ; ce n’est pas une marge d’acceptation. Le verdict n’est jamais une instruction de placement : les politiques de marge, de Kelly, d’incertitude et de risque restent exclusivement celles du serveur actuel. Une offre mathématiquement favorable peut donc être refusée pour ces raisons. Le protocole distingue une éventuelle future exception émotionnelle, avec explication explicite, sans la produire ni l’activer.

## Travail serveur nécessaire avant activation

Une **nouvelle** migration et des RPC authentifiées seront nécessaires ; aucune migration existante n’a été modifiée ici :

1. Stocker négociations et tentatives avec RLS par propriétaire, contraintes et références aux matchs/cotes/versions. Recharger la négociation persistée à chaque ouverture et rafraîchissement ; ne pas recréer un compteur à partir d’un UUID choisi par le navigateur.
2. Démarrer/récupérer une négociation autorisée pour l’utilisateur, le match et l’événement exact. Résoudre l’événement public vers un marché effectivement pris en charge par une cote serveur validée ; refuser les marchés non disponibles. Figer la probabilité côté serveur, jamais depuis le modèle expérimental frontend.
3. À chaque proposition : authentification, contrôle du propriétaire, expiration du devis et du coup d’envoi, révision du match, validation des entrées, verrou transactionnel, révision attendue et idempotence du nonce. Rejeter les entrées invalides sans tentative, refuser toute quatrième proposition et toute suite après acceptation. Conserver tous les refus valides et leurs explications.
4. Réutiliser les décisions et placements existants de l’Arène dans la même transaction que l’acceptation et son historique, avec le même mécanisme d’idempotence. Aucun second portefeuille ni nouvelle règle de mise. Une réponse réseau incertaine doit être récupérée par nonce avant toute nouvelle offre.
5. Tester concurrence, reconnexion, rechargement, multi-onglets, fraude d’identité/probabilité, expiration, troisième tentative et double validation. Les tests frontend de contrat ne prouvent aucun de ces contrôles serveur.

Les classements élargis, les déclencheurs d’humeur, les décisions irrationnelles et la mémoire des confrontations restent des évolutions ultérieures. Cette livraison n’active aucune de ces étapes.
