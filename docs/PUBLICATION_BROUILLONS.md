# Publier les brouillons en groupe

Administration → **Matchs & brouillons** → **Publier tous les brouillons**.

Le premier clic recharge les données et prépare un aperçu sans publier. Il inclut tous les brouillons, indépendamment du filtre et de la pagination. Les résultats rapides archivés et les matchs déjà publiés sont exclus.

Vérifier les rencontres et leurs sources, puis cocher **J’ai vérifié les résultats et les sources des matchs à publier** et cliquer sur **Confirmer la publication des … brouillons**. Les nouvelles dates de vérification correspondent à cette validation par le propriétaire, pas à une vérification automatique des sites sources.

Les scores, dates des rencontres, sources, statistiques et bonus ne sont pas modifiés. Pour les matchs complets, seuls `is_published` et `verified_at` changent. Pour les résultats rapides, seul `is_published` change. Les politiques RLS, l’audit et l’invalidation des indices restent actifs. Aucune migration ni nouvelle clé n’est nécessaire.

Les fiches privées de compétition, saison ou équipe restent privées et bloquent la publication des rencontres concernées. Les résultats incomplets, sources absentes, scores invalides, résultats futurs ou références incompatibles sont signalés avant le traitement. Les statistiques avancées manquantes ne sont pas un blocage pour publier un résultat valide.

Chaque mise à jour vérifie l’identifiant, le statut encore privé et la version `updated_at` de l’aperçu. Un match modifié ou déjà publié entre-temps est ignoré et signalé ; les modifications concurrentes ne sont pas écrasées. Le compte propriétaire est vérifié avant chaque écriture.

La publication est séquentielle, sans transaction globale. Le bilan indique les publications confirmées, blocages, modifications concurrentes, erreurs et opérations incertaines. Une erreur arrête la suite ; aucune tentative automatique n’est lancée. Si une réponse réseau manque, recharger l’aperçu et contrôler le statut avant de recommencer. Le filtre « encore privé » et la version protègent aussi une nouvelle tentative.

L’import CSV garde sa règle actuelle : mettre à jour un doublon conserve son statut de publication. Utiliser ce bouton pour publier les brouillons déjà importés.
