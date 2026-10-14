# Présentation de l’indice Calcito

Refonte visuelle uniquement : la formule `results-context-v2`, ses poids et les données enregistrées restent inchangés. L’identité reste noire et bleue, avec la mascotte existante.

- `FormCore` : noyau SVG accessible, score sur 100, lecture compacte ou détaillée. Les transitions respectent `prefers-reduced-motion`. Un score absent n’est jamais représenté par zéro.
- Accueil : indice d’une fiche publiée disposant de cinq résultats ; aucun score fictif pour remplir la page.
- Fiches, matchs, comparateur, pronostics et classements : signature partagée via `FormValue`. Le classement européen utilise également ce composant.
- Fiche équipe : « Pourquoi cet indice ? », faits vérifiables, synthèse déterministe et frise de cinq matchs, ancien → récent. Les adversaires utilisent les logos déjà enregistrés, avec un écusson de repli si le logo manque.
- Méthodologie : facteurs visuels, encadré pédagogique de la mascotte, cinq emplacements explicatifs et démonstration interactive. Les matchs de cette démonstration sont explicitement fictifs, calculés par le moteur actuel et ne sont jamais sauvegardés. Les détails mathématiques restent dépliables.

## Fidélité au moteur

Les contributions individuelles sont `100 × raw / (5 × maximum)` depuis le `breakdown` du moteur actuel. Leur somme est l’indice ; elles ne représentent pas une variation avant/après. Elles sont absentes si les cinq matchs, les terrains, la version ou les scores ne correspondent pas au breakdown. Les parts affichées par dimension regroupent les contributions déjà calculées : résultat, attaque, défense + clean sheet domicile, différence de buts, extérieur. Aucun nouveau facteur n’est introduit.

La régularité est un fait descriptif : nombre de matchs consécutifs sans défaite depuis le plus récent. Aucun bonus de régularité n’est inventé. Les clean sheets hors domicile peuvent être affichés comme faits, sans leur attribuer le bonus réservé au domicile.

Les statistiques avancées enrichissent **la lecture**, pas **l’indice** : la formule actuelle n’utilise pas les tirs ou grosses occasions. La couverture compte les matchs avec au moins une valeur finie renseignée parmi tirs, tirs cadrés et grosses occasions. Les statistiques partielles restent signalées ; les moyennes existantes ne sont pas inventées. L’absence de statistiques ne pénalise pas le score.

Les appréciations visuelles décrivent le niveau actuel : ≥90 « En feu », ≥75 « Très bonne forme », ≥60 « Bonne dynamique », ≥45 « Forme modérée », ≥30 « Dynamique fragile », sinon « En difficulté ». Ce sont des libellés éditoriaux, sans coefficient supplémentaire, tendance temporelle ou prédiction.

La synthèse utilise exclusivement les résultats valides disponibles : résultats, buts, clean sheets et terrains connus. Une série incomplète est signalée et ne reçoit pas de contributions chiffrées. Une erreur de chargement ne produit pas d’explication supposée.
