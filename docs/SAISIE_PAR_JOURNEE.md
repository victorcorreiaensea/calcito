# Saisie par journée

1. Administration → **Saisie par journée**.
2. Choisir compétition, saison, journée ou tour et date commune facultative.
3. **Préparer les 9 matchs** pour une saison portugaise avec 18 participants. France et Allemagne : 9 ; Angleterre, Espagne et Italie : 10 lorsque leurs effectifs sont complets. Le nombre est ajustable de 1 à 40 ; coupes européennes : proposition de 18, à adapter pour les autres tours.
4. Choisir les deux équipes participantes et saisir les deux scores. La date de chaque rencontre reste modifiable pour les journées réparties sur plusieurs jours. Les zéros sont des scores réels à saisir, jamais des valeurs par défaut.
5. Déplier les statistiques si disponibles : tirs, tirs cadrés, poteaux, grosses occasions, note, possession et xG, pour les deux équipes. Les cases vides restent inconnues. Une source commune peut être précisée, puis remplacée par match.
6. **Enregistrer les N matchs en brouillon**. Les lignes vides ne sont pas enregistrées. Les erreurs bloquent la sauvegarde ; une équipe ne peut figurer deux fois dans cette grille ou dans un autre match de la même journée enregistrée.
7. Contrôler dans **Matchs & brouillons**, ajouter les sources requises, puis publier individuellement ou avec **Publier tous les brouillons**. La grille ne publie jamais automatiquement.

Les prototypes ne sont pas des matchs inventés dans Supabase. La grille est conservée dans le stockage de session du navigateur pour le compte connecté : un rechargement ou changement d’onglet de l’administration ne la supprime pas. Ce n’est pas une sauvegarde entre appareils : fermer l’onglet ou se déconnecter efface cette préparation locale. Les brouillons enregistrés restent dans Supabase.

Les sauvegardes utilisent la même RPC atomique et les mêmes RLS que la saisie existante. Le lot n’est pas une transaction globale ; un incident réseau peut laisser une sauvegarde incertaine. Le bilan indique les lignes enregistrées, ignorées, rejetées et à vérifier ; les lignes traitées sont verrouillées. Contrôler les résultats avant toute nouvelle tentative. Les doublons existants sont ignorés, sans mise à jour de leurs scores ou statistiques.
