# CALCITO V3.1 — Football Intelligence

## Import CSV et relevé Flashscore

Import de résultats avec aperçu modifiable, association des noms d’équipe, choix ignorer/mettre à jour les doublons, données inconnues NULL et bilan des erreurs/imports partiels. L’onglet Flashscore propose un relevé humain fonctionnel ; aucune extraction automatique non autorisée n’est annoncée. [Guide d’utilisation et limites](docs/IMPORT_MATCHES.md). Aucune nouvelle migration pour cet import.

## Résultats rapides

Deux modes de saisie, adversaires libres, historiques fusionnés, suivi de couverture et clubs européens supplémentaires. Un indice provisoire documenté utilise les résultats, les buts et le terrain ; aucun pourcentage n’est simulé. L’identité noire et bleue est conservée.

Pour activer les nouvelles fonctions dans le projet Supabase existant, appliquer **uniquement la migration 002** suivant [le guide V3.1](docs/V3_1_SETUP.md). Avant activation, les matchs complets restent utilisables.

Plateforme de football sur fond noir, cartes bleu foncé, accents bleu électrique et textes blancs. React/Vite, CSS classique, Lucide React, Supabase. Mascotte originale Calcito : robot sportif en panneaux de ballon, cœur bleu, brassard et crampons.

## Développement et vérifications

Node.js 22.12+ recommandé.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Si le cache npm utilisateur n’est pas accessible : `npm ci --cache /tmp/calcito-npm-cache`.

## Activer la saisie manuelle privée

Suivre [le guide Supabase](docs/SUPABASE_SETUP.md). Il décrit la création du projet gratuit, la migration SQL, l’unique compte propriétaire, les clés publiques et les contrôles de sécurité à réaliser sur le vrai projet.

Variables publiques : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Aucun mot de passe, token serveur ou service_role dans le frontend. Sans configuration, les pages publiques restent accessibles avec un état « résultats en préparation » et l’administration est inactive.

La V3 utilise les données manuelles publiées dans Supabase. Le backend API-Football historique est conservé dans `server/`, mais il n’est pas utilisé par le nouveau parcours public. Aucune migration des anciens exemples ou aucun résultat fictif n’est importé.

## Fonctionnalités

- Accueil avec la mascotte sportive, données disponibles et méthodologie.
- Matchs et résultats publiés, filtres par compétition/saison, pagination.
- Classements reconstruits, règles configurables, rangs partagés, corrections de points justifiées, indication de couverture partielle.
- Classement européen Calcito séparé des classements officiels et des saisons ; indices indisponibles sans modèle réel.
- Équipes, recherche globale, fiches, statistiques sources et historique.
- Comparateur entre championnats avec données absentes explicites.
- Pronostics : modèle en développement ; aucune probabilité ou cote inventée.
- Administration `/calcito/#/admin` : authentification Supabase, autorisations PostgreSQL/RLS, saisie rapide, brouillons, publication, modification, suppression confirmée, gestion du catalogue et des participants.
- Import CSV avec aperçu et contrôle de doublons ; exports ; journal d’audit non modifiable depuis le navigateur.

Le formulaire enregistre un seul match et les statistiques de ses deux équipes dans une transaction. Les blancs restent inconnus ; zéro reste une valeur explicite. Il conserve les paramètres de la journée entre deux saisies. Le délai de 20 secondes est un objectif à valider avec l’utilisateur, sans inclure la recherche des statistiques.

## Architecture

- `supabase/migrations/` : schéma versionné, contraintes, RLS, sauvegardes atomiques, audit et invalidation.
- `src/admin/` : authentification, tableau de bord, saisie, catalogue, import/export.
- `src/services/manualRepository.js` : chargement paginé, accès propriétaire et écritures.
- `src/services/manualAdapter.js` : données publiques normalisées ; masque les brouillons même lorsque le propriétaire consulte une page publique.
- `src/domain/` : validation, calcul des classements et CSV.
- `src/config/calcitoModel.js` : interface des modèles, sans formule inventée.
- `src/engines/` : préparation de la forme et validation des futures probabilités.
- `src/pages/` et `src/components/` : parcours publics et composants réutilisables.
- `tests/` : moteurs, domaines, données et tests PostgreSQL/RLS avec PGlite.
- `public/images/mascot/` : image effectivement générée et intégrée. Les variantes utilisent actuellement la même pose ; d’autres poses officielles pourront la remplacer.

La mascotte est une illustration de marque. Elle ne prétend pas exécuter un modèle d’analyse déjà disponible. Les polices sont locales via Fontsource, l’administration est chargée à la demande et les bibliothèques sont séparées dans le build.

## Publication GitHub Pages

Vite conserve `base: '/calcito/'`. `HashRouter` permet les routes et leur rafraîchissement sans règle serveur.

Le workflow `.github/workflows/deploy.yml` installe, teste puis publie `dist/`. Dans **Settings → Pages**, sélectionner **GitHub Actions**. Les deux variables publiques Supabase sont transmises au build si elles ont été configurées ; sinon le frontend est publié avec l’administration inactive.

Adresse : https://victorcorreiaensea.github.io/calcito/

Le déploiement du frontend ne crée pas le projet Supabase et ne prouve pas que les autorisations distantes fonctionnent. Les tests locaux PostgreSQL et les tests navigateur doivent être distingués de la validation d’un projet distant réellement configuré.

### Six championnats 2026–2027

Préparation privée des 78 clubs manquants et import d’un relevé **partiel** de 348 résultats, avec contrôle des correspondances et doublons. L’indice résultats provisoire (résultats, buts et terrain sur les cinq derniers matchs) est distinct de la formule propriétaire. Voir [le bilan et la procédure](docs/SIX_CHAMPIONNATS_2026_2027.md). Aucune nouvelle migration n’est requise.

## Saisie par journée et forme provisoire v2

Dans l’administration, **Saisie par journée** prépare une grille de matchs sans inventer d’affiches. Seules les lignes remplies sont enregistrées en brouillon. Voir [la saisie](docs/SAISIE_PAR_JOURNEE.md) et [la formule provisoire v2](docs/FORME_PROVISOIRE_V2.md). Aucune migration supplémentaire n’est nécessaire.
