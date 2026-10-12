# Activer Calcito V3 avec Supabase

Le frontend reste sur GitHub Pages. Supabase assure la base PostgreSQL, l’authentification et les autorisations. Le backend Render / API-Football n’est plus nécessaire pour ce parcours manuel. Il n’est pas supprimé automatiquement.

## 1. Créer le projet gratuit

1. Ouvrir https://supabase.com/dashboard et se connecter, par exemple avec GitHub.
2. Créer un projet dans une organisation utilisant le plan **Free**. Si une offre payante est imposée, ne pas la valider.
3. Choisir la région proche des visiteurs. Créer le mot de passe de base dans le gestionnaire de mots de passe ; ne pas le mettre dans GitHub ni le communiquer en chat.
4. Attendre que le projet soit disponible.

L’offre gratuite possède des limites de stockage et de trafic et peut suspendre un projet inactif. Vérifier les conditions affichées par Supabase avant de valider. Les données applicatives ne sont pas sauvegardées dans le navigateur ; prévoir des exports réguliers.

## 2. Appliquer le schéma et les protections

1. Ouvrir **SQL Editor → New query** dans le projet.
2. Copier le contenu complet de `supabase/migrations/001_manual_platform.sql` et l’exécuter une seule fois sur ce nouveau projet.
3. Vérifier que les tables ont été créées et que RLS est activé sur chacune.

La migration crée neuf compétitions de référence, sans équipe, saison, match, score ou statistique fictifs. Les prochaines évolutions doivent utiliser de nouvelles migrations versionnées ; ne pas réexécuter la migration initiale sur une base remplie.

## 3. Créer votre seul compte administrateur

1. Dans **Authentication → Users**, utiliser **Add user / Create user** pour créer votre compte e-mail et mot de passe, sans inscription publique depuis le site.
2. Confirmer ce compte dans le tableau de bord si nécessaire.
3. Dans les paramètres des fournisseurs/sign-in d’Authentication, **désactiver les nouvelles inscriptions publiques**. Le site ne propose aucune inscription, mais il faut également désactiver cette possibilité côté service.
4. Dans le SQL Editor, exécuter la requête ci-dessous en remplaçant l’adresse de démonstration par votre adresse réelle :

```sql
insert into public.admin_users(user_id)
select id from auth.users where lower(email)=lower('votre-adresse@example.com')
on conflict(user_id) do nothing
returning user_id;
```

Il faut que la requête renvoie votre identifiant de compte. Zéro ligne signifie que le compte correspondant n’existe pas : ne pas poursuivre en supposant que les droits sont configurés. Vérifier qu’un seul utilisateur est enregistré dans `admin_users`.

La table d’administrateurs ne peut pas être modifiée depuis le navigateur, même par un compte connecté. Aucun e-mail administrateur, mot de passe ou identifiant réel n’est écrit dans le code du site.

Dans **Authentication → URL Configuration**, définir l’URL du site : `https://victorcorreiaensea.github.io/calcito/`. L’application utilise une connexion e-mail/mot de passe ; elle ne configure pas de récupération de mot de passe ou OAuth publics. En cas d’oubli, gérer le compte depuis le tableau de bord Supabase.

## 4. Configurer les deux valeurs publiques du frontend

Récupérer dans **Project Settings / Connect / API** :

- l’URL HTTPS du projet ;
- la clé **publishable** (`sb_publishable_...`), ou la clé legacy **anon**.

**Ne jamais utiliser une clé secret (`sb_secret_...`), service_role, un mot de passe de base ou le mot de passe administrateur dans le frontend.** Le code refuse les types connus de clés serveur, mais cette vérification ne remplace pas RLS.

Dans GitHub : **calcito → Settings → Secrets and variables → Actions → Variables**, créer :

| Nom                             | Valeur                           |
| ------------------------------- | -------------------------------- |
| `VITE_SUPABASE_URL`             | URL HTTPS réelle du projet       |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique publishable ou anon |

Ces valeurs sont conçues pour être visibles dans le navigateur. Toutes les protections doivent donc être actives avant de les publier. Aucune clé secrète serveur n’est nécessaire au site.

Relancer **Actions → Deploy CALCITO to GitHub Pages → Run workflow → main**. Sans ces valeurs, le site présente les résultats comme en préparation et ne permet aucune connexion administrateur ni sauvegarde privée.

Pour le développement local, copier `.env.example` vers `.env.local`, renseigner uniquement ces deux valeurs publiques et exécuter `npm run dev`. `.env.local` est ignoré par Git.

## 5. Initialiser les données réelles

Ouvrir `https://victorcorreiaensea.github.io/calcito/#/admin` et se connecter.

1. **Équipes** : créer les fiches ou importer un CSV d’équipes réel, après aperçu et validation. Les nouvelles équipes importées restent privées.
2. **Saisons & participants** : créer une saison pour chaque compétition, sans écraser les précédentes. Vérifier les règles de points et l’ordre de départage officiels avant de cocher leur confirmation.
3. Choisir les équipes participantes et enregistrer. Les groupes et corrections de points disposent de champs séparés ; chaque correction non nulle exige une justification.
4. Publier les compétitions, saisons et équipes qui doivent être accessibles aux visiteurs.
5. **Saisie rapide** : saisir compétition/saison, journée, date, deux équipes, score et statistiques disponibles. Vérifier la source, puis sauvegarder en brouillon ou publier.

Le raccourci **Entrée** enregistre puis ouvre une saisie vide pour le match suivant. La compétition, la journée, la source et la date restent présélectionnées. La publication rapide est désactivée par défaut. **Tab** permet d’avancer dans les champs ; les sélecteurs d’équipes permettent la recherche. Une seule saisie concerne les deux équipes.

Vingt secondes par match est un objectif ergonomique, pas une durée vérifiée auprès d’un utilisateur réel. Le temps nécessaire pour rechercher les statistiques n’est pas inclus.

Les champs vides restent `null`. Une valeur `0` signifie zéro constaté, jamais une donnée manquante remplacée. Les tirs cadrés ne peuvent pas dépasser les tirs ; notes et possession disposent de bornes.

## 6. Vérifier les autorisations sur le vrai projet

Les tests locaux couvrent le schéma PostgreSQL et les politiques RLS. Ils ne prouvent pas que votre projet distant a été correctement configuré.

Après configuration :

- En navigation privée, vérifier que seules les fiches et rencontres publiées apparaissent.
- Avec votre compte, enregistrer un brouillon : il doit rester invisible en navigation privée.
- Publier une rencontre vérifiée : elle doit apparaître pour les visiteurs et mettre à jour les deux équipes.
- Vérifier qu’un compte non inscrit dans `admin_users` ne peut pas écrire, y compris directement par l’API Supabase. Le SQL/RLS bloque l’opération, indépendamment des boutons de l’interface.
- Vérifier la prévention des doublons et consulter le journal d’audit.
- Tester modification, dépublication et suppression sur un match de contrôle réel ou un brouillon privé, puis vérifier le recalcul du classement.

Ne pas annoncer l’administration opérationnelle tant que ces contrôles n’ont pas été exécutés sur le projet distant.

## Règles et limites actuelles

- Les classements sont reconstruits à partir des matchs publiés. Ils restent **partiels** jusqu’à confirmation des règles, du nombre total de matchs et de la vérification de la saison.
- Départages pris en charge : points, différence de buts, buts marqués, victoires, points et différence de buts sur la mini-ligue des équipes à égalité. Des règles particulières non supportées maintiennent le classement partiel ; ne pas les déclarer confirmées à tort.
- Une modification de match ou statistique invalide la complétude de la saison et les sorties de forme concernées. Les changements de paramètres ou de participants invalident aussi les sorties persistées. Les prévisions originales restent immuables.
- La formule Calcito, les bonus et paramètres restent à fournir dans `src/config/calcitoModel.js`. Aucun indice définitif n’est simulé.
- Le coefficient européen 1,20 ne s’applique qu’aux compétitions confirmées par le propriétaire ; aucun coefficient absent n’est inventé.
- Le modèle probabiliste est absent. Aucune probabilité ou cote n’est affichée ou enregistrée automatiquement.
- Import CSV : 500 lignes / 2 Mo maximum par lot, aperçu des 30 premières lignes et validation de toutes. Chaque match est enregistré atomiquement, mais le lot complet n’est pas une transaction unique : une interruption annonce le nombre enregistré, et un nouvel import détecte les doublons.
- Les listes Supabase sont chargées par pages de 1 000 pour éviter la limite implicite du service. L’interface pagine les matchs, équipes et journaux. Pour des archives dépassant 100 000 enregistrements, il faudra passer à des requêtes filtrées côté serveur ; le code signale cette limite plutôt que tronquer silencieusement.
- Prévoir des exports CSV réguliers. L’application ne fournit pas de sauvegarde externe automatique ni de MFA ; sécuriser votre compte et configurer les protections proposées par Supabase.
