# Activer les résultats rapides — CALCITO V3.1

Le site conserve le noir, le bleu électrique et le blanc. Les matchs V3, leurs identifiants, comptes et permissions existants sont conservés.

## Une seule opération dans Supabase

1. Ouvrir le projet Supabase déjà utilisé par CALCITO.
2. Ouvrir **SQL Editor → New**.
3. Copier tout le fichier [`supabase/migrations/002_simplified_results.sql`](../supabase/migrations/002_simplified_results.sql).
4. Cliquer **Run**, une seule fois. `Success. No rows returned` est normal.
5. Recharger l’administration avec **Ctrl + F5**.

Ne pas réexécuter la migration 001 et ne pas créer un autre projet. La migration 002 est une transaction : une erreur annule ses changements. En cas d’erreur, conserver son message et ne pas exécuter des morceaux du fichier séparément.

Avant cette migration, le site continue de charger les matchs complets et affiche un message d’activation dans le mode rapide. Les mêmes URL et clé publique Supabase sont réutilisées. Aucune clé secrète n’est nécessaire.

## Deux modes

- **Ajouter un match complet** : formulaire V3 conservé, deux fiches d’équipe et une saison avec ses participants. Pour les six championnats suivis et les coupes européennes.
- **Ajouter un résultat rapide** : une équipe existante, un adversaire libre, une date, un championnat non suivi, le terrain et le score. Aucun adversaire, championnat ou calendrier n’est créé automatiquement. Le score est toujours vu depuis l’équipe suivie, même à l’extérieur.

Les scores sont requis, positifs ou nuls et entiers. Les résultats futurs sont refusés. La saison est déduite uniquement lorsqu’une participation existante offre une seule possibilité ; sinon confirmer les années dans « Saison ». Les championnats sur une année civile sont possibles. La date seule ne permet pas de connaître leurs saisons. La date simple est conservée à midi UTC pour éviter un changement de jour entre les navigateurs.

Le bouton **Enregistrer et ajouter un autre**, la touche **Entrée** et **Ctrl/Cmd + Entrée** enregistrent puis effacent l’adversaire et les scores. L’équipe, la date, la compétition et la saison sont conservées. La dernière équipe est mémorisée dans l’onglet du navigateur, uniquement pour le confort de saisie. Les données elles-mêmes restent dans Supabase. « Publier ce résultat vérifié » est décoché par défaut.

Une correspondance exacte du nom normalisé propose une liaison facultative avec une fiche existante. Une variante de nom ou une abréviation doit être corrigée ou liée explicitement avant conversion. Sans liaison, l’adversaire reste un texte : aucune page d’équipe inexistante n’est liée.

## Gestion et conversion

**Matchs & brouillons** réunit les deux types, avec filtres, modification, dépublication et suppression confirmée. **Dernières saisies** permet de rouvrir les cinq dernières modifications. **Suivi de couverture** trie les équipes par nombre de résultats à saisir et permet de démarrer directement sur une équipe.

Le bouton **Convertir** nécessite une fiche adversaire et une saison nationale commune contenant les deux participants. Il préremplit le formulaire complet. Enregistrer la conversion conserve le même identifiant, la date, le terrain et le score ; le résultat rapide d’origine est archivé dans `simplified_results`, avec un lien vers le match. Il ne compte plus dans les historiques. Les nouvelles statistiques restent NULL si elles sont vides. En cas d’échec de conversion, tout est annulé, y compris l’archivage.

Une correction du score ou de la date doit être enregistrée dans le résultat rapide avant conversion. Après conversion, modifier le match complet. Supprimer ce match ne réactive pas l’ancien résultat rapide ; l’archive et le journal conservent la trace de conversion.

Les doublons sont refusés côté base, y compris entre les deux types, sur les équipes/adversaire et la même date UTC. Le contrôle compare le nom normalisé ou la liaison de l’adversaire. Des alias différents non liés (par exemple un nom abrégé totalement différent) ne peuvent pas être reconnus automatiquement. Un match ancien ainsi identifié ne peut pas être ressaisi pour une autre compétition le même jour. Les mises à jour concurrentes par le formulaire utilisent l’horodatage attendu et sont refusées si la ligne a changé.

Les exports des matchs complets et équipes sont conservés. Un export séparé contient les résultats rapides et les archives de conversion ; leur import CSV n’est pas ajouté dans cette version.

## Historiques, forme et classements

Les cinq derniers résultats sont fusionnés et triés chronologiquement dans la même saison, toutes compétitions confondues, y compris les résultats rapides. Les brouillons ne sont jamais utilisés sur le site public. Les statistiques d’un résultat rapide sont NULL, pas zéro. Si une des cinq valeurs nécessaires à une moyenne manque, cette moyenne reste indisponible.

`formCoverage` expose la quantité de résultats, les données nécessaires au moteur et la variante complète/provisoire. `calculateSimplifiedForm` est un module séparé, sans formule ni coefficients inventés. La présence d’un résultat rapide interdit le calcul via la formule complète. Les pourcentages provisoires resteront indisponibles jusqu’à validation de leur propre méthode. Un indice complet stocké exige les cinq résultats et leurs données ; aucun ancien indice complet n’est réutilisé sur une fenêtre devenue provisoire.

Les indices complets valides sont classés par variante et groupe de compatibilité (à défaut, version de modèle). Les scores égaux partagent le rang. Les équipes sans indice restent sans rang, par ordre alphabétique. Même des variantes compatibles restent séparées ici : une future fusion nécessitera une validation explicite. Le filtre provisoire inclut aussi les fenêtres avec résultats rapides dont la méthode est encore en attente ; il ne prétend pas qu’un pourcentage est disponible.

Le classement européen inclut les six championnats et les clubs supplémentaires inscrits à une saison européenne publiée. Pour ces clubs, remplir « Championnat d’origine » dans Équipes. Un résultat rapide seul ne déclare pas une participation européenne. Les classements nationaux sont limités aux six slugs de référence et n’utilisent que les matchs complets de leur propre saison nationale.

## Vérifications sur votre projet

Les tests PostgreSQL locaux couvrent les autorisations, la migration additive, les doublons, les erreurs et l’atomicité de conversion. Les tests navigateur utilisent un service simulé pour vérifier la saisie et le responsive. Ils ne remplacent pas la vérification sur votre Supabase réel :

1. Enregistrer un résultat rapide en brouillon, puis consulter la fiche en navigation privée : il reste invisible.
2. Publier ce résultat : seule l’équipe suivie reçoit l’historique ; aucun adversaire n’est créé.
3. Modifier puis dépublier : le résultat et les indices anciens sont actualisés/infirmés.
4. Vérifier les cinq résultats fusionnés, sans doublon, et l’absence de changement du classement national.
5. Tester une conversion et une suppression sur un brouillon de contrôle, puis consulter le journal.

La migration ne nécessite ni nouvel abonnement ni modification de l’authentification. Les quotas de l’offre Supabase restent applicables.
