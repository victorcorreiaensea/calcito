# Bilan — 72 relevés européens

État de préparation : 72 captures lues, 72 rencontres proposées, 72 clubs couverts et 72 écussons vérifiés. Les nouveaux ZIP sont identiques aux premiers : aucun nouveau fichier à analyser.

**Aucune écriture dans la base de production n’a été exécutée par Codex pour ce lot.** Le SQL fourni enregistre les vrais brouillons et renvoie les nombres réels de clubs créés, UUID réutilisés, rencontres complétées et conflits. Ce bilan ne prétend pas connaître les brouillons privés actuels de Supabase.

L’import ne publie aucun match. Les équipes déjà présentes sont réutilisées selon identité et pays ; les écussons existants sont préservés. Aucune valeur d’indice n’est créée.

## Vérifications nécessaires avant publication

- Fuseau Europe/Paris proposé : il n’apparaît pas sur les captures.
- Journées Champions League 1/2 proposées par groupes de dates ; numéros tronqués.
- Cartons jaunes absents sur Bayer Leverkusen–Celje et H. Beer Sheva–Dinamo Zagreb : quatre valeurs nulles.
- Notes, poteaux et cartons rouges non visibles restent nulls.
- Championnat national 2026–2027 de SC União Torreense à confirmer.
- Résultats lus sur les captures transmises ; aucune confirmation indépendante des résultats auprès de l’UEFA.

## Rencontres proposées

| Référence | Compétition | Journée proposée | Domicile | Score | Extérieur | Date affichée |
|---|---|---|---|---|---|---|
| CL-01 | champions-league | 1 | AEK | 1–0 | LASK | 2026-09-08 18:45 |
| CL-02 | champions-league | 1 | Club Brugge | 2–3 | Aston Villa | 2026-09-08 18:45 |
| CL-04 | champions-league | 1 | Lille | 2–3 | Betis | 2026-09-08 21:00 |
| CL-05 | champions-league | 1 | FC Porto | 0–2 | Manchester City | 2026-09-08 21:00 |
| CL-06 | champions-league | 1 | Real Madrid | 2–1 | Inter | 2026-09-08 21:00 |
| CL-09 | champions-league | 1 | Dortmund | 3–2 | Villarreal | 2026-09-08 21:00 |
| CL-07 | champions-league | 1 | Stuttgart | 3–1 | Viking | 2026-09-09 18:45 |
| CL-08 | champions-league | 1 | Barcelone | 5–1 | Feyenoord | 2026-09-09 18:45 |
| CL-10 | champions-league | 1 | Naples | 0–1 | Arsenal | 2026-09-09 21:00 |
| CL-11 | champions-league | 1 | PSG | 6–1 | Slovan Bratislava | 2026-09-09 21:00 |
| CL-12 | champions-league | 1 | Liverpool | 2–1 | Atl. Madrid | 2026-09-09 21:00 |
| CL-15 | champions-league | 1 | Sporting | 3–1 | Galatasaray | 2026-09-09 21:00 |
| CL-13 | champions-league | 1 | PSV | 1–1 | Shakhtar | 2026-09-10 18:45 |
| CL-14 | champions-league | 1 | Fenerbahce | 1–1 | AS Rome | 2026-09-10 18:45 |
| CL-16 | champions-league | 1 | Côme | 4–1 | RB Leipzig | 2026-09-10 21:00 |
| CL-17 | champions-league | 1 | Manchester Utd | 4–0 | Sabah FC | 2026-09-10 21:00 |
| CL-18 | champions-league | 1 | Bayern Munich | 5–0 | Bodo/Glimt | 2026-09-10 21:00 |
| CL-21 | champions-league | 1 | Slavia Prague | 2–3 | Lens | 2026-09-10 21:00 |
| CL-19 | champions-league | 2 | Sabah FC | 2–0 | Slavia Prague | 2026-10-13 18:45 |
| CL-20 | champions-league | 2 | Lens | 0–2 | Sporting | 2026-10-13 18:45 |
| CL-22 | champions-league | 2 | RB Leipzig | 1–0 | PSV | 2026-10-13 21:00 |
| CL-23 | champions-league | 2 | Viking | 3–3 | Bayern Munich | 2026-10-13 21:00 |
| CL-24 | champions-league | 2 | Arsenal | 3–0 | Lille | 2026-10-13 21:00 |
| CL-25 | champions-league | 2 | Atl. Madrid | 2–0 | Manchester Utd | 2026-10-13 21:00 |
| CL-26 | champions-league | 2 | Galatasaray | 1–4 | Barcelone | 2026-10-13 21:00 |
| CL-27 | champions-league | 2 | Inter | 3–4 | Club Brugge | 2026-10-13 21:00 |
| CL-29 | champions-league | 2 | Villarreal | 3–1 | Naples | 2026-10-13 21:00 |
| CL-28 | champions-league | 2 | Feyenoord | 3–2 | Côme | 2026-10-14 18:45 |
| CL-35 | champions-league | 2 | LASK | 3–6 | Liverpool | 2026-10-14 18:45 |
| CL-03 | champions-league | 2 | Manchester City | 2–4 | PSG | 2026-10-14 21:00 |
| CL-30 | champions-league | 2 | Slovan Bratislava | 0–3 | Stuttgart | 2026-10-14 21:00 |
| CL-31 | champions-league | 2 | Shakhtar | 3–1 | AEK | 2026-10-14 21:00 |
| CL-32 | champions-league | 2 | Aston Villa | 6–0 | Fenerbahce | 2026-10-14 21:00 |
| CL-33 | champions-league | 2 | Bodo/Glimt | 1–0 | Dortmund | 2026-10-14 21:00 |
| CL-34 | champions-league | 2 | Betis | 3–2 | FC Porto | 2026-10-14 21:00 |
| CL-36 | champions-league | 2 | AS Rome | 3–4 | Real Madrid | 2026-10-14 21:00 |
| EL-01 | europa-league | 1 | Ararat-Armenia | 1–4 | Sparta Prague | 2026-09-16 18:45 |
| EL-02 | europa-league | 1 | Omonia | 1–0 | Celta Vigo | 2026-09-16 18:45 |
| EL-03 | europa-league | 1 | Sturm Graz | 0–0 | Rennes | 2026-09-16 21:00 |
| EL-05 | europa-league | 1 | Olympiakos | 2–1 | Jagiellonia | 2026-09-16 21:00 |
| EL-06 | europa-league | 1 | Sunderland | 1–0 | Alkmaar | 2026-09-16 21:00 |
| EL-07 | europa-league | 1 | Anderlecht | 1–2 | Lyon | 2026-09-16 21:00 |
| EL-08 | europa-league | 1 | Bayer Leverkusen | 2–0 | Celje | 2026-09-16 21:00 |
| EL-09 | europa-league | 1 | AC Milan | 0–2 | Benfica | 2026-09-16 21:00 |
| EL-14 | europa-league | 1 | H. Beer Sheva | 0–0 | Din. Zagreb | 2026-09-16 21:00 |
| EL-10 | europa-league | 1 | Levski | 0–1 | Red Bull Salzbourg | 2026-09-17 18:45 |
| EL-11 | europa-league | 1 | OFI Crète | 2–0 | Hoffenheim | 2026-09-17 18:45 |
| EL-12 | europa-league | 1 | Besiktas | 4–1 | Marseille | 2026-09-17 21:00 |
| EL-13 | europa-league | 1 | Real Sociedad | 1–2 | Bournemouth | 2026-09-17 21:00 |
| EL-15 | europa-league | 1 | Crystal Palace | 4–0 | Lech | 2026-09-17 21:00 |
| EL-16 | europa-league | 1 | Plzen | 0–3 | Royale Union SG | 2026-09-17 21:00 |
| EL-17 | europa-league | 1 | Celtic | 1–3 | Ferencvaros | 2026-09-17 21:00 |
| EL-18 | europa-league | 1 | Juventus | 5–0 | Nijmegen | 2026-09-17 21:00 |
| EL-24 | europa-league | 1 | Lillestrom | 1–2 | Torreense | 2026-09-17 21:00 |
| EL-04 | europa-league | 2 | Lyon | 3–2 | Crystal Palace | 2026-10-15 18:45 |
| EL-19 | europa-league | 2 | Torreense | 1–2 | Sunderland | 2026-10-15 18:45 |
| EL-20 | europa-league | 2 | Sparta Prague | 1–1 | Lillestrom | 2026-10-15 18:45 |
| EL-21 | europa-league | 2 | Royale Union SG | 1–1 | Real Sociedad | 2026-10-15 18:45 |
| EL-22 | europa-league | 2 | Alkmaar | 2–1 | H. Beer Sheva | 2026-10-15 18:45 |
| EL-23 | europa-league | 2 | Celje | 0–3 | Omonia | 2026-10-15 18:45 |
| EL-25 | europa-league | 2 | Lech | 0–4 | Bayer Leverkusen | 2026-10-15 18:45 |
| EL-36 | europa-league | 2 | Red Bull Salzbourg | 0–4 | AC Milan | 2026-10-15 18:45 |
| EL-26 | europa-league | 2 | Marseille | 0–1 | Olympiakos | 2026-10-15 21:00 |
| EL-27 | europa-league | 2 | Benfica | 4–1 | Celtic | 2026-10-15 21:00 |
| EL-28 | europa-league | 2 | Jagiellonia | 3–1 | Ararat-Armenia | 2026-10-15 21:00 |
| EL-29 | europa-league | 2 | Rennes | 2–1 | OFI Crète | 2026-10-15 21:00 |
| EL-30 | europa-league | 2 | Nijmegen | 1–1 | Levski | 2026-10-15 21:00 |
| EL-31 | europa-league | 2 | Hoffenheim | 2–3 | Besiktas | 2026-10-15 21:00 |
| EL-32 | europa-league | 2 | Bournemouth | 3–0 | Sturm Graz | 2026-10-15 21:00 |
| EL-33 | europa-league | 2 | Din. Zagreb | 1–0 | Anderlecht | 2026-10-15 21:00 |
| EL-34 | europa-league | 2 | Ferencvaros | 2–1 | Plzen | 2026-10-15 21:00 |
| EL-35 | europa-league | 2 | Celta Vigo | 1–2 | Juventus | 2026-10-15 21:00 |
