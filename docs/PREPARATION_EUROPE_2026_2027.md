# Préparation européenne 2026–2027

## Bilan réel de cette livraison

Aucune rencontre réelle n’a été importée dans Supabase, aucun club n’a été créé en production et aucun résultat n’a été publié. Aucun accès administrateur à la base n’est disponible dans l’environnement de développement.

Les pages UEFA (calendriers Champions League et Europa League), le service public de matchs UEFA, Flashscore France (résultats 2026–2027), ESPN et WorldFootball ont été consultés le 17 octobre 2026 : accès réseau refusé ici (HTTP 403 au tunnel). Le catalogue OpenFootball européen accessible ne propose pas cette saison. Des calendriers tiers trouvés sur GitHub ne permettent pas de vérifier les 72 scores et n’ont pas été importés. **72 est la cible indicative du format 36 clubs, pas un nombre de rencontres vérifiées.** Il manque donc le relevé vérifiable des rencontres et des participants officiels.

La lecture anonyme du catalogue public a permis de vérifier les neuf compétitions existantes et les six saisons nationales. Aucune saison européenne 2026–2027 n’est visible publiquement au moment du contrôle. Les sorties du catalogue des clubs et des matchs étant tronquées, aucun décompte complet des clubs ou doublons de production n’est annoncé. La prévisualisation du nouvel espace utilise toujours le catalogue complet du compte propriétaire connecté, y compris ses brouillons.

## Activation par le propriétaire

1. Dans Supabase → SQL Editor → New query, exécuter **une seule fois** `supabase/migrations/005_europe_preparation.sql`, après les migrations existantes 001 à 004. Le même fichier est proposé depuis le nouvel onglet sous « Ouvrir le SQL d’installation » (`/calcito/downloads/calcito-preparation-europe.sql`). Ce script n’importe aucune rencontre et ne contient aucun score.
2. Dans Calcito → Administration → **Préparation européenne**, choisir compétition, saison 2026–2027 et journée 1 ou 2.
3. Remplir le modèle CSV fourni avec un relevé vérifié, ou fournir le contenu des résultats afin de préparer ce fichier. Un fichier peut contenir les quatre journées. Les statistiques avancées sont volontairement absentes du modèle initial et restent `null` en base.
4. Prévisualiser, résoudre les associations de clubs et contrôler les sources, dates et scores. Une nouvelle fiche exige son nom, son pays et une URL de vérification de son identité. Écusson, championnat national et identifiant externe restent inconnus s’ils ne sont pas fournis et vérifiés. Le remplacement neutre est automatique pour un logo absent.
5. Confirmer la création des brouillons. Les nouvelles fiches clubs sont publiques avec indice indisponible tant que les données sont insuffisantes. Aucune fiche existante n’est écrasée. Une rencontre existante est conservée telle quelle, même si sa date ou son statut diffère du relevé ; elle doit être corrigée manuellement si nécessaire.
6. Compléter tirs, tirs cadrés, grosses occasions, notes et commentaires. **Enregistrer le brouillon** ne publie rien.
7. Pour publier un seul résultat, cocher sa confirmation puis « Valider et publier ce match ». Pour une journée, enregistrer d’abord les brouillons, préparer sa validation, vérifier la liste puis confirmer explicitement. Les statistiques avancées restent facultatives. Une publication met alors à jour les calculs et peut régler les pronostics concernés selon les règles existantes.

Les anciennes rencontres européennes dont la journée n’indique pas explicitement la phase de ligue sont signalées à part. Le bouton de vérification ouvre leur fiche existante. Après contrôle de la source, la journée peut être renseignée sous la forme `Phase de ligue · Journée 1` ou `Phase de ligue · Journée 2`. Les qualifications ne sont pas assimilées automatiquement à la phase de ligue.

## Colonnes du relevé

Les colonnes `competition`, `season`, `stage`, `round`, `date`, `home_team`, `away_team`, `status`, `source_url` identifient la rencontre. Valeurs :

- `competition` : `champions-league` ou `europa-league`.
- `season` : `2026-2027` ; `stage` : `league-phase` ; `round` : `1` ou `2`.
- `date` : date et heure ISO sans millisecondes, avec décalage explicite, ou `AAAA-MM-JJ HH:MM` avec `timezone` (par défaut Europe/Paris). Une date sans heure est bloquée, car le schéma ne permet pas une date inconnue et aucune heure n’est inventée.
- `home_goals`, `away_goals` : deux nombres vérifiés, ou deux cellules vides si le résultat est inconnu. `status` : `finished`, `scheduled`, `postponed` ou `cancelled`. Un résultat incomplet reste impossible à publier.
- Pour un club manquant : `home_country` / `away_country`, `home_identity_source_url` / `away_identity_source_url`. Les champs de championnat national, logo, source du logo et identifiant externe sont facultatifs ; un logo renseigné exige sa source. Pour une URL API-Football, le fournisseur `api-football`, l’identifiant externe vérifié et le numéro de l’URL doivent correspondre.

Les graphies alternatives connues du catalogue national sont réutilisées. Pour une autre graphie, associer explicitement la fiche existante dans l’aperçu. Harmoniser les noms si plusieurs variantes du même club figurent dans un même fichier. Un relevé Flashscore nécessite la confirmation des droits déjà prévue dans le projet ; le module n’effectue aucun scraping automatique.

## Garanties et limites

L’import est un RPC réservé au propriétaire, atomique et exclusivement créateur de brouillons. La demande comporte un identifiant de reprise ; en cas de réponse réseau perdue, le bouton reprend **la même demande**. Un nouvel import du même fichier retrouve les clubs et les rencontres sans les dupliquer. Les créations sont journalisées. Les rencontres et équipes existantes ne sont jamais mises à jour par l’import.

La migration corrige l’invalidation des instantanés pour les brouillons privés et leurs statistiques ; l’ajout d’une inscription sans résultat public n’invalide plus les anciens indices. Elle empêche également un brouillon privé de désactiver le modèle de cotes ou d’entrer dans le règlement des tickets. La publication garde les effets existants. La formule V4 et les coefficients des compétitions sont conservés, sans nouveau bonus européen. Les matchs européens ne comptent pas dans les classements nationaux.

Les fiches européennes utilisent les mêmes composants que les autres clubs. Les filtres de compétition et de pays permettent de les retrouver. Un championnat d’origine indiqué comme texte ne crée pas de classement national : sans championnat suivi, la position reste indisponible. Les prochaines rencontres européennes sont visibles pour ces clubs lorsqu’elles sont publiées.

La préparation et la publication nécessitent une session administrateur réelle. Les essais automatiques utilisent uniquement des fixtures synthétiques dans une base PostgreSQL locale isolée et des requêtes interceptées en navigateur ; aucun de ces scores n’est distribué dans les données du site.
