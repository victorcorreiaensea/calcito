# Calcito V5 — Arène, Calcithunes et Coach

L’Arène est un jeu gratuit, avec une monnaie fictive sans achat, retrait, conversion, classement rémunéré ni récompense financière. Le fond noir, le bleu électrique choisi pour Calcito et la mascotte sont conservés ; la pièce Calcithune est un SVG doré original. La forme dynamique V4 n’est pas modifiée et ses indices historiques restent ceux d’avant la rencontre.

## Activation dans le projet Supabase existant

Le déploiement GitHub Pages publie l’interface ; il ne peut pas installer une migration dans un Supabase auquel l’environnement n’a aucun accès propriétaire. Il ne suffit pas de déployer pour activer les portefeuilles.

1. Ouvrir [le script SQL](https://github.com/victorcorreiaensea/calcito/blob/main/supabase/migrations/003_arena.sql). Sur GitHub, utiliser **Copy raw file** (bouton de copie du contenu). Ou télécharger le même fichier depuis Administration → **Arène & cotes**.
2. Dans le projet Calcito sur Supabase, ouvrir **SQL Editor → New query**. Coller **tout** le script de la migration **003**, puis cliquer **Run** une seule fois. Le projet doit déjà posséder les migrations 001 et 002, utilisées par l’administration actuelle. Ne pas les réexécuter. La migration 003 est transactionnelle et ne supprime aucun résultat existant. Le message attendu est **Success. No rows returned**.
3. Dans **Authentication → URL Configuration**, définir **Site URL** et ajouter une **Redirect URL** égale à `https://victorcorreiaensea.github.io/calcito/`. Conserver les autres redirections légitimes existantes. Les jetons de confirmation sont consommés puis retirés de l’URL avant de charger le routeur.
4. Dans **Authentication → Sign In / Providers**, vérifier que la connexion par e-mail est activée et que la création de comptes est autorisée pour les visiteurs. La confirmation par e-mail peut rester activée. Un visiteur authentifié n’obtient **aucun** droit administrateur : seuls les comptes déjà présents dans `admin_users` possèdent ces droits.
5. Sur le site, ouvrir **Administration → Arène & cotes → Recharger l’état**. Les portefeuilles et missions peuvent fonctionner immédiatement après la migration. Cliquer **Tester et calibrer sur l’historique** pour le contrôle des cotes. Un contrôle refusé conserve les cotes désactivées : compléter de vrais résultats antérieurs vérifiés, puis retester. Ne pas importer de faux résultats pour débloquer le modèle.
6. Dans **Saisie par journée**, cocher **Préparer une journée à venir (sans scores)**, choisir compétition, saison et journée. Générer les lignes, renseigner les vraies équipes, dates et heures, choisir le fuseau officiel. Ajouter une source autorisée. Enregistrer les seules lignes remplies en brouillon, puis publier les rencontres vérifiées depuis **Matchs & brouillons**.
7. Les utilisateurs entrent depuis [L’Arène](https://victorcorreiaensea.github.io/calcito/#/arene). Leur premier accès authentifié initialise un portefeuille de **200 C** exactement une fois. Les comptes et montants restent dans Supabase, sur tous les appareils.
8. Après un match, modifier le match existant : statut **Terminé**, score principal officiel, source contrôlée et publication. La validation en base règle les tickets et les montants dans la même transaction. Actualiser l’Arène pour afficher les nouveaux soldes. Recalibrer avant les prochaines nouvelles cotes après une modification de résultat.

Aucune clé secrète, fonction Edge payante ou nouvel hébergement n’est nécessaire. Le plan gratuit Supabase suffit pour démarrer dans ses quotas, sans garantie de volume illimité. Le service d’e-mails de test de Supabase limite fortement les envois et peut ne pas délivrer aux visiteurs hors équipe ; avant une ouverture publique, configurer un fournisseur SMTP compatible avec un quota gratuit dans Authentication. Les règles de bankroll fonctionnent indépendamment de cette configuration. Ne pas partager de mot de passe ou clé `service_role`.

## Montants, limites et budgets

- Les montants sont des **entiers de centimes** en PostgreSQL : 1 C = 100 centimes. La saisie accepte `2,50` ou `2.50` ; trois décimales et les valeurs négatives sont refusées.
- Bankroll = disponible. Les engagements réservés sont séparés. Le solde détenu est disponible + réservé, affichés distinctement.
- Engagement maximal = `min(1000, floor(disponible / 20))` centimes. Ainsi 50,01 C autorisent **2,50 C**, jamais 2,51 C. Un disponible inférieur à 0,20 C ne permet aucun ticket au centime : les missions pédagogiques restent accessibles gratuitement.
- En mode défi, l’engagement du joueur est la **mise totale** du ticket, même pour un combiné. Le robot réserve le bénéfice potentiel. En mode bookmaker, Calcito mise ; le joueur réserve la **responsabilité maximale**, soit le bénéfice qu’il devra au robot si celui-ci réussit. C’est cette responsabilité qui respecte les 5 % / 10 C.
- Calcito possède une réserve initiale finie de **2 000 C**, partagée entre les utilisateurs. Son risque par ticket suit aussi les 5 % du disponible / 10 C. Aucun rechargement automatique illimité n’existe : un budget épuisé bloque les nouveaux engagements qui ne peuvent être couverts.
- Toutes les réservations sont financées à l’avance. Une cote élevée peut nécessiter une mise inférieure au plafond du joueur pour que le robot puisse couvrir son bénéfice potentiel.
- Les cotes sont des décimales PostgreSQL ; les produits ne sont pas arrondis entre les sélections. Le retour brut est arrondi **vers le bas au centime** à la fin. L’aperçu utilise des rationnels `BigInt`, pas une multiplication monétaire à virgule flottante. Les cotes affichées abrégées ne remplacent pas celles figées en base.
- Exemple pédagogique : 1,80 × 1,60 × 1,90 = **5,472** ; mise 5 C ; retour brut **27,36 C**, bénéfice **22,36 C**. Cela illustre le calcul, sans prétendre que ces affiches ou cotes existent sur le site. Le budget du robot peut empêcher ce ticket précis.
- Refus bookmaker : rendement estimé `p × cote − 1` inférieur ou égal à **5 %**, coût **0 C**, aucun ticket réservé. Un rendement supérieur ne garantit pas un résultat favorable. Les contrôles de budget restent obligatoires même si le robot trouve l’offre intéressante.

## Modèle probabiliste indépendant

Version : `poisson-goals-v1`. C’est un modèle provisoire testable, distinct de l’indice propriétaire et de la forme V4. Il n’utilise pas une conversion de forme en probabilité.

Pour chaque équipe, il prend les cinq derniers résultats complets, publiés, vérifiés de la même année de saison. Moyennes des buts marqués/encaissés et références de buts à domicile/extérieur dans la compétition sont combinées. Les buts attendus domicile sont `(1 − poids) × moyenne domicile du championnat + poids × (buts marqués de l’équipe + buts encaissés adverses) / 2` ; calcul symétrique extérieur. Les valeurs sont bornées entre 0,2 et 4,5. Deux lois de Poisson indépendantes sont évaluées de 0 à 20 buts puis normalisées. Ce modèle simple ne prétend pas représenter toutes les interactions entre équipes.

Les informations utilisées sont strictement antérieures au **jour UTC** du coup d’envoi : tous les résultats du même jour sont exclus pour éviter les fuites temporelles et les heures historiques approximatives. Il faut au moins **30 résultats antérieurs dans la saison de compétition** et **5 par équipe**. Les résultats rapides sans rencontre complète ne permettent pas de reconstruire les deux équipes pour cette version ; ils restent utilisés par les fonctionnalités existantes de forme.

Le poids 0,25 / 0,50 / 0,75 est sélectionné sur une tranche antérieure d’au moins **100 rencontres éligibles**, en minimisant la LogLoss 1/N/2. Une tranche chronologique de contrôle récente, distincte de l’apprentissage, comprend au moins **60 rencontres éligibles** (coupure à partir des 80 rencontres brutes les plus récentes, sans scinder une journée UTC). Le modèle doit obtenir une LogLoss et un Brier au moins aussi bons que la référence constante 45 % / 27 % / 28 %. Cela constitue un premier seuil de contrôle, pas une preuve universelle de calibration, de fiabilité future ou de supériorité au marché. Le rapport conserve les métriques et les effectifs réellement mesurés.

Les autres marchés classiques passent aussi un contrôle de LogLoss binaire contre leur fréquence historique d’apprentissage, avec un lissage Beta(1,1). **Seuls les marchés retenus** sont proposés, si le contrôle global est réussi. Les données insuffisantes, une validation négative ou une compétition sans historique suffisant donnent **aucune cote**. Les 1/N/2 sont normalisés à 100 % ; les pourcentages affichés sont arrondis. Les marchés à probabilité estimée inférieure à 2 % ou supérieure à 98 % ne sont pas proposés.

Les nouvelles cotes expirent après 15 minutes au maximum, au plus tard au coup d’envoi. Leur propriétaire, version de modèle, instant du modèle et révision de rencontre sont vérifiés sur le serveur. Les cotes déjà engagées restent figées. Toute correction de résultat suspend les nouvelles cotes jusqu’au prochain contrôle.

## Marchés et règlement

Cette version utilise le **score principal `goals_home` / `goals_away` officiellement enregistré**. Elle n’ajoute pas les champs de prolongation ou de tirs au but au score principal. L’administrateur doit suivre la même convention lorsqu’il saisit les résultats ; ce jeu ne promet pas les conventions de règlement d’un bookmaker réel.

- 1 / N / 2 : comparaison des buts domicile et extérieur ; égalité = N.
- Double chance : union des résultats correspondants (`1X`, `12`, `X2`).
- Plus/moins de 1,5 / 2,5 / 3,5 : somme des buts principaux, comparée au seuil.
- Les deux équipes marquent : chacune possède au moins un but principal.
- Clean sheet domicile/extérieur : adversaire à zéro.
- Nombre exact de buts domicile/extérieur : égalité à 0, 1, 2, 3, 4 ou 5, selon le marché sélectionné ; au-delà, ces marchés exacts perdent.
- Tirs, notes, grosses occasions et autres statistiques : **désactivés**, car aucun modèle et aucune disponibilité de règlement garantie ne sont encore fournis.

Un ticket simple possède une sélection ; un combiné 2 à 10 sélections. Une seule sélection par rencontre et aucun club commun entre rencontres : ces contrôles conservateurs bloquent les corrélations évidentes. La probabilité du combiné reste une **approximation sous indépendance**, pas une certification d’indépendance entre championnats.

Une sélection perdante fait perdre le défi ; toutes réussies le font gagner. Une sélection annulée/reportée est neutralisée à la cote **1,00** ; si elles sont toutes neutralisées, les engagements sont rendus. Cette neutralisation persiste après reprogrammation. Une modification d’équipes/compétition ou d’horaire d’une rencontre encore à venir neutralise les sélections existantes. Une rencontre corrigée dont le vrai coup d’envoi précède la création du ticket est neutralisée également.

En mode bookmaker, Calcito possède la sélection. Si elle réussit, il reçoit sa mise et le bénéfice réservé par le joueur ; si elle échoue, le joueur reçoit sa responsabilité réservée et la mise de Calcito. Annulation = chacun retrouve son engagement. Le statut gagné/perdu affiché dans le profil est toujours celui du joueur.

Les résultats sont saisis par le propriétaire, pas vérifiés auprès d’une API externe. L’Arène ne dispose pas d’une tâche serveur d’import ou de règlement planifié : le **déclencheur PostgreSQL** règle automatiquement les tickets lorsqu’un résultat officiel est sauvegardé. Aucun résultat ne peut être validé avant le coup d’envoi.

## Corrections, sécurité et historique

Authentification Supabase ; tables sous RLS ; lectures personnelles seulement. Les utilisateurs ne peuvent écrire aucun solde, quote, ticket, transaction, mission, modèle ou réserve. Les fonctions internes `SECURITY DEFINER` sont inaccessibles aux rôles visiteurs. Chaque fonction publique financière déduit le compte de `auth.uid()`, jamais d’un identifiant choisi par le navigateur.

Les mouvements partagent un verrou transactionnel global ; crédits, réserves et tickets sont atomiques. Les clics et requêtes répétées utilisent un nonce unique par utilisateur avec empreinte exacte du contenu. Une réponse réseau inconnue conserve cet identifiant ; l’interface permet de vérifier l’historique ou de rejouer exactement la demande, même après rechargement de l’onglet. Seule cette intention de requête peut être conservée temporairement dans `sessionStorage` : jamais un portefeuille ou un ticket prétendument confirmé. Une demande différente avec le même identifiant est rejetée.

Le règlement est idempotent. Une correction officielle inverse les crédits précédents et l’expérience liée à ce ticket avant recalcul, avec un journal de correction. Si des crédits ont déjà été consommés, un **ajustement fictif** est enregistré ; le disponible reste non négatif et aucun paiement réel n’est demandé. Les missions gratuites ou prochains retours compensent cet ajustement avant de redevenir disponibles. Les autres engagements restent réservés.

Pour corriger un score, modifier le match existant ; ne pas recréer une rencontre. Pour une annulation/report faite par erreur, **Arène & cotes → Correction d’une annulation erronée** exige une justification et une vérification explicite. Ce droit reste propriétaire uniquement ; le journal spécifique est conservé. Les matchs référencés par une quote/ticket ne sont plus supprimables : annuler ou corriger pour conserver l’audit.

Le profil présente les 100 derniers tickets et opérations pour rester compact. **Exporter tout mon historique** lit l’intégralité des tickets, sélections, transactions et missions personnels depuis le serveur et crée un fichier JSON. Les montants ne sont jamais éditables dans cette vue.

## Niveaux, missions et comparaison

L’expérience est comptée séparément du disponible, en centimes de C gagnées. Le crédit initial de 200 C n’accorde pas d’expérience. Chaque bénéfice net positif d’un ticket et chaque mission récompensée ajoutent la même valeur à l’expérience. Une mise ou perte ne fait pas descendre de niveau ; une correction officielle peut retirer l’expérience d’un gain annulé. Les récompenses de missions déjà validées restent acquises, une seule fois par période/compte.

Seuils cumulés : Débutant 0 C ; Amateur **100 C** ; Analyste 500 C ; Expert 1 500 C ; Stratège 4 000 C ; Maître Calcito 10 000 C. Les titres et badges sont cosmétiques, sans modifier le modèle.

Missions gratuites : question quotidienne 2 C, question hebdomadaire 5 C, compréhension de la forme une fois 10 C. Les périodes utilisent Europe/Paris (semaine ISO). Missions permanentes facultatives : premier ticket 2 C, trois tickets réussis 5 C, premier combiné réussi 5 C. Les réponses et accomplissements sont contrôlés en base ; une demande répétée ne crédite pas deux fois. Il n’existe pas de mission obligeant à miser pour récupérer une perte.

« Qui connaît le mieux le football ? » compare les mêmes rencontres : premier choix joueur **1/N/2** accepté par match, contre le choix 1/N/2 de probabilité maximale figé lors de sa quote. Les refus, neutralisations et résultats non vérifiés sont exclus. Les gains fictifs sont affichés séparément. Le graphique de précision cumulative place les résultats à leur date réelle. Les autres marchés n’entrent pas dans ce duel pour éviter de comparer un choix BTTS facile à une prédiction 1/N/2.

## Vérifications

`npm test` inclut les domaines existants et une base PostgreSQL locale isolée PGlite appliquant réellement les migrations 001, 002 et 003. Les tests couvrent RLS, absence d’écriture directe, plafonds exacts, réserve/disponible, propriétaire des quotes, expiration, anti-doublon, combinés corrélés, validation future interdite, règlement/correction, neutralisation persistante, contrôle administrateur, missions idempotentes, ajustements et export privé. Les probabilités normalisées, absence de résultats du même jour et validation chronologique complète sont vérifiées sur des données **synthétiques en base isolée seulement** ; cela ne prouve pas les performances du projet distant.

Le navigateur est vérifié de 320 à 1 440 pixels avec le vrai SDK Supabase et des réponses de test interceptées localement : état migration absente sans faux solde, authentification, missions, limite, bookmaker, reprise après réponse perdue/rechargement et profil. Les anciennes courbes V4 et la saisie par journée sont vérifiées séparément. Aucun test ne publie de matchs fictifs dans Supabase.
