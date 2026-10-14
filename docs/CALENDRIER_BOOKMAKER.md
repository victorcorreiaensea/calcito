# Calendrier réel et bookmaker autonome

La mise à jour conserve les portefeuilles, tickets, missions et formes V4. Elle utilise le calendrier public **OpenFootball / football.json**, sous CC0, sans clé API ni service payant. Source préparée : commit `e6744429ee395bc86f247348c6184bb08d4eb361`, saison `2026-27`, fichiers `fr.1.json`, `en.1.json`, `es.1.json`, `it.1.json`, `de.1.json`, `pt.1.json`. Les horaires viennent des champs de cette source, dans le fuseau de la compétition ; ce calendrier communautaire peut changer et doit être contrôlé avant publication. La licence des données n’inclut pas automatiquement celle des écussons déjà configurés.

## Lot préparé le 14 octobre 2026

Le catalogue public actuel contient 114 participants aux six saisons de championnat. Les deux prochaines rencontres par équipe sont réunies sans compter deux fois les affiches communes : **105 rencontres à horaire renseigné** sont prêtes. Répartition : Ligue 1 18 ; Premier League 20 ; LaLiga 11 ; Serie A 20 ; Bundesliga 18 ; Liga Portugal 18.

**Dix affiches espagnoles datées du 25 octobre sont exclues** parce que leur heure manque dans cette source. Dix-huit clubs n’ont donc qu’une rencontre à horaire exploitable ; deux ont deux rencontres, dont une rencontre décalée dans le calendrier. On ne choisit pas une troisième affiche pour prétendre avoir les deux premières, et on ne crée pas un faux horaire. Ce constat signifie « absent de la source consultée », pas une affirmation que la ligue n’a jamais annoncé l’horaire ailleurs. Le bilan de préparation est disponible dans `public/data/upcoming-preview-2026-2027.json` ; les horaires supplémentaires pourront être ajoutés manuellement après vérification d’une source autorisée.

**Préparé n’est pas ajouté en base.** L’environnement ne possède pas de session propriétaire Supabase : aucune écriture distante n’est affirmée. Les rencontres existantes n’ont pas été supposées absentes ; le script les compare au moment de l’installation et conserve les résultats et corrections manuelles. Le bilan SQL ou la synchronisation authentifiée donne le nombre réellement ajouté.

## Activer dans le Supabase actuel

1. Ouvrir [le script combiné](https://victorcorreiaensea.github.io/calcito/downloads/calcito-calendrier-bookmaker.sql), copier tout son contenu.
2. Dans **Supabase → SQL Editor → New query**, coller et cliquer **Run une seule fois**. Ce fichier installe la migration **004**, après les 001/002/003 déjà actives, et initialise les rencontres reconnues. La création des fonctions et l’initialisation forment une seule transaction. Aucun portefeuille n’est réinitialisé ; aucun nouveau club n’est créé.
3. Sur Calcito, ouvrir **Administration → Calendrier des pronostics → Recharger le bilan serveur**. Les rencontres sont publiques sur **Matchs → À venir** et les fiches des deux équipes. Le bilan indique la dernière synchronisation réellement confirmée et les données permettant ou empêchant les cotes.
4. Dans **Arène & cotes**, cliquer **Tester et calibrer sur l’historique** si le modèle n’est pas validé. Le calendrier seul ne garantit pas des cotes : le modèle probabiliste V5 garde ses contrôles historiques et ses seuils. Une validation refusée n’est jamais remplacée par une probabilité de forme ou une cote simulée.

Si l’installation intervient après le début de certaines affiches du lot, elles sont ignorées. Actualiser ensuite les prochains matchs pour obtenir un nouveau lot. Ne pas réexécuter une migration installée : utiliser le bouton d’actualisation pour les mises à jour.

## Actualiser sans nouvelle migration

Dans **Calendrier des pronostics**, cliquer **Actualiser les prochains matchs**. Le frontend lit une version précise du dépôt CC0, les six calendriers et le catalogue existant. Il choisit les deux premières rencontres non commencées par club et affiche une prévisualisation : identités internes, source, fuseau, date, journée, ajouts, corrections et horaires/participants manquants. Il ne crée pas de clubs et ne remplace pas un résultat officiel par un match à venir.

Contrôler la prévisualisation et cocher la confirmation, puis **Publier le calendrier vérifié**. La fonction serveur propriétaire `arena_calendar_apply` effectue les écritures atomiquement, avec identifiant de requête et contrôle de version. Une nouvelle date ne crée pas un deuxième match : les références externes stables et le couple saison/équipes retrouvent la rencontre. Une ambiguïté ou une version périmée bloque l’opération, sans import partiel prétendument réussi.

Un report/une annulation explicites sont pris en compte pour les rencontres déjà connues. Une disparition du flux n’est **pas** interprétée comme une annulation. Les horaires modifiés neutralisent les sélections déjà engagées conformément aux règles V5 : leur ticket, leur cote figée et leur audit restent conservés, leurs engagements sont remboursés. Un nouveau résultat n’est jamais inventé ni utilisé pour régler un ticket depuis le calendrier.

Les écussons sont ceux du catalogue actuel. Les pages Matchs proposent les filtres championnat et date (Europe/Paris) ; les fiches d’équipes présentent leurs deux prochaines rencontres de championnat ; les liens ouvrent le match concerné dans l’Arène. Les nouveaux tickets restent bloqués au coup d’envoi.

L’actualisation proposée ici est déclenchée par le propriétaire. Une automatisation ultérieure est possible avec une fonction Supabase planifiée, dans les quotas gratuits, et une identité serveur conservée comme secret ; elle n’est pas activée ni simulée par un navigateur permanent. Le bouton fonctionne sans API football payante. Les limites publiques de GitHub restent applicables ; une erreur de lecture ne produit pas de faux calendrier.

## Calcito décide de sa mise

Le joueur choisit uniquement la rencontre, la sélection et la cote qu’il offre. Le champ « Mise de Calcito » a été supprimé. **Demander la décision de Calcito** appelle le serveur pour une évaluation sans réserve financière ; la confirmation crée le ticket. Le modèle probabiliste ne change pas et l’estimation utilisée appartient à la quote déjà datée et versionnée.

Version de décision : `quarter-kelly-budget-v1`.

- `p` = probabilité conservée dans la quote validée ; `o` = cote proposée.
- Rendement estimé : `p × o − 1`. Refus si ce rendement n’est pas **strictement supérieur à 5 %**, ou si les données/quotes ne sont plus valides.
- Fraction Kelly théorique : `max(0, (p × o − 1) / (o − 1))`.
- Fraction retenue : un quart de Kelly, réduit par `1 − 2p(1 − p)` (de 0,5 à 1). Ce facteur réduit la taille autour des estimations les plus incertaines ; il ne corrige pas magiquement les erreurs du modèle.
- Budget de calcul par proposition : `min(réserve disponible de Calcito, 200 C)`, financé par sa réserve V5 existante, partagée entre les modes. Aucun budget illimité ou solde parallèle non financé n’est introduit.
- La mise finale en centimes est le minimum de la taille calculée, de **5 % de la réserve disponible de Calcito**, de **10 C**, et de la taille dont le bénéfice peut être couvert par le joueur.
- La responsabilité du joueur vaut `floor(mise × cote) − mise`. Elle doit respecter **5 % de son disponible et 10 C**. Les limites monétaires sont toujours arrondies vers le bas. La taille maximale compatible avec cette responsabilité est calculée exactement en tenant compte du retour brut au centime.

Exemple de test isolé, pas une cote publique : avec `p = 0,5`, une offre à 2,20 et les budgets initiaux, Calcito choisit **2,08 C**, retour brut **4,57 C**, responsabilité joueur **2,49 C**. Une offre à 1,50 est refusée sans réserve. Les réponses de la mascotte reprennent les valeurs calculées par le serveur, jamais une mise aléatoire.

La décision montrée avant confirmation n’est pas un ticket enregistré. À la confirmation, les budgets sont relus ; la mise peut être réduite, mais la responsabilité ne peut dépasser celle que le joueur a prévisualisée. Les deux réserves et le ticket sont écrits ensemble. Un refus ne coûte rien. Un identifiant rejoué rend la décision d’origine sans réserver deux fois ; les anciennes routes ne permettent plus à un client de forcer une mise bookmaker.

Si Calcito réussit, il retrouve sa mise et reçoit le bénéfice réservé par le joueur. S’il échoue, le joueur retrouve sa responsabilité et reçoit la mise de Calcito. Annulation : chacun retrouve son engagement. Les règlements et corrections restent ceux de V5, fondés uniquement sur les résultats officiels vérifiés. Tous les montants sont virtuels ; aucun rendement ni gain réel n’est garanti.

## Vérifications

Les tests exécutent PostgreSQL/PGlite avec la vraie migration 004 : mise autonome et variable, refus, plafonds, absence d’écriture directe, impossibilité de contourner la mise serveur, idempotence, synchronisation propriétaire, absence de doublon, préservation des résultats, report et maintien de la cote acceptée. Les domaines vérifient les deux premières rencontres, dates UTC/fuseaux et le refus d’un horaire manquant. Les données synthétiques de test ne sont jamais publiées en production.
