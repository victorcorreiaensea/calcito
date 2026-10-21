# Étape 2 — cerveau statistique, version de recherche

État au 21 octobre 2026 : **expérimental**, aucune activation dans l’Arène. Aucun changement de schéma, aucune écriture Supabase. Les chiffres ci-dessous proviennent des fichiers du dépôt, pas d’un audit de la production.

## Données effectivement examinées

La lecture publique Supabase depuis l’environnement de développement échoue au tunnel réseau (`CONNECT 403`). Aucun contournement ni changement de droits. Impossible de certifier le contenu actuel de la base ou de mesurer une performance prédictive réelle à partir de celle-ci ici.

Audit reproductible : `node scripts/audit-statistical-research.mjs`. Résultat complet, dont la couverture par club et compétition : [statistical-data-audit.json](reports/statistical-data-audit.json).

| Source locale                     | Rencontres | Couverture constatée                                                                           |
| --------------------------------- | ---------: | ---------------------------------------------------------------------------------------------- |
| Relevé Champions League 2026–2027 |         36 | 36 clubs, deux matchs par club                                                                 |
| Relevé Europa League 2026–2027    |         36 | 36 clubs, deux matchs par club                                                                 |
| CSV national 2026–2027            |        348 | Portugal 62, Espagne 74, France 49, Angleterre 60, Italie 58, Allemagne 45 ; scores uniquement |

Sur les **144 observations équipe-match** européennes : tirs, tirs cadrés, corners, possession, xG, grosses occasions, passes réussies/tentées/précision : **144/144** ; jaunes **140/144** ; rouges **10/144** ; poteaux et note **0/144**. Ce relevé est une lecture des captures fournies par le propriétaire, sans vérification indépendante. Les propositions de fuseau/journée restent à vérifier dans la source.

Le CSV national ne renseigne aucun tir/tir cadré. Il ne contient pas les dates de vérification, publication ou modification. Le relevé européen ne contient pas non plus les timestamps de saisie des statistiques : **zéro prédiction réelle historiquement évaluée à partir de ces fichiers**, aucun Brier/log loss réel annoncé. Des timestamps artificiels n’ont pas été ajoutés pour fabriquer un backtest.

Le site utilise son dataset public existant : chaque nouvelle saisie publiée et vérifiée enrichit automatiquement les profils, puis devient une observation antérieure pour les futurs matchs. L’audit dynamique retourne la couverture par champ, équipe, compétition et saison sélectionnée ; seuls les parents publiés, résultats cohérents et dates exploitables sont admissibles. Les brouillons et doublons conflictuels ne sont pas utilisés.

## Modèles préservés et ajoutés

| Modèle                                      | Rôle et décision                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `results-context-v2`, `results-relative-v4` | Indices historiques inchangés, y compris surprises et snapshots avant match.                                                                       |
| `poisson-comparator-v1`                     | Probabilités, événements, Top 3 existants inchangés. Test de compatibilité exact conservé.                                                         |
| `poisson-goals-v1` SQL de l’Arène           | Inchangé ; calibration serveur existante, apprentissage ≥100 et contrôle ≥60 avec règles financières actuelles. Aucun appel de calibration ajouté. |
| `form-research-v1`                          | Six signaux alternatifs descriptifs, sans combinaison arbitraire ni remplacement de l’indice historique.                                           |
| `statistics-research-v1`                    | Population, attaque/défense récente, répartition domicile/extérieur, correction adversaires, variantes tirs et tirs cadrés étudiées séparément.    |
| Comptages Poisson / binomiale négative      | Modèles autonomes pour tirs cadrés ≥3/4/5 et corners ≥4/6/8, par équipe ; les seuils corners sont des hypothèses d’étude déclarées.                |

Le nouveau modèle de buts de base mélange 50 % de moyenne de compétition et 50 % d’attaque/défense récentes (chacune 25 %). C’est une **hypothèse fixe**, pas un coefficient annoncé comme optimal. Moyennes de buts selon le terrain ; terrain neutre utilise la moyenne des deux côtés. Variante domicile/extérieur : au moins trois observations du même terrain ; variante adversaires : au moins cinq observations de chaque adversaire, calculées avant la rencontre concernée. Les intensités sont bornées à 0,05–6 et tout écrêtage est signalé.

Les variantes tirs et tirs cadrés remplacent la mesure d’attaque/défense par le volume observé multiplié par le taux buts/statistique de la compétition connu à cette date. Elles restent des **candidats d’ablation**, jamais ajoutées ensemble. Le xG, la possession, les passes et les cartons restent descriptifs : aucun apport prédictif démontré ici.

Les variantes de forme comparent points/3, différence de buts, résidu résultat–contexte terrain/adversaire, différence de tirs, ratio tirs cadrés/tirs et tirs cadrés concédés. Normalisation en rang centile dans la population antérieure (points et résidu ont une échelle bornée explicite). Aucun cumul de tirs et tirs cadrés. L’erreur étudiée est le carré de l’écart entre la différence d’indices /100 et le signe du résultat suivant, avec référence points seuls sur les mêmes matchs. Ce critère descriptif est une hypothèse de recherche, **pas une probabilité ni une validation de la formule propriétaire**.

**Variables supplémentaires retenues pour activation : aucune.** Une amélioration mesurée sur un échantillon de test artificiel ne permet pas de les choisir pour les matchs réels.

## Disponibilité et preuves manquantes

- Buts : même compétition/saison, ≥30 résultats, ≥5 par équipe, fenêtre de 180 jours. Pas de mélange championnat/coupe pour atteindre un seuil. Compétition ambiguë en simulation : pas de nouvelles probabilités.
- Comptages : ≥8 observations exploitables pour chaque équipe (attaque propre / statistique concédée par l’adversaire), couverture ≥60 % sur les 20 derniers matchs, ≥60 observations équipe-match dans la compétition, fenêtre de 180 jours. Variance de comptage estimée uniquement sur les observations antérieures ; la binomiale négative utilise une dispersion par moments et retombe sur Poisson en absence de surdispersion.
- Relevé européen actuel : il manque **au moins trois matchs par club** pour le seuil de buts, **six observations statistiques par club** pour les comptages. Atteindre ces seuils permet seulement un calcul expérimental, pas une certification.
- Validation : seuil d’étude déclaré de **200 prédictions évaluables**, ≥60 en développement pour proposer un candidat et ≥60 en contrôle chronologique. Ces seuils ne garantissent pas la fiabilité. Il faut une amélioration Brier **et** log loss, une calibration et une stabilité suffisantes par compétition et marché sur une période prospective indépendante. Le moteur liste les insuffisances chiffrées dans `selection.evidenceGaps`.
- Même en présence d’un candidat prometteur, `activated:false` et `retainedAdditionalVariables:[]`. Aucun score ne devient validé automatiquement ; une future décision explicite devra examiner les preuves indépendantes.

**Marchés nouveaux** : buts/1N2/BTTS/totaux calculables en expérimental si seuils atteints ; sinon indisponibles. Tirs cadrés/corners indisponibles avec deux matchs par club ; expérimentaux dès seuils atteints, jamais annoncés validés. Aucune cote théorique nouvelle n’est affichée. `validatedTheoreticalOdds` prévoit 1/p seulement pour un statut explicitement validé ; 0, absent ou expérimental donne `null`. Aucun fournisseur de cotes connecté.

## Validation chronologique et limites

`validateResearch` traite jusqu’aux 300 derniers résultats admissibles (paramètre borné à 600), dans l’ordre. Chaque prédiction reconstruit les moyennes et niveaux adverses avec les seules lignes connues **avant** le match ; le jour cible entier est exclu pour les dates à précision insuffisante. Une statistique exige ses deux timestamps `created_at` et `updated_at`, tous deux antérieurs au cutoff. Un résultat corrigé tardivement est exclu des prédictions antérieures ; ses statistiques aussi.

Comparaisons : Brier multiclasses non divisé par trois (0–2), log loss avec plancher numérique 1e−12, Brier/log loss binaires séparés pour six événements et calibration en dix classes. Référence simple : fréquences antérieures de la même compétition, lissées +1. Les scores V1 et nouveau moteur sont comparés **sur les mêmes rencontres admissibles**. Chaque marché de comptage a son nombre de matchs, ses erreurs et sa référence empirique antérieure.

Séparation développement/contrôle à 60 % des jours complets de la fenêtre cible ; la variante candidate est choisie uniquement sur le développement par différence de Brier appariée à la référence. La période de contrôle ne choisit aucun coefficient/variable. Rejouer une nouvelle fenêtre n’est pas un test prospectif indépendant. Tous les marchés ne partagent pas le même support : les métriques rapportent leurs propres effectifs. Les intervalles approximatifs sur l’écart de Brier ignorent les corrélations entre matchs : ils ne certifient rien.

Les erreurs par match sont conservées dans les traces retournées en mémoire ; **pas d’archivage serveur persistant ajouté**. Les timestamps actuels permettent un rejeu conservateur, pas la reconstitution des versions effacées. Un import massif saisi aujourd’hui ne peut pas servir de variables connues hier. Pour une validation prospective solide, il faudra sauvegarder avant chaque coup d’envoi les prédictions figées, versions, identifiants/dates des observations et compétition, puis évaluer plus tard sans réajuster la sélection sur le contrôle. Les tables historiques existantes pourront être étudiées pour cet usage ; aucune migration ni écriture n’est exécutée à cette étape.

## Intégration et fichiers

`predictionService.js` conserve tous ses champs V1 et ajoute uniquement `research`, produit par `statisticalResearchService.js`. Les modules dédiés se trouvent dans `src/engines/statistics/` : `data.js`, `profiles.js`, `form.js`, `probabilities.js`, `validation.js`, `odds.js`. Un volet replié `StatisticalResearch.jsx` dans `Compare.jsx` affiche la couverture et l’état de la recherche, sans refonte CSS. Personnalité, négociation, Top 3, mises, Calcithunes et RPC de l’Arène ne sont pas modifiés.

Audit sur un futur export **public** complet :

```sh
node scripts/audit-statistical-research.mjs /chemin/dataset-public.json /tmp/audit.json
```

Format : `{teams, competitions, seasons, matches, stats, simplified}` ; conserver les vrais identifiants et timestamps. Aucun secret de session n’est nécessaire. Le script lit des fichiers et écrit un rapport local, sans requête ni écriture en base.

Tests ajoutés : null/zéro et dénominateurs, ratios appariés, dates de saisie tardives/absentes, données invalides et dupliquées, scores seuls, modèles et complémentaires, symétrie terrain neutre, historiques courts/anciens, extrêmes, données futures sans effet, reproductibilité, métriques/calibration, pas de cotes non validées, saisies rapides/dédoublonnage et service sans mutation. Les fixtures sont synthétiques ; leurs scores ne sont pas des résultats de validation réelle.

## Vérifications exécutées

- `npm test` : **122 tests réussis**, dont 11 nouveaux tests statistiques ; aucune régression détectée dans les tests SQL/financiers de l’Arène.
- `npm run build` : réussi.
- Chromium avec dataset synthétique intercepté : affichage du volet ouvert et fermé, modes réel/simulation, données absentes, erreurs/rechargement, anciennes interactions et largeurs 320–1440 px ; aucun débordement global, aucune erreur JavaScript et aucune écriture en base observée.

Ces vérifications valident le fonctionnement du logiciel, pas la performance prédictive réelle du modèle.
