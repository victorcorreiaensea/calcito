# Importer des matchs dans CALCITO

L’import utilise le projet Supabase existant, le compte administrateur et `save_match`. Il ne crée ni autre base, ni service payant, ni compte. Aucune nouvelle migration n’est nécessaire pour le CSV ; la migration 002 reste nécessaire uniquement pour les résultats rapides V3.1.

## Où cliquer

Administration → **Matchs & brouillons → Importer des matchs**, ou l’onglet administrateur **Importer des matchs**. Deux modes partagent le même aperçu : **Import CSV** et **Flashscore**. La saisie manuelle, les exports et l’ancien import restent disponibles.

1. Télécharger **Modèle CSV** et le remplir, ou sélectionner un fichier de résultats/statistiques obtenu auprès d’une source autorisée.
2. Charger **Fichier CSV de matchs**. Le collage CSV et de cellules de tableur est également disponible.
3. Associer chaque nom non reconnu à une fiche existante. Aucune équipe n’est créée implicitement. Les compétitions et saisons doivent déjà exister et les deux clubs doivent être participants.
4. Vérifier les scores, dates, saisons et liens source. Les cellules de l’aperçu permettent les corrections. Toutes les lignes sont analysées ; l’affichage est paginé par 15.
5. Choisir **Ignorer les doublons** ou **Mettre à jour les doublons**.
6. Choisir brouillons ou publication pour les nouveaux matchs. Pour publier, les équipes, la compétition et la saison doivent déjà être publiques et la case de vérification doit être cochée.
7. Cliquer **Importer les … matchs valides**, puis consulter ou télécharger le bilan.

Les lignes invalides sont rejetées sans empêcher l’import des autres. Un fichier limité aux doublons peut être traité pour obtenir son bilan, sans écrire de nouvelles rencontres. Le modèle est vide : aucun exemple fictif n’est chargé dans votre base.

## Format

CSV UTF-8, maximum 2 Mo / 500 lignes. Virgule, point-virgule et tabulation sont détectés ; les guillemets, virgules décimales et retours à la ligne entre guillemets sont pris en charge.

```csv
date,competition,season,home_team,away_team,home_goals,away_goals,home_shots,away_shots,home_shots_on_target,away_shots_on_target,home_big_chances,away_big_chances,home_rating,away_rating,source_url
```

Les sept premiers champs sont requis, les statistiques peuvent rester vides. Les colonnes statistiques peuvent aussi être absentes. Une source est requise pour publier ; dans le nouveau format c’est une URL HTTPS, sans identifiants. Une note d’équipe doit réellement exister : ne pas en déduire une moyenne des joueurs.

Les noms complets, slugs et identifiants sont reconnus lorsqu’ils correspondent à une seule fiche. Les alias ne sont pas devinés ; une correspondance choisie s’applique à toutes les occurrences du même nom dans ce fichier. Les saisons acceptent le libellé, l’année de début, `2026-2027` ou `2026/2027`. Corriger les valeurs dans l’aperçu ou créer les références via les onglets habituels.

L’import avancé accepte également les noms de colonnes de l’ancien export (`kickoff`, `home`, `away`, `goals_home`, etc.), sous réserve des règles de résultats terminés et d’URL source. L’ancien import général conserve ses propres capacités pour les anciens fichiers, y compris les sources en texte.

## Dates et données inconnues

- Dates ISO avec fuseau : `2026-10-01T20:00:00+01:00`.
- Heures sans décalage : choisir **Europe/Paris**, **Europe/Lisbon** ou **UTC** ; ne pas supposer le fuseau de l’heure affichée par Flashscore.
- Date française acceptée : `01/10/2026 20:00`.
- Date seule acceptée : `2026-10-01`. L’heure reste annoncée comme inconnue. Le stockage conserve midi UTC comme repère de date, avec un commentaire explicite ; les cartes publiques ne présentent pas cette heure comme un vrai coup d’envoi. En mise à jour, une heure déjà connue est conservée.

Une date impossible, future, hors saison ou une heure ambiguë/inexistante au changement d’heure est rejetée. Pour une heure répétée, fournir le décalage UTC explicite. Le mode avancé importe uniquement des résultats terminés avec les deux scores entiers et positifs ou nuls.

Les statistiques inconnues restent **NULL** en base, jamais zéro. Un zéro saisi est une valeur constatée. La formule Calcito n’est pas modifiée ; des données manquantes empêchent toujours un indice définitif. La journée non fournie porte explicitement « Non renseignée », sans journée inventée.

## Doublons et mises à jour

La correspondance utilise saison/compétition, équipes domicile/extérieur et date UTC, conformément au stockage. Les doublons au sein du fichier sont ignorés après la première ligne valide. Les conflits avec une autre saison/compétition ne sont pas déplacés automatiquement.

Une mise à jour conserve l’identifiant, le statut public/privé, les scores intermédiaires, les bonus et les statistiques déjà connues si les cellules correspondantes sont vides. Les deux scores finaux et les valeurs statistiques fournies remplacent leurs anciennes valeurs. Une cellule vide ne permet donc pas d’effacer une statistique connue : le formulaire manuel reste disponible pour une correction explicite.

L’horodatage du match lu dans l’aperçu est transmis à la sauvegarde : si quelqu’un l’a modifié entre-temps, cette ligne est rejetée et doit être rechargée. Les contraintes de la base protègent aussi les sauvegardes concurrentes. Si un résultat rapide existe, l’import peut l’ignorer ; pour le transformer, utiliser d’abord la conversion V3.1, puis mettre à jour ses statistiques par CSV.

Après chaque sauvegarde, les caches sont invalidés et les historiques/classements sont reconstruits selon les règles existantes. Les anciens indices sont invalidés par les triggers de la base. Les matchs européens ne modifient pas les points des championnats nationaux.

## Imports partiels

Une action utilisateur lance le lot. Chaque match et ses deux lignes statistiques sont atomiques, mais le fichier entier n’est pas une transaction unique. Les lignes valides sont enregistrées successivement ; les erreurs de validation/contrainte n’annulent pas les autres.

Le bilan distingue importés, mis à jour, ignorés, rejetés, non traités et sauvegardes incertaines. Les réponses réseau non confirmées ne sont jamais comptées comme importées. Une sauvegarde interrompue peut avoir été validée par le serveur : conserver son identifiant dans le bilan et vérifier les matchs/journal avant de recommencer. Les sauvegardes utilisent des identifiants uniques et la détection des doublons.

Ne pas fermer/recharger l’onglet pendant le traitement. La navigation interne de l’administration est désactivée pendant le lot. Le bilan porte sur cette opération, pas sur tous les fichiers importés auparavant.

## Flashscore : solution disponible et limites

Source demandée : [résultats Liga Portugal](https://www.flashscore.fr/football/portugal/liga-portugal/resultats/), saison **2026–2027**.

**Aucune extraction automatisée de matchs/statistiques n’est activée.** Le parcours réellement disponible est assisté : ouvrir les résultats, vérifier la saison et les rencontres terminées, consulter les fiches, puis ajouter les scores/statistiques observés à l’aperçu. Le lien de chaque fiche est conservé. On peut également charger un fichier provenant d’une source autorisée, sans supposer que Flashscore propose un export CSV natif.

L’accès direct depuis l’environnement cloud est bloqué par son proxy (CONNECT 403). Une inspection limitée, avec un agent identifié et sans collecte de scores, a pu consulter `robots.txt`, la page d’accueil et [les conditions officielles](https://www.flashscore.fr/terms-of-use/) depuis GitHub Actions. `robots.txt` autorisait la page résultats pour cet agent, ce qui ne suffit pas à autoriser la réutilisation des données. Les pages contiennent du JavaScript ; aucune requête interne de statistiques n’a été utilisée ni supposée publique. Aucune protection, CAPTCHA, authentification ou limite n’est contournée.

Les conditions consultées précisent « pour votre usage personnel uniquement » et interdisent l’extraction ou la mise à disposition du public d’une partie substantielle de la base sans « notre consentement explicite ». Ce n’est donc pas une source ouverte pour recopier automatiquement une saison sur CALCITO. L’interface demande de confirmer le consentement nécessaire pour les relevés dont la source est Flashscore.fr ; à défaut, utiliser des fichiers d’une autre source autorisée. Cette déclaration ne constitue pas une autorisation accordée par Flashscore et n’active aucun collecteur.

Il n’existe pas de backend de collecte autorisé configuré pour ce parcours. L’interface ne présente donc pas de faux bouton de récupération. Les fichiers/relevés doivent provenir de sources dont vous êtes autorisé à utiliser les données. L’application ne prétend pas avoir récupéré l’ensemble de la saison 2026–2027.

## Validation effectuée

- Tests unitaires : formats CSV/tableur, accents/alias, dates/fuseaux/DST, scores/statistiques, doublons, mises à jour, erreurs et bilans partiels.
- Test PostgreSQL isolé : **deux vrais matchs historiques de Liga Portugal 2024–2025**, sauvegardés par le RPC existant sous le rôle administrateur, avec statistiques inconnues NULL, deux historiques, points de championnat et refus des écritures anonymes. [Source, attribution et CSV de référence](../tests/fixtures/README.md).
- Tests navigateur avec service Supabase simulé : aperçu/corrections, téléchargement, publication/brouillon, doublons, erreurs réseau et responsive.
- Build et workflow de publication.

Ces vérifications n’insèrent aucun match dans votre Supabase de production. Pour le contrôle final sur votre compte réel, importer un petit fichier de rencontres vérifiées en brouillon, vérifier les deux historiques, puis publier après contrôle. Aucun mot de passe ni clé serveur n’est nécessaire dans le dépôt.
