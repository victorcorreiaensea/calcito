# Statistiques par images

## Activation

1. Installer les migrations précédentes, notamment `005_europe_preparation.sql` si elle n’est pas encore installée.
2. Dans Supabase → SQL Editor → New query, coller puis exécuter `supabase/migrations/006_photo_import.sql` (copie identique téléchargeable : `public/downloads/calcito-import-photos.sql`). La migration est transactionnelle et réexécutable. Elle n’importe aucune rencontre et n’en publie aucune.
3. Ouvrir `#/admin` → **Statistiques par images**, puis **Actualiser**.
4. Saisir le code du lot fourni dans la conversation et cliquer sur **Charger les 72 captures préparées**. Le code est conservé hors du dépôt. Le fichier public `.calcito` contient uniquement du texte chiffré authentifié AES-256-GCM (PBKDF2-SHA256, sel et nonce aléatoires), compressé avant chiffrement. Aucun déchiffrement côté serveur ni secret API n’est nécessaire.
5. Pour chaque capture : agrandir la photo, vérifier les identifiants des clubs, corriger les informations, confirmer le fuseau et la journée, puis **Valider cette capture**. **Enregistrer à vérifier** permet de reprendre plus tard sans validation.
6. Sélectionner les captures vérifiées puis **Publier la sélection** et confirmer. Pour une publication individuelle, sélectionner seulement la capture voulue.

Les clubs trouvés par une correspondance de nom unique sont proposés avec leur véritable UUID ; une ambiguïté demande une sélection manuelle. Le rapprochement final est effectué en base par saison et UUID domicile/extérieur, puis contrôlé par date, journée et score. Une seule paire dans cette phase de ligue est attendue ; plusieurs rencontres possibles bloquent l’import. Aucun accès administrateur à distance n’est inclus dans le lot : le compte propriétaire doit l’importer.

Les informations de nouveaux clubs restent des propositions à confirmer. Une fiche n’est créée qu’à la publication d’une capture validée. Les informations requises sont nom, pays, championnat et slug ; aucun identifiant externe ou logo n’est inventé. Les sources privées restent associées aux captures et à leur audit. Les écussons et références externes vérifiés peuvent être complétés dans **Équipes** avec les champs existants. L’indice d’un club sans historique suffisant reste indisponible.

## Lot fourni

72 captures originales, 36 par compétition, 18 rencontres proposées dans chacune des journées 1 et 2. Toutes démarrent à l’état **À vérifier**, même après lecture et correction des erreurs OCR. Le regroupement Champions League par journées provient des dates : les numéros sont tronqués sur les photos. Le fuseau horaire n’est pas indiqué ; Europe/Paris est proposé à confirmer. Les résultats sont lus sur les captures fournies sans confirmation indépendante.

Les cartons jaunes ne sont pas visibles sur Bayer Leverkusen–Celje et H. Beer Sheva–Dinamo Zagreb. Ces quatre valeurs restent `null`. Notes, poteaux et cartons rouges non affichés restent également `null`. Aucune valeur vide ne devient zéro. L’extraction préparée ne constitue pas une API Flashscore et l’écran n’effectue pas d’OCR distant ; les prochaines photos envoyées à Codex pourront être préparées dans un nouveau lot.

## Persistance et publication

- `photo_import_captures` contient les originaux, l’extraction initiale immuable, le brouillon corrigé, la révision, l’état et l’identifiant du match publié. Lecture réservée au propriétaire par RLS ; aucune écriture directe pour `authenticated` ou `anon`.
- Les écritures passent par quatre RPC contrôlant le compte propriétaire. `photo_import_audit` conserve les versions et leur auteur. Cet historique est visible sous la capture.
- Le SHA-256 est recalculé côté PostgreSQL sur les octets de l’image. Le même original se réimporte sans doublon ; une extraction différente de la même image est signalée.
- Vérifier une capture ne crée pas de match public et ne modifie ni statistiques publiques, ni indices, ni banque, ni tickets.
- Un conflit de score, date, journée ou statistique non nulle bloque la validation. Pour garder la valeur en base, effacer la proposition correspondante. Pour corriger réellement une valeur déjà vérifiée, utiliser explicitement la correction du match puis revalider la capture. Une capture complémentaire retrouve la même rencontre sans la dupliquer ; après enrichissement par une autre capture, revalider son état avant publication.
- Publication atomique, dans l’ordre chronologique, avec contrôle de la révision du match et de toutes ses statistiques. Une modification concurrente impose une nouvelle vérification ; une nouvelle tentative après succès ne republie pas les matchs.
- La publication reprend les mécanismes existants de résultats, courbes, forme historique et règlement idempotent des Calcithunes. Les matchs européens ne changent pas les classements nationaux.
- Les nouvelles colonnes (`corners`, `passes_completed`, `passes_attempted`, `pass_accuracy`, `yellow_cards`, `red_cards`) sont disponibles en saisie, dans le détail des matchs publiés et en statistiques descriptives des équipes/comparaisons. Elles ne changent pas la formule V4 en place. Les anciens clients qui omettent ces colonnes les préservent.

## Validation technique

Tests PostgreSQL isolés : droits propriétaire/visiteur, empreintes, idempotence, conflits de score/statistiques, contrôle des révisions, données manquantes et zéro, création de club seulement à la publication, conservation des nouvelles colonnes par un ancien client, absence d’effet financier avant publication, chiffrement et intégrité du lot. Les tests et essais navigateur utilisent des données isolées, sans écrire dans la base réelle.
