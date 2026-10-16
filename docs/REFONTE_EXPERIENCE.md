# Expérience Calcito : accueil, avant-match et navigation unifiée

L’identité reste noire, bleue et blanche, conformément au choix du propriétaire. Les accents turquoise (lecture récente), violet (comparaison), doré (Calcithunes) et corail (vigilance) ont un rôle précis. Le classement existant conserve son organisation et son apparence.

## Parcours

- L’accueil présente le **FC Porto** publié, sans remplacer une information manquante par une valeur de démonstration. Le module de conversation réutilise l’image originale de Calcito, cinq dialogues locaux et des liens vers les fonctions réelles. La mascotte dispose de sept états, d’un salut au clic et de clignements limités, désactivés avec `prefers-reduced-motion`.
- Les cartes équipes sont entièrement cliquables au clavier et à la souris. La fiche met l’indice en avant, complète les cinq résultats avec les faits récents, le classement voisin, l’évolution et un accès « Pourquoi cet indice ? ».
- Les rencontres futures présentent les indices **actuels**, la moyenne descriptive de trois performances et la position, avec mention du classement partiel. Pour les matchs passés, les indices principaux restent ceux d’**avant la rencontre**.
- `#/matchs/:id` présente le contexte de la rencontre, les faits récents et les liens vers le comparateur et l’Arène. Les résultats simplifiés de l’historique restent consultables avec leur paramètre `team` ; aucun adversaire libre n’est transformé en club fictif.
- `#/comparateur?team=…&against=…&season=…&match=…` rassemble comparaison et pronostics. Les anciens liens `#/pronostics?home=…&away=…` sont redirigés en conservant le contexte. L’historique public des prévisions est conservé, distinct des tickets privés de l’Arène.
- L’Arène conserve son serveur, ses montants exacts, ses plafonds, son bookmaker autonome, ses combinés et sa reprise des requêtes après erreur réseau. Les deux modes ont désormais une présentation explicite ; les cartes ajoutent la forme des équipes et un lien vers l’avant-match.

## Données et moteur

Aucun changement du moteur V4 : **cinq performances à poids égaux**. Le modèle A + C sur huit rencontres n’existe pas dans cette version ; la méthodologie ne le présente donc pas comme exécuté. La « lecture instantanée » est la moyenne descriptive de trois performances réelles du journal V4, affichée seulement lorsque ces trois valeurs sont disponibles. Elle n’entre pas dans l’indice principal.

Le laboratoire pédagogique utilise réellement `calculateResultsForm` et `calculateSurprise`. Les scénarios sont explicitement fictifs et ne sont jamais enregistrés dans la base.

Les prévisions et cotes utilisent exclusivement `arena_quote`, sous les mêmes conditions d’authentification, de validation historique et de couverture que l’Arène. Aucune prévision hypothétique n’est produite pour des clubs sans match futur commun. Une erreur ou un modèle non validé reste signalé. Les mises restent autorisées uniquement par les fonctions SQL existantes.

## Portefeuille partagé

`WalletProvider` s’appuie sur `arena_account` et sur l’identité Supabase courante. Le solde de l’en-tête est actualisé après lecture serveur confirmée, au retour dans l’onglet et chaque minute pour un compte connecté. Une réponse d’une autre session n’est pas affichée. Les visiteurs ont un lien « Connexion », jamais un faux solde. Le lien du solde ouvre directement `#/arene?tab=profile`. Aucun montant n’est conservé dans le stockage local.

## Installation

Cette refonte ne nécessite **aucune nouvelle migration SQL**. Les prérequis existants de l’Arène restent applicables : migrations 003 et 004 et calibration du modèle. Une interface déployée ne signifie pas que la calibration de la base a été exécutée ou acceptée. Aucun accès privilégié Supabase n’a été utilisé pour cette refonte.

## Vérifications

`npm test` couvre les règles existantes et les commentaires descriptifs (perspective domicile/extérieur, exclusion des scores manquants et futurs, absence de moyenne instantanée sans trois performances). `npm run build` produit les chemins GitHub Pages `/calcito/`.

Les essais Chromium utilisent un serveur Supabase intercepté **uniquement dans le navigateur de test** : aucun portefeuille ni match de production n’est modifié. Parcours vérifiés : accueil, dialogue, cartes équipes, avant-match, liens conservant la sélection, ancienne route Pronostics, profil global, laboratoire, mises, missions, reprise réseau et affichage entre 320 et 1 440 pixels.
