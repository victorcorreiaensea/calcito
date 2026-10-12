# CALCITO

Page d’accueil V1 d’une plateforme d’analyse statistique du football, construite avec React, Vite, CSS classique et Lucide React.

## Développement

Prérequis : Node.js 20.19+ ou 22.12+ et npm.

```sh
npm ci
npm run dev
```

Dans un environnement où le cache utilisateur n’est pas accessible, utiliser `npm ci --cache /tmp/calcito-npm-cache`.

## Compilation

```sh
npm run build
npm run preview
```

Les fichiers statiques sont générés dans `dist/`. Vite utilise `base: '/calcito/'` pour un déploiement GitHub Pages sous ce chemin. Publier le contenu de `dist/` via le mécanisme de déploiement GitHub Pages choisi ; le site ne nécessite aucun backend.

## Structure

- `src/App.jsx` : page et composants réutilisables.
- `src/styles.css` : identité visuelle, responsive et réduction des animations.
- `src/demoData.js` : toutes les équipes, rencontres, dates, résultats et indices fictifs.

La navigation utilise uniquement les sections de la page. Le comparateur présente une comparaison illustrative de deux équipes ; aucun calcul propriétaire n’est implémenté. Les indices de forme ne représentent pas des probabilités de victoire.

Les polices Barlow Condensed et DM Sans sont servies localement via Fontsource, sans requête externe, avec des polices système de secours.

## Publier sur GitHub Pages

1. Envoyer les fichiers du projet sur la branche `main` du dépôt GitHub.
2. Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions** comme source.
3. Le workflow `.github/workflows/deploy.yml` compile et publie le site à chaque push sur `main`. Pour le lancer manuellement : **Actions → Deploy CALCITO to GitHub Pages → Run workflow**, sur `main`.
4. Attendre la réussite du job `deploy` ; GitHub affiche alors l’adresse publiée dans Pages et dans le résultat du workflow.

Adresse attendue : https://victorcorreiaensea.github.io/calcito/
