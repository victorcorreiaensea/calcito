# Saisie des relevés européens et affichage natif

Les captures sont lues par Codex dans la conversation. Elles ne sont ni importées, ni affichées, ni relues par le site. L’ancien onglet d’images, son lecteur, son code de déchiffrement et son lot de photos ont été supprimés.

## Source réelle et enregistrement

Le site continue de lire exclusivement Supabase (`matches`, `match_team_stats`, `teams`, `season_teams`). Il ne lit pas le JSON du dépôt comme une base de remplacement.

`data/imports/europe-2026-match-statistics.json` contient les 72 relevés numériques proposés, avec provenance, identités et champs inconnus à `null`. Aucun octet d’image n’y figure. `data/imports/europe-2026-logos.json` référence les écussons vérifiés par chemin source, commit immuable et empreinte Git du fichier. Les originaux des écussons sont servis localement, indépendamment des captures.

Pour enregistrer ces chiffres dans la vraie base : ouvrir `public/downloads/calcito-statistiques-europe-brouillons.sql`, copier le contenu dans **Supabase → SQL Editor**, puis **Run**. Ce script unique installe 005 si nécessaire, installe 007 et écrit les données structurées dans les vrais matchs en brouillon. Il ne nécessite pas 006. Le résultat `bilan_importation` indique les UUID effectivement utilisés, les clubs créés, les matchs complétés et les erreurs. Réexécuter le même lot ne crée aucun doublon et ne réécrit pas des corrections manuelles effectuées ensuite.

Le script du SQL Editor requiert un unique propriétaire déclaré dans `admin_users`. Aucun mot de passe ni clé secrète ne doit être partagé. La fonction d’import utilise les droits du propriétaire connecté ; les visiteurs n’y ont pas accès.

**L’environnement Codex ne possède aucune session administrateur Supabase. La préparation d’un fichier ou son déploiement sur GitHub Pages ne signifie pas que le script a été exécuté dans Supabase.** Ne jamais annoncer des écritures réelles sans le bilan renvoyé par la base.

## Clubs

L’association recherche les UUID du catalogue réel via des noms et variantes explicites : les UUID d’une ancienne exportation ne sont jamais supposés actuels. Les correspondances ambiguës sont signalées, pas fusionnées au hasard. Les nouveaux clubs utilisent le même modèle et les mêmes routes que les autres équipes, avec pays, championnat connu, logo sourcé et participation européenne. Les logos existants et leurs références externes sont préservés ; un logo manquant peut être complété par le fichier vérifié. Aucun identifiant API-Football n’est déduit d’un fichier ou inventé.

Les nouveaux clubs sont accessibles dans Équipes et depuis les rencontres publiées. Sans historique suffisant, leur indice reste indisponible. Une absence de prochains matchs renseignés reste une absence de calendrier, sans invention de rencontres.

## Contrôles et publication

- Chaque relevé retrouve la rencontre par saison et UUID domicile/extérieur ; date, journée, statut et score sont ensuite contrôlés.
- Les valeurs déjà renseignées ne sont jamais remplacées silencieusement. Un conflit laisse la rencontre intacte et apparaît dans le bilan.
- Chaque rencontre est enregistrée en transaction ; une ligne invalide ne laisse ni match incomplet ni nouveau club orphelin issu de cette ligne.
- Toute rencontre déjà publique est laissée intacte et signalée : un accord préalable est nécessaire avant de modifier ses données visibles.
- Aucun match n’est publié par l’import. Les résultats privés n’affectent ni indices publics ni Calcithunes. La validation/publication explicite utilise ensuite les outils existants de l’administration, après accord sur le récapitulatif.
- Les matchs européens rejoignent les historiques et le calcul chronologique existant après publication, sans entrer dans les classements nationaux. La formule V4 n’est pas modifiée.

## Points à confirmer sur ce lot

- Fuseau horaire absent des captures : **Europe/Paris proposé**.
- Journées Champions League proposées par groupes de dates, car le numéro est tronqué sur les captures.
- Cartons jaunes absents pour **Bayer Leverkusen–Celje** et **H. Beer Sheva–Dinamo Zagreb** : quatre valeurs restent `null`.
- Notes d’équipe, poteaux et cartons rouges non visibles restent inconnus.
- Championnat national 2026–2027 de Torreense à confirmer ; il n’est pas inventé.
- Résultats lus sur les captures du propriétaire, sans confirmation indépendante auprès de l’UEFA.

## Fiche native

L’en-tête conserve écussons, score, compétition, journée et date. Les statistiques enregistrées alimentent des barres comparatives bleues et turquoise. Une valeur absente reste affichée « — » sans barre fictive. L’analyse de la mascotte est déterministe et descriptive : elle cite uniquement les valeurs disponibles, sans confondre xG et note, sans probabilité de victoire.

## Maintenance

`node scripts/prepare-native-europe.mjs` régénère le script SQL à partir des relevés numériques. Les anciennes migrations restent dans l’historique pour les bases qui les ont appliquées ; 007 désactive les anciens points d’entrée d’import d’images et conserve seulement d’éventuelles archives privées existantes, sans les utiliser dans le site.
