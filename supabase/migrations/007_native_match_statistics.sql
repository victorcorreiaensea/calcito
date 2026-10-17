-- Structured match statistics. No images, no automatic publication. Apply after 005.
BEGIN;
DO $$
BEGIN
    IF to_regclass('public.europe_preparation_runs') IS NULL THEN
        RAISE EXCEPTION 'Installez d’abord la migration 005 Préparation européenne.';
    END IF;
END
$$;
ALTER TABLE public.match_team_stats
    ADD COLUMN IF NOT EXISTS corners smallint CHECK (corners >= 0),
    ADD COLUMN IF NOT EXISTS passes_completed integer CHECK (passes_completed >= 0),
    ADD COLUMN IF NOT EXISTS passes_attempted integer CHECK (passes_attempted >= 0),
    ADD COLUMN IF NOT EXISTS pass_accuracy numeric CHECK (pass_accuracy BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS yellow_cards smallint CHECK (yellow_cards >= 0),
    ADD COLUMN IF NOT EXISTS red_cards smallint CHECK (red_cards >= 0);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT
            1
        FROM
            pg_constraint
        WHERE
            conname = 'stats_passes_order') THEN
        ALTER TABLE public.match_team_stats
            ADD CONSTRAINT stats_passes_order CHECK (passes_completed IS NULL OR passes_attempted IS NULL OR passes_completed <= passes_attempted);
    END IF;
END
$$;
CREATE OR REPLACE FUNCTION public.save_match (payload jsonb)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $$
DECLARE
    mid uuid;
    sid uuid;
    homeid uuid;
    awayid uuid;
    existing public.matches;
    stats jsonb;
    teamid uuid;
    side text;
    previous_stats jsonb;
    saved_stats jsonb;
BEGIN
    IF NOT public.is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration non autorisée.'
            USING errcode = '42501';
    END IF;
    PERFORM
        public.arena_match_guard ();
    mid = coalesce(nullif (payload ->> 'id', '')::uuid, gen_random_uuid ());
    SELECT
        *
    INTO
        existing
    FROM
        public.matches
    WHERE
        id = mid
    FOR UPDATE;
    IF found AND (payload ->> 'expected_updated_at' IS NULL OR existing.updated_at <> (payload ->> 'expected_updated_at')::timestamptz) THEN
        RAISE EXCEPTION 'Ce match a changé. Rechargez-le avant de modifier.'
            USING errcode = '40001';
    END IF;
    sid = (payload ->> 'season_id')::uuid;
    homeid = (payload ->> 'home_team_id')::uuid;
    awayid = (payload ->> 'away_team_id')::uuid;
    SELECT
        coalesce(jsonb_object_agg(team_id::text, to_jsonb (s)), '{}')
    INTO
        previous_stats
    FROM
        public.match_team_stats s
    WHERE
        match_id = mid;
    IF existing.id IS NOT NULL THEN
        DELETE FROM public.match_team_stats
        WHERE match_id = mid;
    END IF;
    INSERT INTO public.matches (id, season_id, round, kickoff, home_team_id, away_team_id, status, goals_home, goals_away, halftime_home, halftime_away, extra_home, extra_away, penalties_home, penalties_away, source, verified_at, comment, is_published)
        VALUES (mid, sid, payload ->> 'round', (payload ->> 'kickoff')::timestamptz, homeid, awayid, payload ->> 'status', nullif (payload ->> 'goals_home', '')::smallint,nullif(payload->>'goals_away','')::smallint, nullif (payload ->> 'halftime_home', '')::smallint,nullif(payload->>'halftime_away','')::smallint, nullif (payload ->> 'extra_home', '')::smallint,nullif(payload->>'extra_away','')::smallint, nullif (payload ->> 'penalties_home', '')::smallint,nullif(payload->>'penalties_away','')::smallint, nullif (trim(payload ->> 'source'), ''),nullif(payload->>'verified_at','')::timestamptz, nullif (payload ->> 'comment', ''), coalesce((payload ->> 'is_published')::boolean, FALSE))
    ON CONFLICT (id)
        DO UPDATE SET
            season_id = excluded.season_id,
            round = excluded.round,
            kickoff = excluded.kickoff,
            home_team_id = excluded.home_team_id,
            away_team_id = excluded.away_team_id,
            status = excluded.status,
            goals_home = excluded.goals_home,
            goals_away = excluded.goals_away,
            halftime_home = excluded.halftime_home,
            halftime_away = excluded.halftime_away,
            extra_home = excluded.extra_home,
            extra_away = excluded.extra_away,
            penalties_home = excluded.penalties_home,
            penalties_away = excluded.penalties_away,
            source = excluded.source,
            verified_at = excluded.verified_at,
            comment = excluded.comment,
            is_published = excluded.is_published;
    foreach side IN ARRAY ARRAY['home', 'away'] LOOP
        teamid = CASE WHEN side = 'home' THEN
            homeid
        ELSE
            awayid
        END;
        stats = payload -> (side || '_stats');
        saved_stats = previous_stats -> teamid::text;
        INSERT INTO public.match_team_stats (match_id, team_id, shots, shots_on_target, woodwork, big_chances, team_rating, possession, xg, bonuses, corners, passes_completed, passes_attempted, pass_accuracy, yellow_cards, red_cards)
            VALUES (mid, teamid, nullif (stats ->> 'shots', '')::smallint,nullif(stats->>'shots_on_target','')::smallint, nullif (stats ->> 'woodwork', '')::smallint,nullif(stats->>'big_chances','')::smallint, nullif (stats ->> 'team_rating', '')::numeric,nullif(stats->>'possession','')::numeric, nullif (stats ->> 'xg', '')::numeric, nullif(stats -> 'bonuses','null'::jsonb), CASE WHEN stats ? 'corners' THEN nullif(stats->>'corners','')::smallint
            ELSE
                (saved_stats ->> 'corners')::smallint
            END, CASE WHEN stats ? 'passes_completed' THEN
                nullif (stats ->> 'passes_completed', '')::integer ELSE (saved_stats->>'passes_completed')::integer END, CASE WHEN stats ? 'passes_attempted' THEN nullif(stats->>'passes_attempted','')::integer
            ELSE
                (saved_stats ->> 'passes_attempted')::integer
            END, CASE WHEN stats ? 'pass_accuracy' THEN
                nullif (stats ->> 'pass_accuracy', '')::numeric ELSE (saved_stats->>'pass_accuracy')::numeric END, CASE WHEN stats ? 'yellow_cards' THEN nullif(stats->>'yellow_cards','')::smallint
            ELSE
                (saved_stats ->> 'yellow_cards')::smallint
            END, CASE WHEN stats ? 'red_cards' THEN
                nullif (stats ->> 'red_cards', '')::smallint
            ELSE
                (saved_stats ->> 'red_cards')::smallint
            END);
END LOOP;
    RETURN mid;
END
$$;
CREATE OR REPLACE FUNCTION public.statistics_storage_status ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF NOT public.is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    RETURN '{"ready":true,"version":2}'::jsonb;
END
$$;
REVOKE ALL ON FUNCTION public.statistics_storage_status () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.statistics_storage_status () TO authenticated;
-- Retire image endpoints if migration 006 was installed. Preserve private historical
-- audit records; no image or image-import endpoint is used by the application.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
    SELECT
        oid::regprocedure AS signature
    FROM
        pg_proc
    WHERE
        pronamespace = 'public'::regnamespace
        AND proname IN ('photo_import_status', 'photo_import_stage', 'photo_import_review', 'photo_import_publish')
        LOOP
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated', p.signature);
        END LOOP;
END
$$;
CREATE TABLE IF NOT EXISTS public.match_statistics_imports (
    source_key text PRIMARY KEY,
    payload jsonb NOT NULL,
    match_id uuid NOT NULL REFERENCES public.matches (id),
    actor_id uuid NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.match_statistics_batches (
    batch_key text PRIMARY KEY,
    actor_id uuid NOT NULL,
    report jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.match_statistics_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_statistics_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_statistics_imports, public.match_statistics_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.match_statistics_imports, public.match_statistics_batches TO authenticated;
DROP POLICY IF EXISTS owner_statistics_imports ON public.match_statistics_imports;
CREATE POLICY owner_statistics_imports ON public.match_statistics_imports TO authenticated
    USING (public.is_calcito_admin ())
    WITH CHECK (public.is_calcito_admin ());
DROP POLICY IF EXISTS owner_statistics_batches ON public.match_statistics_batches;
CREATE POLICY owner_statistics_batches ON public.match_statistics_batches TO authenticated
    USING (public.is_calcito_admin ())
    WITH CHECK (public.is_calcito_admin ());
CREATE OR REPLACE FUNCTION public._club_identity_key (value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog
    AS $$
    SELECT
        regexp_replace(lower(translate(value, 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝŸýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYYyy')), '[^a-z0-9]', '', 'g')
$$;
CREATE OR REPLACE FUNCTION public._club_country_key (value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog
    AS $$
    SELECT
        CASE public._club_identity_key (value)
        WHEN 'england' THEN
            'angleterre'
        WHEN 'germany' THEN
            'allemagne'
        WHEN 'italy' THEN
            'italie'
        WHEN 'spain' THEN
            'espagne'
        WHEN 'greece' THEN
            'grece'
        WHEN 'austria' THEN
            'autriche'
        WHEN 'belgium' THEN
            'belgique'
        WHEN 'norway' THEN
            'norvege'
        WHEN 'netherlands' THEN
            'paysbas'
        WHEN 'turkey' THEN
            'turquie'
        WHEN 'turkiye' THEN
            'turquie'
        WHEN 'slovakia' THEN
            'slovaquie'
        WHEN 'azerbaijan' THEN
            'azerbaidjan'
        WHEN 'czechrepublic' THEN
            'tchequie'
        WHEN 'czechia' THEN
            'tchequie'
        WHEN 'armenia' THEN
            'armenie'
        WHEN 'cyprus' THEN
            'chypre'
        WHEN 'poland' THEN
            'pologne'
        WHEN 'slovenia' THEN
            'slovenie'
        WHEN 'bulgaria' THEN
            'bulgarie'
        WHEN 'croatia' THEN
            'croatie'
        WHEN 'scotland' THEN
            'ecosse'
        WHEN 'hungary' THEN
            'hongrie'
        ELSE
            public._club_identity_key (value)
        END
$$;
REVOKE ALL ON FUNCTION public._club_country_key (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._club_country_key (text) TO authenticated;
CREATE OR REPLACE FUNCTION public.import_match_statistics (payload jsonb, batch_key text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $$
DECLARE
    ROW jsonb;
    club jsonb;
    oldref public.match_statistics_imports;
    m public.matches;
    st jsonb;
    oldst jsonb;
    merged jsonb;
    proposed jsonb;
    side text;
    key text;
    value numeric;
    cid uuid;
    sid uuid;
    tid uuid;
    hid uuid;
    aid uuid;
    mid uuid;
    n integer;
    row_created integer;
    row_existing integer;
    clubs_created integer = 0;
    created integer = 0;
    completed integer = 0;
    unchanged integer = 0;
    published_skipped integer = 0;
    issues jsonb = '[]';
    details jsonb = '[]';
    report jsonb;
    error_message text;
    fixture_total integer;
BEGIN
    IF NOT public.is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    IF payload ->> 'format' IS DISTINCT FROM 'calcito-match-statistics-v1' OR jsonb_typeof(payload -> 'matches') IS DISTINCT FROM 'array' OR jsonb_array_length(payload -> 'matches')
        NOT BETWEEN 1 AND 72 OR coalesce(length(batch_key), 0)
        NOT BETWEEN 1 AND 150 THEN
        RAISE EXCEPTION 'Lot structuré de 1 à 72 matchs requis.';
    END IF;
    PERFORM
        public.arena_match_guard ();
    PERFORM
        pg_advisory_xact_lock(593817452);
    fixture_total = jsonb_array_length(payload -> 'matches');
    FOR ROW IN
    SELECT
        e.value
    FROM
        jsonb_array_elements(payload -> 'matches') e
ORDER BY
    (e.value ->> 'kickoff')::timestamptz,
    e.value ->> 'source_key' LOOP
        BEGIN
            row_created = 0;
            row_existing = 0;
            IF coalesce(ROW ->> 'source_key', '') !~ '^[a-f0-9]{64}$' THEN
                RAISE EXCEPTION 'Référence de source invalide.';
            END IF;
            SELECT
                *
            INTO
                oldref
            FROM
                public.match_statistics_imports i
            WHERE
                i.source_key = ROW ->> 'source_key';
            IF FOUND THEN
                IF oldref.payload IS DISTINCT FROM ROW THEN
                    RAISE EXCEPTION 'Cette source a déjà été enregistrée avec d’autres valeurs. Correction explicite requise.';
                END IF;
                unchanged = unchanged + 1;
                details = details || jsonb_build_array(jsonb_build_object('source_key', ROW ->> 'source_key', 'id', ROW ->> 'id', 'match_id', oldref.match_id, 'status', 'already_imported'));
                CONTINUE;
            END IF;
            IF ROW ->> 'competition' NOT IN ('champions-league', 'europa-league') OR ROW ->> 'competition' IS NULL OR ROW ->> 'round' NOT IN ('1', '2') OR ROW ->> 'round' IS NULL OR (ROW ->> 'kickoff')::timestamptz NOT BETWEEN '2026-07-01' AND '2027-06-30 23:59:59+00' OR (ROW ->> 'kickoff')::timestamptz > now() THEN
                RAISE EXCEPTION 'Compétition, journée ou date de la saison invalide.';
            END IF;
            IF ROW ->> 'goals_home' IS NULL OR ROW ->> 'goals_away' IS NULL OR (ROW ->> 'goals_home')::integer NOT BETWEEN 0 AND 100 OR (ROW ->> 'goals_away')::integer NOT BETWEEN 0 AND 100 THEN
                RAISE EXCEPTION 'Score final invalide.';
            END IF;
            SELECT
                id
            INTO
                cid
            FROM
                public.competitions
            WHERE
                slug = ROW ->> 'competition'
                AND is_published;
            IF cid IS NULL THEN
                RAISE EXCEPTION 'Compétition européenne absente ou privée.';
            END IF;
            SELECT
                count(*),
                min(id::text)::uuid
            INTO
                n,
                sid
            FROM
                public.seasons
            WHERE
                competition_id = cid
                AND start_year = 2026
                AND end_year = 2027;
            IF n > 1 THEN
                RAISE EXCEPTION 'Plusieurs saisons européennes possibles.';
            END IF;
            IF n = 0 THEN
                INSERT INTO public.seasons (competition_id, label, start_year, end_year, is_published)
                    VALUES (cid, '2026–2027', 2026, 2027, TRUE)
                RETURNING
                    id
                INTO
                    sid;
            ELSIF NOT (
                    SELECT
                        is_published
                    FROM
                        public.seasons
                    WHERE
                        id = sid) THEN
                RAISE EXCEPTION 'Saison européenne privée : ne pas modifier sa visibilité automatiquement.';
            END IF;
            FOREACH side IN ARRAY ARRAY['home', 'away'] LOOP
                club = ROW -> (side || '_club');
                IF jsonb_typeof(club -> 'identity_keys') IS DISTINCT FROM 'array' OR coalesce(length(trim(club ->> 'name')), 0) < 2 THEN
                    RAISE EXCEPTION 'Identité du club manquante.';
                END IF;
                SELECT
                    count(*),
                    min(t.id::text)::uuid
                INTO
                    n,
                    tid
                FROM
                    public.teams t
                WHERE
                    public._club_country_key (t.country) = public._club_country_key (club ->> 'country')
                    AND ((nullif (club ->> 'existing_id', '') IS NOT NULL
                            AND t.id = (club ->> 'existing_id')::uuid)
                        OR (nullif (club ->> 'existing_id', '') IS NULL
                            AND (public._club_identity_key (t.name) IN (
                                    SELECT
                                        jsonb_array_elements_text(club -> 'identity_keys'))
                                    OR public._club_identity_key (t.slug) IN (
                                        SELECT
                                            jsonb_array_elements_text(club -> 'identity_keys')))));
                IF n > 1 THEN
                    RAISE EXCEPTION 'Plusieurs clubs correspondent à %. Associez explicitement son UUID.', club ->> 'name';
                END IF;
                IF n = 0 THEN
                    IF nullif (club ->> 'existing_id', '') IS NOT NULL THEN
                        RAISE EXCEPTION 'Identifiant interne du club introuvable.';
                    END IF;
                    IF coalesce(club ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR coalesce(length(trim(club ->> 'country')), 0) < 2 THEN
                        RAISE EXCEPTION 'Nouveau club : pays et identifiant lisible requis.';
                    END IF;
                    IF EXISTS (
                        SELECT
                            1
                        FROM
                            public.teams
                        WHERE
                            slug = club ->> 'slug') THEN
                        RAISE EXCEPTION 'Identifiant de club déjà utilisé.';
                    END IF;
                    IF coalesce(club ->> 'logo_url', '') !~ '^https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/[a-z0-9-]+[.](png|svg)$' OR coalesce(club->>'logo_source_url','') !~ '^https://github.com/[^/]+/[^/]+/blob/[a-f0-9]{40}/' OR coalesce(club ->> 'logo_blob_sha', '') !~ '^[a-f0-9]{40}$' THEN
                        RAISE EXCEPTION 'Écusson vérifié et empreinte du fichier requis.';
                    END IF;
                    INSERT INTO public.teams (name, short, slug, country, domestic_league, logo_url, logo_source_url, identity_source_url, external_references, is_published)
                        VALUES (trim(club ->> 'name'),
                            LEFT (trim(club ->> 'name'), 3), club ->> 'slug', trim(club ->> 'country'), nullif (trim(club ->> 'domestic_league'), ''), club ->> 'logo_url', club ->> 'logo_source_url', club ->> 'logo_source_url', jsonb_build_object('github_crest_blob_sha', club ->> 'logo_blob_sha', 'github_crest_repository', club ->> 'logo_repository', 'github_crest_path', club ->> 'logo_path'), TRUE)
                    RETURNING
                        id
                    INTO
                        tid;
                    row_created = row_created + 1;
                ELSIF NOT (
                        SELECT
                            is_published
                        FROM
                            public.teams
                        WHERE
                            id = tid) THEN
                    RAISE EXCEPTION 'Fiche club privée : validation de visibilité requise.';
                END IF;
                IF (
                    SELECT
                        logo_url IS NULL
                    FROM
                        public.teams
                    WHERE
                        id = tid) AND club ->> 'logo_url' ~ '^https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/[a-z0-9-]+[.](png|svg)$' AND club ->> 'logo_blob_sha' ~ '^[a-f0-9]{40}$' THEN
                    UPDATE
                        public.teams
                    SET
                        logo_url = club ->> 'logo_url',
                        logo_source_url = club ->> 'logo_source_url',
                        external_references = external_references || jsonb_build_object('github_crest_blob_sha', club ->> 'logo_blob_sha')
                    WHERE
                        id = tid;
                END IF;
                IF club ->> 'domestic_competition' IN ('ligue-1', 'premier-league', 'laliga', 'serie-a', 'bundesliga', 'liga-portugal') THEN
                    INSERT INTO public.season_teams (season_id, team_id)
                    SELECT
                        s.id,
                        tid
                    FROM
                        public.seasons s
                        JOIN public.competitions c ON c.id = s.competition_id
                    WHERE
                        c.slug = club ->> 'domestic_competition'
                        AND c.type = 'league'
                        AND c.is_published
                        AND s.is_published
                        AND s.start_year = 2026
                        AND s.end_year = 2027
                    ON CONFLICT
                        DO NOTHING;
                END IF;
                IF side = 'home' THEN
                    hid = tid;
                ELSE
                    aid = tid;
                END IF;
            END LOOP;
            IF hid = aid THEN
                RAISE EXCEPTION 'Deux clubs distincts requis.';
            END IF;
            SELECT
                count(*)
            INTO
                n
            FROM
                public.matches
            WHERE
                season_id = sid
                AND home_team_id = hid
                AND away_team_id = aid;
            IF n > 1 THEN
                RAISE EXCEPTION 'Plusieurs rencontres possibles : aucun doublon ne sera créé.';
            END IF;
            SELECT
                *
            INTO
                m
            FROM
                public.matches
            WHERE
                season_id = sid
                AND home_team_id = hid
                AND away_team_id = aid
            FOR UPDATE;
            IF m.id IS NOT NULL THEN
                row_existing = 1;
                IF m.kickoff IS DISTINCT FROM (ROW ->> 'kickoff')::timestamptz OR regexp_replace(lower(m.round), '[^0-9]', '', 'g') IS DISTINCT FROM ROW ->> 'round' OR m.status NOT IN ('scheduled', 'finished') OR (m.goals_home IS NOT NULL AND m.goals_home <> (ROW ->> 'goals_home')::integer) OR (m.goals_away IS NOT NULL AND m.goals_away <> (ROW ->> 'goals_away')::integer) THEN
                    RAISE EXCEPTION 'Conflit avec la date, la journée, le statut ou le score existant.';
                END IF;
                IF m.is_published THEN
                    RAISE EXCEPTION 'Déjà publié : accord préalable requis avant tout enrichissement public.';
                END IF;
            END IF;
            proposed = coalesce(to_jsonb (m), '{}') || jsonb_build_object('season_id', sid, 'home_team_id', hid, 'away_team_id', aid, 'round', coalesce(m.round, 'Phase de ligue · Journée ' || (ROW ->> 'round')), 'kickoff', ROW ->> 'kickoff', 'status', 'finished', 'goals_home', (ROW ->> 'goals_home')::integer, 'goals_away', (ROW ->> 'goals_away')::integer, 'source', coalesce(nullif (m.source, ''), 'Relevé fourni par le propriétaire · SHA-256 ' || (ROW ->> 'source_key')), 'verified_at', NULL, 'is_published', FALSE, 'expected_updated_at', m.updated_at, 'comment', concat_ws(E'\n', nullif (m.comment, ''), 'Relevé numérique : ' || (ROW ->> 'source_key'), ROW ->> 'review_note'));
            FOREACH side IN ARRAY ARRAY['home', 'away'] LOOP
                tid = CASE WHEN side = 'home' THEN
                    hid
                ELSE
                    aid
                END;
                SELECT
                    to_jsonb (t)
                INTO
                    oldst
                FROM
                    public.match_team_stats t
                WHERE
                    match_id = m.id
                    AND team_id = tid;
                merged = coalesce(oldst, '{}');
                st = coalesce(ROW -> (side || '_stats'), '{}');
                FOREACH key IN ARRAY ARRAY['shots', 'shots_on_target', 'woodwork', 'big_chances', 'team_rating', 'possession', 'xg', 'corners', 'passes_completed', 'passes_attempted', 'pass_accuracy', 'yellow_cards', 'red_cards'] LOOP
                    IF st ->> key IS NOT NULL AND st ->> key <> '' THEN
                        value = (st ->> key)::numeric;
                        IF value < 0 OR value > 32767 OR (key IN ('possession', 'pass_accuracy') AND value > 100) OR (key = 'team_rating' AND value > 10) OR (key NOT IN ('possession', 'pass_accuracy', 'xg', 'team_rating') AND value <> trunc(value)) THEN
                            RAISE EXCEPTION 'Statistique invalide : % %', side, key;
                        END IF;
                        IF oldst ->> key IS NOT NULL AND (oldst ->> key)::numeric <> value THEN
                            RAISE EXCEPTION 'Conflit statistique % / % : base %, relevé %.', side, key, oldst ->> key, value;
                        END IF;
                        merged = jsonb_set(merged, ARRAY[key], to_jsonb (value));
                    END IF;
                END LOOP;
                IF (merged ->> 'shots_on_target')::numeric > (merged ->> 'shots')::numeric OR (merged ->> 'passes_completed')::numeric > (merged ->> 'passes_attempted')::numeric THEN
                    RAISE EXCEPTION 'Tirs cadrés ou passes incohérents.';
                END IF;
                proposed = jsonb_set(proposed, ARRAY[side || '_stats'], merged);
            END LOOP;
            INSERT INTO public.season_teams (season_id, team_id)
            VALUES
                (sid, hid),
                (sid, aid)
            ON CONFLICT
                DO NOTHING;
            mid = public.save_match (proposed);
            INSERT INTO public.match_statistics_imports (source_key, payload, match_id, actor_id)
                VALUES (ROW ->> 'source_key', row, mid, auth.uid ());
            clubs_created = clubs_created + row_created;
            created = created + CASE WHEN row_existing = 0 THEN
                1
            ELSE
                0
            END;
            completed = completed + 1;
            details = details || jsonb_build_array(jsonb_build_object('id', ROW ->> 'id', 'match_id', mid, 'status', 'saved_draft', 'created', row_existing = 0, 'review_note', ROW ->> 'review_note'));
        EXCEPTION
            WHEN OTHERS THEN
                GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
                IF error_message LIKE 'Déjà publié%' THEN
                    published_skipped = published_skipped + 1;
                    END IF;
                    issues = issues || jsonb_build_array(jsonb_build_object('id', ROW ->> 'id', 'home', ROW -> 'home_club' ->> 'name', 'away', ROW -> 'away_club' ->> 'name', 'reason', error_message));
        END;
    END LOOP;
    report = jsonb_build_object('prepared', fixture_total, 'completed', completed, 'created', created, 'new_clubs', clubs_created, 'already_imported', unchanged, 'published', 0, 'public_matches_awaiting_approval', published_skipped, 'errors', issues, 'details', details);
    INSERT INTO public.match_statistics_batches (batch_key, actor_id, report)
        VALUES (batch_key, auth.uid (), report)
    ON CONFLICT ON CONSTRAINT match_statistics_batches_pkey
        DO UPDATE SET
            report = excluded.report,
            updated_at = clock_timestamp();
        RETURN report;
END
$$;
REVOKE ALL ON FUNCTION public.import_match_statistics (jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_match_statistics (jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public._club_identity_key (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._club_identity_key (text) TO authenticated;
NOTIFY pgrst,
'reload schema';
COMMIT;
