# CALCITO V2 — Football Intelligence

Plateforme React/Vite, CSS classique et Lucide React. La V1 est conservée et complétée par des pages Matchs, Classements, Équipes (avec fiches), Comparateur, Pronostics et Méthodologie.

## Démarrer

Node.js 22.12+ recommandé (Node 20.19+ compatible avec Vite).

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Si le cache npm utilisateur n’est pas accessible : `npm ci --cache /tmp/calcito-npm-cache`.

## État réel de la V2

- Sans backend configuré : **mode démonstration**. Toutes les équipes, dates, résultats et indices d’illustration sont fictifs et centralisés dans `src/demoData.js`.
- Aucun classement officiel, aucune statistique de match, aucun bonus ni aucune note d’équipe ne sont fabriqués.
- `calcitoEngine` prépare les cinq derniers matchs terminés, les résultats du point de vue de l’équipe et la traçabilité. Les données manquantes, les coefficients non spécifiés ou l’absence de formule bloquent le score définitif.
- La constante européenne 1,20 n’est appliquée à aucune compétition par défaut : les identifiants concernés doivent être confirmés par le propriétaire.
- Les pronostics affichent **Modèle en développement**. Il n’existe pas encore de modèle probabiliste calibré. Aucune probabilité ni cote n’est présentée.
- `predictionHistory` prévoit un stockage local injectable, les probabilités originales, le résultat final et une évaluation Brier (somme non normalisée sur les trois issues). Aucun faux historique n’est préchargé.
- La mascotte utilise un pictogramme de remplacement, sans requête vers des images absentes. Ajouter les visuels officiels dans `public/images/mascot/` et renseigner `mascotImages`.

## Connecter API-Football sans exposer la clé

GitHub Pages héberge uniquement le frontend statique. Le backend Node fourni dans `server/` doit être hébergé séparément sur une plateforme supportant Node.js et HTTPS.

1. Déployer `server/index.js` avec Node.js 22. Le backend n’a pas de dépendance npm dédiée.
2. Dans les paramètres **secrets du serveur**, définir `API_FOOTBALL_KEY` avec la clé du compte API-Football. Ne jamais la mettre dans une variable `VITE_*`, un commit ou les fichiers publics. Seule l’API directe API-Sports (`v3.football.api-sports.io`) est prise en charge ici ; les comptes RapidAPI nécessitent un adaptateur serveur distinct.
3. Définir `FRONTEND_ORIGIN=https://victorcorreiaensea.github.io` et, si l’hébergeur ne le fournit pas, `PORT=8787`.
4. Lancer `npm run api` (ou `node server/index.js`). `/health` indique si la clé est présente, sans la révéler. Sans clé, les routes football renvoient 503.
5. Définir la variable publique `VITE_FOOTBALL_PROXY_URL` avec l’adresse HTTPS du backend, sans clé ni paramètres. Pour GitHub Actions : **Settings → Secrets and variables → Actions → Variables → New repository variable**. Le workflow transmet cette variable au build.
6. Recompiler / relancer le workflow. Le frontend passe en mode réel et affiche les sources et dates. Un échec du backend produit « Données indisponibles » ; il ne bascule jamais silencieusement vers des données fictives.

Le backend limite les requêtes entrantes par adresse réseau, utilise une liste fermée de routes, un cache d’une minute et déduplique les requêtes concurrentes. CORS autorise seulement `FRONTEND_ORIGIN`. Pour un hébergement public, configurer également les limites de trafic et de quota sur l’hébergeur : CORS n’est pas une authentification et le quota API-Football dépend du compte.

Le fournisseur doit autoriser les compétitions, saisons, logos et statistiques utilisés. La disponibilité ne peut être vérifiée sans clé utilisable. Les statistiques avancées et les notes d’équipe peuvent être absentes même avec une clé valide ; leur absence reste explicite. Les cinq derniers matchs peuvent déclencher plusieurs demandes de statistiques ; elles sont mises en cache. Les bonus propriétaires restent à fournir.

### Comportement de l’adaptateur API-Football

- Compétitions prioritaires sélectionnées depuis les métadonnées réelles des saisons courantes.
- Recherche de clubs à partir de trois caractères, tous championnats ; sans filtre ni recherche, Ligue 1 par défaut.
- Calendrier des prochaines rencontres ou derniers résultats ; sélectionner une compétition pour affiner. Sans filtre, affichage représentatif des huit premières compétitions couvertes, jusqu’à cinq rencontres chacune.
- Classement officiel pour une compétition et sa saison courante. Les compétitions à plusieurs groupes sont explicitement signalées comme non prises en charge par le tableau global.
- Les cinq derniers matchs terminés d’une équipe et leurs statistiques disponibles. Les moyennes descriptives ne sont calculées que lorsque toutes les valeurs de l’échantillon sont présentes.
- Le comparateur ne rapproche les statistiques que si période et nombre de matchs correspondent. Les forces et faiblesses qualitatives restent en développement.

## Contrat interchangeable du proxy

`src/services/footballService.js` sépare l’adaptateur, le cache et l’interface. Le frontend attend une enveloppe JSON :

```json
{
  "data": [],
  "source": { "name": "Nom du fournisseur", "url": "https://adresse-publique" },
  "fetchedAt": "2030-01-01T00:00:00Z"
}
```

La date est celle de récupération auprès du backend, dont le cache fournisseur expire après une minute. `data` est un objet pour une fiche ou des statistiques, un tableau pour une liste.

Routes :

- `GET /competitions` → `{ id, name, country }[]`
- `GET /teams?search=&competition=` → `{ id, name, short, logo, country, competitionId, competitionName }[]`
- `GET /teams/:id` → même objet équipe
- `GET /matches?competition=&view=upcoming|results` → `{ id, home, away, competition: { id, name }, kickoff, status, goalsHome, goalsAway }[]`
- `GET /standings?competition=` → `{ position, team, played, won, drawn, lost, goalsFor, goalsAgainst, points }[]`
- `GET /teams/:id/matches?status=finished&limit=5` → matchs enrichis de `teamStats: { shots, bigChances, rating, bonuses }` et `sourceReference`
- `GET /teams/:id/statistics` → `{ periodStart, periodEnd, sampleSize, shotsPerMatch, bigChancesPerMatch, teamRating }`

Les identifiants sont des chaînes. Les valeurs inconnues sont `null`, jamais des zéros de remplacement. Les statuts de match sont `scheduled`, `finished`, `live`, `postponed` ou `cancelled`. Les logits ou scores retournés par un fournisseur ne deviennent pas automatiquement un indice Calcito.

## Architecture

- `src/pages/` : pages et fiche équipe.
- `src/components/` : affichage des données, états, analyses, mascotte.
- `src/services/` : adaptateurs football, cache, historique.
- `src/hooks/useFootball.js` : chargement, erreurs, rechargement, protection contre les réponses obsolètes.
- `src/engines/` : préparation de la forme et interfaces du futur modèle probabiliste.
- `server/` : backend et adaptation API-Football, jamais inclus dans le bundle Vite.
- `tests/` : tests des garde-fous, du cache, des probabilités, de l’historique et du backend.

Les polices sont locales via Fontsource. La navigation utilise `HashRouter` : les URL sont de la forme `/calcito/#/comparateur`, ce qui préserve le rafraîchissement sur GitHub Pages sans règle serveur ni 404 de route.

## Publication GitHub Pages

Le workflow `.github/workflows/deploy.yml` installe les dépendances, lance les tests, compile et publie `dist/`. Vite conserve `base: '/calcito/'`.

1. Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions**.
2. Envoyer sur `main` ou lancer **Actions → Deploy CALCITO to GitHub Pages → Run workflow**.
3. Attendre la réussite du job `deploy`.

Adresse attendue : https://victorcorreiaensea.github.io/calcito/
