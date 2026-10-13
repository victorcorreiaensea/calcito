# Six championnats 2026–2027 — relevé partiel du 13 octobre 2026

## Ce qui est prêt et ce qui est enregistré

Le catalogue contient 114 participants issus des calendriers OpenFootball 2026–2027. La lecture **publique, sans connexion propriétaire**, de Supabase a retrouvé 36 de ces fiches et leurs identifiants exacts. Une fiche supplémentaire, Portimonense, est conservée sans être inscrite à cette saison par cet outil. Les fiches privées sont examinées dans la session propriétaire avant toute création.

**Aucune écriture de production n’a été effectuée par le script de collecte.** Les 78 clubs supplémentaires et les quatre saisons manquantes sont préparés dans le site ; leur enregistrement nécessite la session administrateur existante. La validation de l’aperçu des matchs reste une étape distincte.

| Championnat    | Participants | Nouveaux clubs proposés | Résultats disponibles | Déjà publiés dans ce relevé | Ajouts proposés | Rencontres non renseignées |
| -------------- | -----------: | ----------------------: | --------------------: | --------------------------: | --------------: | -------------------------: |
| Ligue 1        |           18 |                       0 |                    49 |                           1 |              48 |                          3 |
| Liga Portugal  |           18 |                       0 |                    62 |                          59 |               3 |                          7 |
| Premier League |           20 |                      20 |                    60 |                           0 |              60 |                          0 |
| LaLiga         |           20 |                      20 |                    74 |                           0 |              74 |                          5 |
| Serie A        |           20 |                      20 |                    58 |                           0 |              58 |                          1 |
| Bundesliga     |           18 |                      18 |                    45 |                           0 |              45 |                          0 |
| Total          |          114 |                      78 |                   348 |                          60 |             288 |                         16 |

Ces nombres sont ceux du contrôle effectué le 13 octobre. L’administration recalcule les correspondances et doublons sur les données du compte connecté au moment de la préparation et de l’import.

## Enregistrer depuis l’administration

1. Administration → **Importer des matchs** → **Préparer les six championnats 2026–2027**.
2. Vérifier les participants, correspondances et écussons ; corriger les associations si une fiche privée existe déjà sous un autre nom.
3. Valider la case de contrôle, puis **Préparer les fiches et participants**. Les fiches françaises et portugaises sont réutilisées ; aucun club existant n’est renommé, supprimé ou remplacé. Les corrections de points et participants existants ne sont pas écrasés. Un club français ou portugais non reconnu bloque la préparation au lieu de créer un doublon.
4. **Prévisualiser les 348 résultats** : le relevé chargé utilise les identifiants internes réels des clubs, saisons et compétitions. Les anciens matchs sont ignorés par défaut. Les scores contradictoires sont signalés.
5. Contrôler l’aperçu, choisir brouillon ou publication, confirmer les sources, puis lancer l’import. L’ajout des rencontres alimente les historiques des deux équipes.

Les écussons des nouvelles équipes sont des URLs directes du répertoire public `luukhopman/football-logos`. Les 78 noms de fichiers et contenus PNG ont été vérifiés via l’API GitHub. Aucun identifiant API-Football n’a été déduit ou inventé. La table de correspondance conserve l’origine de chaque image ; les écussons restent les marques de leurs clubs. Le dépôt source ne précise pas de licence sur les images : ne pas présenter ces images comme appartenant à Calcito ou sous licence CC0. Les fichiers binaires ne sont pas copiés dans le dépôt Calcito. Le contrôle de correspondance visuelle dans l’administration reste requis.

## Sources et limites de couverture

Les résultats proviennent d’OpenFootball, dédié au domaine public sous CC0 1.0 :

- https://github.com/openfootball/football.json/blob/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json
- mêmes chemins pour `pt.1.json`, `en.1.json`, `es.1.json`, `it.1.json`, `de.1.json`.
- Licence : https://github.com/openfootball/football.json/blob/master/LICENSE.md
- Écussons de référence : https://github.com/luukhopman/football-logos

**Le relevé est partiel, avec des matchs datés jusqu’au 12 octobre 2026.** Les 312 résultats OpenFootball ont été confrontés aux fiches de saison datées de 81 clubs accessibles sur Wikipédia. Les rencontres sont identifiées par deux clubs connus, une date explicite et une section de championnat national ; les matchs européens, coupes et amicaux sont exclus de ce fichier de résultats des six ligues.

Cette seconde lecture a ajouté **42 résultats**, avec la date et le score repris ensemble de la fiche du match. 244 rencontres initiales ont pu être corroborées. Six rencontres donnent des **dates différentes** selon les sources : elles sont retirées du CSV final, sans choisir arbitrairement une date ni modifier les matchs existants. Le bilan reste donc de **348 rencontres**. Trois de ces rencontres litigieuses sont déjà publiées au Portugal ; elles restent conservées dans la base en attendant une vérification indépendante.

| Rencontre                         | Date OpenFootball | Date Wikipédia |
| --------------------------------- | ----------------- | -------------- |
| Rennes – Olympique de Marseille   | 11 septembre      | 13 septembre   |
| Olympique de Marseille – Paris FC | 6 septembre       | 5 septembre    |
| FC Porto – Moreirense             | 4 septembre       | 6 septembre    |
| Casa Pia – FC Porto               | 12 septembre      | 13 septembre   |
| Casa Pia – SL Benfica             | 17 août           | 16 août        |
| Atalanta – Cagliari               | 12 septembre      | 11 septembre   |

Il reste **16 rencontres calendaires non renseignées** : France 3, Portugal 7, Espagne 5 et Italie 1 (aucune en Angleterre ou Allemagne dans les calendriers consultés). Elles ne sont pas importées. Un score absent ne prouve ni que le match s’est joué ni qu’il a été annulé. La liste séparée ne doit pas être importée sans complément vérifié. La collecte n’infère jamais une date depuis la matrice des scores : les compléments nécessitent une fiche datée.

Les pages de clubs sont disponibles sous **CC BY-SA 4.0**. Chaque complément conserve son URL source ; la conversion associe les noms aux fiches Calcito. Attribution à Wikipédia et à ses contributeurs, modifications : sélection des rencontres, noms internes, conversion CSV. Les adaptations sont partagées sous CC BY-SA 4.0 : https://creativecommons.org/licenses/by-sa/4.0/. Les données OpenFootball restent CC0. Les licences des résultats ne s’appliquent pas aux écussons.

Les dates calendaires et scores sont repris des fichiers sources figés, validés structurellement et comparés aux matchs déjà publiés ; les contradictions de dates sont exclues. Ce n’est pas une confirmation indépendante auprès des six fédérations. Aucun décalage horaire n’est supposé : le CSV conserve la date seule. Les tirs, tirs cadrés, grosses occasions et notes sont absents de cette source et restent vides.

La collecte complémentaire utilise des requêtes ordinaires identifiées, espacées et arrêtées en cas de refus ou de limitation. Elle ne passe pas par Flashscore et ne contourne aucune protection. Le fichier source géant contient tous les résultats renseignés disponibles dans ces six relevés, une ligne par rencontre ; il n’est pas vendu comme une couverture complète de la saison.

Fichiers publiés :

- `public/downloads/calcito_resultats_2026_2027.csv` : 348 résultats, 16 colonnes compatibles avec l’import existant.
- `public/downloads/calcito_correspondance_equipes_2026_2027.csv` : noms sources, noms exacts publiés, identifiants internes connus, origine des écussons. Les nouvelles fiches n’ont pas d’identifiant interne avant leur création ; télécharger la correspondance complète depuis la session admin après préparation.
- `public/downloads/calcito_matchs_non_renseignes_2026_2027.csv` : liste séparée de rencontres à vérifier.
- `public/downloads/calcito_dates_a_verifier.csv` : six rencontres exclues pour dates contradictoires, sources conservées, aucune correction automatique.
- `public/data/season-2026-2027.json` : manifeste traçable, participants, sources et bilan par championnat.

## Indice résultats provisoire — version results-points-v1

Autorisé par le propriétaire comme méthode **distincte** de sa formule propriétaire qui n’est pas intégrée.

Pour les cinq derniers résultats valides de la saison, toutes compétitions enregistrées confondues :

`indice = 100 × (3 × victoires + matchs nuls) / 15`

Les trois points par victoire et un point par nul sont la convention habituelle du football. Le dénominateur 15 est le maximum obtenu sur cinq matchs, pas un coefficient appris. Cinq victoires donnent 100, cinq défaites 0, cinq nuls 33,3. L’affichage arrondit à une décimale ; les tris conservent la précision du calcul.

Aucun poids temporel, coefficient européen, bonus ou pondération de buts n’est inventé. Les buts pour/contre sont conservés séparément et dans l’historique. Les statistiques manquantes ne sont jamais zéro. Le même calcul sur les résultats s’applique aux clubs ayant des données avancées : leur présence ne pénalise ni ne favorise l’indice provisoire. L’étiquette indique aussi la couverture avancée des cinq matchs : complète, mixte ou simplifiée.

Ce modèle **n’est pas un hybride mathématique de la formule Calcito complète** et n’est pas une probabilité de victoire. Ses rangs sont comparables uniquement dans le groupe `results-points-v1`. Une future formule propriétaire validée peut utiliser ses snapshots complets, dans un groupe distinct. L’échelle 0–100 commune ne prouve pas l’équivalence des deux méthodes.

Sans cinq résultats valides, l’indice reste indisponible. Les compléments allemands portent le relevé à 45 résultats : cinq matchs par club. Les indices restent indisponibles pour toute équipe dont les cinq résultats nécessaires ne sont pas publiés.

L’indice provisoire est dérivé des données courantes et recalculé automatiquement lorsque les données publiées changent. L’enrichissement statistique met à jour l’étiquette de couverture ; il ne modifie pas la méthode fondée sur les seuls résultats. Les versions et coefficients propriétaires existants restent inchangés.

## Vérification technique

Les tests en PostgreSQL isolé utilisent les politiques RLS et RPC existantes : 78 nouvelles équipes, anciennes fiches conservées, corrections de points préservées, 348 imports confirmés, 696 lignes statistiques avec valeurs inconnues nulles, second import de 348 doublons ignorés, écritures anonymes refusées. Ce test ne touche pas Supabase en production.

La préparation du catalogue enregistre les fiches séquentiellement. Ce n’est pas une transaction globale : en cas d’échec, recharger et examiner le catalogue avant de réessayer. Les insertions déjà confirmées sont ensuite réutilisées. Les sauvegardes de matchs conservent leur atomicité par rencontre et la gestion des incertitudes réseau de l’import existant.

Aucune migration supplémentaire, aucune clé privée et aucun nouvel accès en écriture public n’est nécessaire.

## Reproduire la collecte

Les workflows manuels de lecture n’ont que `contents: read`. `collect-licensed-club-results.yml` lit les liens de clubs vérifiés dans `scripts/season-club-references.json` et exporte uniquement des rencontres datées avec leur contexte de compétition. Les matrices ont au maximum deux requêtes simultanées, avec une pause d’une seconde entre les pages. Aucun accès privé n’est utilisé.

Une fois les six fichiers JSON OpenFootball, les quatre listes de logos GitHub, le SHA source, l’inspection publique et les six sorties `licensed-<slug>.json` enregistrés dans un dossier de sources, lancer `python3 scripts/merge-licensed-season-results.py <dossier>`. Ce script reconstruit le relevé de base, associe uniquement des identités explicites, ajoute les compléments datés, exclut les dates contradictoires et régénère les CSV et le manifeste. Le cutoff reste explicitement le 13 octobre 2026 ; ce n’est pas une synchronisation quotidienne du site.
