-- CALCITO : relevés numériques, brouillons uniquement. Aucune image stockée.
-- À exécuter depuis le SQL Editor du projet propriétaire.
DO $bootstrap$ BEGIN IF to_regclass('public.europe_preparation_runs') IS NULL THEN EXECUTE $previous$-- European preparation: owner-only imports, NEVER publishes a match.

ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS domestic_league text;
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS identity_source_url text;
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS logo_source_url text;
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS external_references jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.europe_preparation_runs (
    nonce uuid PRIMARY KEY,
    actor_id uuid NOT NULL,
    request jsonb NOT NULL,
    report jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.europe_preparation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.europe_preparation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.europe_preparation_runs TO authenticated;
CREATE POLICY owner_europe_runs ON public.europe_preparation_runs
    FOR SELECT TO authenticated
    USING (public.is_calcito_admin ());
-- A private draft or its private statistics cannot invalidate any public snapshot.
CREATE OR REPLACE FUNCTION public.invalidate_derived ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    item public.matches;
BEGIN
    IF tg_table_name = 'matches' THEN
        IF tg_op = 'DELETE' THEN
            item = old;
        ELSE
            item = new;
        END IF;
        IF NOT item.is_published AND (tg_op <> 'UPDATE' OR NOT OLD.is_published) THEN
            RETURN coalesce(new, old);
        END IF;
    ELSE
        SELECT
            *
        INTO
            item
        FROM
            public.matches
        WHERE
            id = coalesce(NEW.match_id, OLD.match_id);
        IF NOT coalesce(item.is_published, FALSE) THEN
            RETURN coalesce(new, old);
        END IF;
    END IF;
    UPDATE
        public.form_snapshots
    SET
        is_valid = FALSE
    WHERE
        team_id IN (item.home_team_id, item.away_team_id);
    UPDATE
        public.seasons
    SET
        verified_complete = FALSE
    WHERE
        id = item.season_id
        AND verified_complete;
    IF tg_table_name = 'matches' AND tg_op = 'UPDATE' THEN
        UPDATE
            public.form_snapshots
        SET
            is_valid = FALSE
        WHERE
            team_id IN (OLD.home_team_id, OLD.away_team_id);
        UPDATE
            public.seasons
        SET
            verified_complete = FALSE
        WHERE
            id = OLD.season_id
            AND verified_complete;
    END IF;
    RETURN coalesce(new, old);
END
$$;
CREATE OR REPLACE FUNCTION public.invalidate_catalogue_forms ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    cid uuid;
    sid uuid;
    tid uuid;
BEGIN
    IF tg_table_name = 'competitions' THEN
        cid = coalesce(NEW.id, OLD.id);
        UPDATE
            public.form_snapshots f
        SET
            is_valid = FALSE
        WHERE
            f.team_id IN (
                SELECT
                    st.team_id
                FROM
                    public.season_teams st
                    JOIN public.seasons s ON s.id = st.season_id
                WHERE
                    s.competition_id = cid);
    ELSIF tg_table_name = 'seasons' THEN
        sid = coalesce(NEW.id, OLD.id);
        -- Draft insertion must not reset a season's coverage and invalidate its teams.
        IF new IS NOT DISTINCT FROM old THEN
            RETURN new;
        END IF;
        UPDATE
            public.form_snapshots f
        SET
            is_valid = FALSE
        WHERE
            f.team_id IN (
                SELECT
                    team_id
                FROM
                    public.season_teams
                WHERE
                    season_id = sid);
    ELSE
        tid = coalesce(NEW.team_id, OLD.team_id);
        sid = coalesce(NEW.season_id, OLD.season_id);
        IF tg_op = 'INSERT' AND NOT EXISTS (
            SELECT
                1
            FROM
                public.matches
            WHERE
                season_id = sid
                AND is_published
                AND tid IN (home_team_id, away_team_id)) THEN
            RETURN new;
        END IF;
        UPDATE
            public.form_snapshots
        SET
            is_valid = FALSE
        WHERE
            team_id = tid;
    END IF;
    RETURN coalesce(new, old);
END
$$;
CREATE OR REPLACE FUNCTION public._arena_result_trigger ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    tid uuid;
BEGIN
    IF NOT NEW.is_published AND (tg_op = 'INSERT' OR NOT OLD.is_published) THEN
        RETURN NEW;
    END IF;
    PERFORM
        _arena_lock ();
    IF tg_op = 'UPDATE' AND ((NEW.home_team_id,
        NEW.away_team_id,
        NEW.season_id) IS DISTINCT FROM (OLD.home_team_id,
    OLD.away_team_id,
    OLD.season_id) OR (NEW.kickoff IS DISTINCT FROM OLD.kickoff AND NEW.status IN ('scheduled', 'live'))) THEN
        UPDATE
            arena_legs
        SET
            voided = TRUE
        WHERE
            match_id = NEW.id;
    END IF;
    IF (tg_op = 'INSERT' AND NEW.is_published AND NEW.status = 'finished') OR (tg_op = 'UPDATE' AND (NEW.status = 'finished' OR OLD.status = 'finished') AND (NEW.goals_home,
NEW.goals_away,
NEW.status,
NEW.is_published,
NEW.verified_at,
NEW.kickoff,
NEW.home_team_id,
NEW.away_team_id,
NEW.season_id) IS DISTINCT FROM (OLD.goals_home,
OLD.goals_away,
OLD.status,
OLD.is_published,
OLD.verified_at,
OLD.kickoff,
OLD.home_team_id,
OLD.away_team_id,
OLD.season_id)) THEN
        UPDATE
            arena_model
        SET
            enabled = FALSE,
            report = report || jsonb_build_object('enabled', FALSE, 'reason', 'Résultats modifiés : recalibration requise pour les nouvelles cotes.')
        WHERE singleton = TRUE;
    END IF;
    FOR tid IN SELECT DISTINCT
        ticket_id
    FROM
        arena_legs
    WHERE
        match_id = NEW.id LOOP
            PERFORM
                _arena_settle (tid);
        END LOOP;
    RETURN new;
END
$$;
CREATE FUNCTION public.europe_preparation_status ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
BEGIN
    IF NOT public.is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration non autorisée.'
            USING errcode = '42501';
    END IF;
    RETURN jsonb_build_object('installed', TRUE, 'lastImport', (
            SELECT
                report || jsonb_build_object('createdAt', created_at)
            FROM public.europe_preparation_runs ORDER BY created_at DESC LIMIT 1));
END
$$;
REVOKE ALL ON FUNCTION public.europe_preparation_status () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.europe_preparation_status () TO authenticated;
CREATE FUNCTION public.europe_prepare_drafts (payload jsonb, client_nonce uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
DECLARE
    prior public.europe_preparation_runs;
    c jsonb;
    m jsonb;
    existing public.teams;
    clubid uuid;
    compid uuid;
    sid uuid;
    mid uuid;
    h uuid;
    a uuid;
    stamp timestamptz;
    gh integer;
    ga integer;
    MAPPING jsonb = '{}';
    report jsonb;
    clubs_created integer = 0;
    drafts integer = 0;
    reused integer = 0;
    members_added integer = 0;
    seq integer;
    clubids uuid[] = '{}';
    key text;
BEGIN
    IF NOT public.is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration non autorisée.'
            USING errcode = '42501';
    END IF;
    PERFORM
        pg_advisory_xact_lock(593817452);
    SELECT
        *
    INTO
        prior
    FROM
        public.europe_preparation_runs
    WHERE
        nonce = client_nonce;
    IF FOUND THEN
        IF prior.actor_id <> auth.uid () OR prior.request IS DISTINCT FROM payload THEN
            RAISE EXCEPTION 'Identifiant de reprise déjà utilisé pour un autre import.';
        END IF;
        RETURN prior.report;
    END IF;
    IF client_nonce IS NULL OR coalesce(payload ->> 'reviewed', '')<>'true' OR coalesce(jsonb_typeof(payload->'matches'),'') <> 'array' OR coalesce(jsonb_typeof(payload -> 'clubs'), '') <> 'array' OR jsonb_array_length(payload -> 'matches')
        NOT BETWEEN 1 AND 72 OR jsonb_array_length(payload -> 'clubs')
        NOT BETWEEN 2 AND 144 THEN
        RAISE EXCEPTION 'Prévisualisation vérifiée de 1 à 72 rencontres requise.';
    END IF;
    FOR c IN
    SELECT
        value
    FROM
        jsonb_array_elements(payload -> 'clubs')
        LOOP
            key = c ->> 'key';
            IF coalesce(key, '')='' OR MAPPING ? key OR coalesce(trim(c ->> 'name'), '')='' THEN
                RAISE EXCEPTION 'Identité de club absente ou répétée.';
            END IF;
            IF nullif (c ->> 'existing_id', '') IS NOT NULL THEN
                SELECT
                    *
                INTO
                    existing
                FROM
                    public.teams
                WHERE
                    id = (c ->> 'existing_id')::uuid;
                IF NOT FOUND OR (coalesce(c ->> 'country', '')<>'' AND c ->> 'country' <> existing.country) THEN
                    RAISE EXCEPTION 'Fiche existante ou pays incompatible.';
                END IF;
                clubid = existing.id;
            ELSE
                IF coalesce(trim(c ->> 'country'), '')='' OR coalesce(c ->> 'identity_source_url', '') !~ '^https://[^/[:space:]]+/' OR coalesce(c->>'slug','') !~ '^[a-z0-9-]+$' OR coalesce(c ->> 'short', '')='' THEN
                    RAISE EXCEPTION 'Nouvelle fiche : identité, pays, source et identifiant lisible requis.';
                END IF;
                SELECT
                    *
                INTO
                    existing
                FROM
                    public.teams t
                WHERE
                    t.country = c ->> 'country'
                    AND ((t.slug = c ->> 'slug'
                            AND lower(trim(t.name)) = lower(trim(c ->> 'name'))
                            AND t.identity_source_url = c ->> 'identity_source_url')
                        OR (nullif (c ->> 'external_id', '') IS NOT NULL AND nullif(c->>'external_provider','') IS NOT NULL
                            AND t.external_references ->> (c ->> 'external_provider') = c ->> 'external_id'));
                IF FOUND THEN
                    clubid = existing.id;
                ELSE
                    IF EXISTS (
                        SELECT
                            1
                        FROM
                            public.teams t
                        WHERE
                            t.slug = c ->> 'slug'
                            OR lower(trim(t.name)) = lower(trim(c ->> 'name'))
                            OR regexp_replace(lower(t.name), '[^a-z0-9]', '','g')=key OR (nullif(c->>'external_id','') IS NOT NULL
                            AND nullif (c ->> 'external_provider', '') IS NOT NULL
                            AND t.external_references ->> (c ->> 'external_provider') = c ->> 'external_id')) THEN
                        RAISE EXCEPTION 'Une fiche de ce club existe : rechargez et associez son identifiant.'
                            USING errcode = '40001';
                    END IF;
                    IF nullif (c ->> 'logo_url', '') IS NOT NULL AND (c->>'logo_url' !~ '^https://' OR coalesce(c->>'logo_source_url','') !~ '^https://') THEN
                        RAISE EXCEPTION 'Source du logo requise.';
                    END IF;
                    IF c ->> 'logo_url' LIKE '%media.api-sports.io%' AND (coalesce(c ->> 'external_provider', '')<>'api-football' OR nullif(c->>'external_id','') IS NULL OR c ->> 'logo_url' <> ('https://media.api-sports.io/football/teams/' || (c ->> 'external_id') || '.png')) THEN
                        RAISE EXCEPTION 'Identifiant API-Football et écusson incompatibles.';
                    END IF;
                    INSERT INTO public.teams (name, short, slug, country, logo_url, is_published, domestic_league, identity_source_url, logo_source_url, external_references)
                        VALUES (c ->> 'name', c ->> 'short', c ->> 'slug', c ->> 'country', nullif (c ->> 'logo_url', ''),true,nullif(c->>'domestic_league',''), c ->> 'identity_source_url', nullif (c ->> 'logo_source_url', ''),CASE WHEN nullif(c->>'external_provider','') IS NOT NULL
                            AND nullif (c ->> 'external_id', '') IS NOT NULL THEN
                            jsonb_build_object(c ->> 'external_provider', c ->> 'external_id')
                        ELSE
                            '{}'
END)
RETURNING
    id
INTO
    clubid;
clubs_created = clubs_created + 1;
END IF;
END IF;
IF clubid = ANY (clubids) THEN
    RAISE EXCEPTION 'Une fiche est associée à plusieurs identités du fichier.';
END IF;
clubids = array_append(clubids, clubid);
MAPPING = MAPPING || jsonb_build_object(key, clubid);
END LOOP;
FOR m IN
SELECT
    value
FROM
    jsonb_array_elements(payload -> 'matches')
    LOOP
        IF coalesce(m ->> 'competition', '') NOT IN('champions-league','europa-league') OR coalesce(m->>'season','') <> '2026-2027' OR coalesce(m ->> 'stage', '')<>'league-phase' OR coalesce(m->>'round','')
    NOT IN ('1', '2') OR coalesce(m ->> 'source', '') !~ '^https://[^/[:space:]]+/' THEN
            RAISE EXCEPTION 'Compétition, phase, journée, saison ou source invalide.';
        END IF;
        SELECT
            count(*)
        INTO
            seq
        FROM
            jsonb_array_elements(payload -> 'matches') x
WHERE
    x ->> 'competition' = m ->> 'competition'
    AND x ->> 'round' = m ->> 'round';
        IF seq > 18 THEN
            RAISE EXCEPTION 'Plus de 18 matchs dans une journée.';
        END IF;
        SELECT
            count(*)
        INTO
            seq
        FROM
            jsonb_array_elements(payload -> 'matches') x
WHERE
    x ->> 'competition' = m ->> 'competition'
    AND ((x ->> 'home_key' = m ->> 'home_key'
            OR x ->> 'away_key' = m ->> 'home_key'
            OR x ->> 'home_key' = m ->> 'away_key'
            OR x ->> 'away_key' = m ->> 'away_key')
            AND x ->> 'round' = m ->> 'round');
        IF seq <> 1 THEN
            RAISE EXCEPTION 'Une équipe joue plusieurs fois dans la journée.';
        END IF;
        IF EXISTS (
            SELECT
                1
            FROM
                jsonb_array_elements(payload -> 'matches') x
            WHERE
                x ->> 'competition' <> m ->> 'competition'
                AND (x ->> 'home_key' IN (m ->> 'home_key', m ->> 'away_key')
                OR x ->> 'away_key' IN (m ->> 'home_key', m ->> 'away_key'))) THEN
            RAISE EXCEPTION 'Un club figure dans les deux phases de ligue.';
        END IF;
        SELECT
            count(DISTINCT k)
        INTO
            seq
        FROM (
            SELECT
                x ->> 'home_key' AS k
            FROM
                jsonb_array_elements(payload -> 'matches') x
            WHERE
                x ->> 'competition' = m ->> 'competition'
            UNION ALL
            SELECT
                x ->> 'away_key'
            FROM
                jsonb_array_elements(payload -> 'matches') x
            WHERE
                x ->> 'competition' = m ->> 'competition') clubs_in_file;
        IF seq > 36 THEN
            RAISE EXCEPTION 'Plus de 36 participants dans une phase de ligue.';
        END IF;
        SELECT
            id
        INTO
            compid
        FROM
            public.competitions
        WHERE
            slug = m ->> 'competition'
            AND type = 'european-cup';
        IF compid IS NULL THEN
            RAISE EXCEPTION 'Créez la compétition européenne avant import.';
        END IF;
        SELECT
            id
        INTO
            sid
        FROM
            public.seasons
        WHERE
            competition_id = compid
            AND start_year = 2026
            AND end_year = 2027;
        IF sid IS NULL THEN
            INSERT INTO public.seasons (competition_id, label, start_year, end_year, is_published)
                VALUES (compid, '2026–2027', 2026, 2027, TRUE)
            RETURNING
                id
            INTO
                sid;
        END IF;
        h = (MAPPING ->> (m ->> 'home_key'))::uuid;
        a = (MAPPING ->> (m ->> 'away_key'))::uuid;
        IF h IS NULL OR a IS NULL OR h = a THEN
            RAISE EXCEPTION 'Deux équipes distinctes enregistrées requises.';
        END IF;
        stamp = (m ->> 'kickoff')::timestamptz;
        gh = nullif (m ->> 'goals_home', '')::integer;
        ga = nullif (m ->> 'goals_away', '')::integer;
        IF stamp IS NULL OR stamp < '2026-07-01'::timestamptz OR stamp >= '2027-07-01'::timestamptz OR m ->> 'kickoff' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR (gh IS NULL) <> (ga IS NULL) OR gh < 0 OR ga < 0 OR gh > 32767 OR ga > 32767 OR coalesce(m ->> 'status', '')
    NOT IN ('finished', 'scheduled', 'postponed', 'cancelled') OR (m ->> 'status' <> 'finished' AND gh IS NOT NULL) OR (gh IS NOT NULL AND stamp > clock_timestamp()) THEN
            RAISE EXCEPTION 'Date, score ou statut incohérent.';
        END IF;
        SELECT
            count(*)
        INTO
            seq
        FROM
            public.matches
        WHERE
            season_id = sid
            AND home_team_id = h
            AND away_team_id = a;
        IF seq > 1 THEN
            RAISE EXCEPTION 'Rencontres existantes ambiguës : résolution manuelle.';
        END IF;
        IF seq = 1 THEN
            reused = reused + 1;
            CONTINUE;
        END IF;
        INSERT INTO public.season_teams (season_id, team_id)
            VALUES (sid, h)
        ON CONFLICT
            DO NOTHING;
        GET DIAGNOSTICS seq = ROW_COUNT;
        members_added = members_added + seq;
        INSERT INTO public.season_teams (season_id, team_id)
            VALUES (sid, a)
        ON CONFLICT
            DO NOTHING;
        GET DIAGNOSTICS seq = ROW_COUNT;
        members_added = members_added + seq;
        INSERT INTO public.matches (season_id, round, kickoff, home_team_id, away_team_id, status, goals_home, goals_away, source, verified_at, comment, is_published)
            VALUES (sid, 'Phase de ligue · Journée ' || (m ->> 'round'), stamp, h, a, m ->> 'status', gh, ga, m ->> 'source', CASE WHEN gh IS NOT NULL THEN
                    clock_timestamp()
                ELSE
                    NULL
                END, m ->> 'comment', FALSE)
        RETURNING
            id
        INTO
            mid;
        INSERT INTO public.match_team_stats (match_id, team_id)
        VALUES
            (mid, h),
            (mid, a);
        drafts = drafts + 1;
    END LOOP;
report = jsonb_build_object('drafts', drafts, 'existing', reused, 'newClubs', clubs_created, 'members', members_added, 'published', 0);
INSERT INTO public.europe_preparation_runs (nonce, actor_id, request, report)
    VALUES (client_nonce, auth.uid (), payload, report);
RETURN report;
END
$$;
REVOKE ALL ON FUNCTION public.europe_prepare_drafts (jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.europe_prepare_drafts (jsonb, uuid) TO authenticated;
NOTIFY pgrst,
'reload schema';
$previous$; END IF; END $bootstrap$;

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

-- CALCITO : correction de la publication avec la protection safeupdate active.
-- À exécuter une fois dans Supabase > SQL Editor > Run.
-- Ne publie aucun match, ne réimporte rien et ne désactive aucune protection.
BEGIN;
CREATE OR REPLACE FUNCTION public._arena_result_trigger ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    tid uuid;
BEGIN
    IF NOT NEW.is_published AND (tg_op = 'INSERT' OR NOT OLD.is_published) THEN
        RETURN NEW;
    END IF;
    PERFORM
        _arena_lock ();
    IF tg_op = 'UPDATE' AND ((NEW.home_team_id,
        NEW.away_team_id,
        NEW.season_id) IS DISTINCT FROM (OLD.home_team_id,
    OLD.away_team_id,
    OLD.season_id) OR (NEW.kickoff IS DISTINCT FROM OLD.kickoff AND NEW.status IN ('scheduled', 'live'))) THEN
        UPDATE
            arena_legs
        SET
            voided = TRUE
        WHERE
            match_id = NEW.id;
    END IF;
    IF (tg_op = 'INSERT' AND NEW.is_published AND NEW.status = 'finished') OR (tg_op = 'UPDATE' AND (NEW.status = 'finished' OR OLD.status = 'finished') AND (NEW.goals_home,
NEW.goals_away,
NEW.status,
NEW.is_published,
NEW.verified_at,
NEW.kickoff,
NEW.home_team_id,
NEW.away_team_id,
NEW.season_id) IS DISTINCT FROM (OLD.goals_home,
OLD.goals_away,
OLD.status,
OLD.is_published,
OLD.verified_at,
OLD.kickoff,
OLD.home_team_id,
OLD.away_team_id,
OLD.season_id)) THEN
        UPDATE
            arena_model
        SET
            enabled = FALSE,
            report = report || jsonb_build_object('enabled', FALSE, 'reason', 'Résultats modifiés : recalibration requise pour les nouvelles cotes.')
        WHERE singleton = TRUE;
    END IF;
    FOR tid IN SELECT DISTINCT
        ticket_id
    FROM
        arena_legs
    WHERE
        match_id = NEW.id LOOP
            PERFORM
                _arena_settle (tid);
        END LOOP;
    RETURN new;
END
$$;
COMMIT;
SELECT 'Correctif de publication installé. Vous pouvez relancer la publication dans Calcito.' AS resultat;

BEGIN;
DO $owner$ DECLARE uid uuid; n integer; BEGIN
 SELECT count(*),min(user_id::text)::uuid INTO n,uid FROM public.admin_users;
 IF n<>1 THEN RAISE EXCEPTION 'Un seul propriétaire doit être identifié pour ce script. Aucune donnée de match enregistrée.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid::text,'role','authenticated')::text,true);
END $owner$;
SELECT public.import_match_statistics($records${"format":"calcito-match-statistics-v1","source":"Lecture visuelle des 72 captures transmises par le propriétaire. Pas de vérification indépendante des résultats.","requires_publication_approval":true,"matches":[{"id":"CL-01","source_key":"41503f80409d756607b3035287f45d65280b6206e7ee2d3b7c77a13fa923f0f0","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T16:45:00.000Z","displayed_date":"2026-09-08T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.71,"possession":49,"shots":18,"shots_on_target":4,"big_chances":4,"corners":7,"yellow_cards":1,"red_cards":null,"pass_accuracy":84,"passes_completed":341,"passes_attempted":405},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.72,"possession":51,"shots":11,"shots_on_target":3,"big_chances":3,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":81,"passes_completed":345,"passes_attempted":426},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"AEK Athens","source_name":"AEK","slug":"aek-athens","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["aek","aekathens","aekathenes"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/aek.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/AEK%20Athens.png","logo_blob_sha":"3fe7958ca179b78065fcdca8ff1d1e920d739294","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/AEK Athens.png"},"away_club":{"name":"LASK","source_name":"LASK","slug":"lask","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["lask"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lask.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/LASK.png","logo_blob_sha":"44ca0eb54b5f820a6a7f294f3f7230e038bcdc80","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/LASK.png"}},{"id":"CL-02","source_key":"f315048bee1a90aee3b88e87cb57e2948311e54bfed289135211b7b579d798b7","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T16:45:00.000Z","displayed_date":"2026-09-08T18:45","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.53,"possession":64,"shots":14,"shots_on_target":7,"big_chances":2,"corners":4,"yellow_cards":3,"red_cards":null,"pass_accuracy":88,"passes_completed":532,"passes_attempted":602},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.22,"possession":36,"shots":21,"shots_on_target":9,"big_chances":4,"corners":5,"yellow_cards":3,"red_cards":null,"pass_accuracy":83,"passes_completed":280,"passes_attempted":337},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Club Brugge KV","source_name":"Club Brugge","slug":"club-brugge-kv","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["clubbrugge","clubbruggekv","clubbruges"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/club-brugge.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/Club%20Brugge%20KV.png","logo_blob_sha":"0a85af7d0dabccc1713b929cec01542dd6dd49dc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/Club Brugge KV.png"},"away_club":{"name":"Aston Villa FC","source_name":"Aston Villa","slug":"aston-villa-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["astonvilla","astonvillafc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/aston-villa.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Aston%20Villa.png","logo_blob_sha":"f1081b911ae6592533eeb92f0f1cddd661b8e03b","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Aston Villa.png"}},{"id":"CL-03","source_key":"5e06d25a42c4c4b11a42b6f6b6d0aa40ee7117b89c147e568d9359cd679f560a","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.63,"possession":54,"shots":27,"shots_on_target":9,"big_chances":6,"corners":11,"yellow_cards":1,"red_cards":null,"pass_accuracy":85,"passes_completed":423,"passes_attempted":499},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.83,"possession":46,"shots":15,"shots_on_target":10,"big_chances":3,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":84,"passes_completed":375,"passes_attempted":445},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Manchester City FC","source_name":"Manchester City","slug":"manchester-city-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["manchestercity","manchestercityfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/manchester-city.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Manchester%20City.png","logo_blob_sha":"b55d4568ad21f2c3bd09805a666b3252eda0595a","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Manchester City.png"},"away_club":{"name":"Paris Saint-Germain FC","source_name":"PSG","slug":"paris-saint-germain","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["psg","parissaintgermainfc","parissaintgermain","parissg"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/psg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Paris%20Saint-Germain.png","logo_blob_sha":"823a6035ccfc9a6f120d6fa8c91e0b86a68c0793","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Paris Saint-Germain.png"}},{"id":"CL-04","source_key":"b8ce24bb5d7f5b5758b1c2ea0ec482a2b6f9c2d64fe0f981ea9ba4a6a212d193","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T19:00:00.000Z","displayed_date":"2026-09-08T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.83,"possession":45,"shots":6,"shots_on_target":2,"big_chances":1,"corners":5,"yellow_cards":1,"red_cards":1,"pass_accuracy":88,"passes_completed":392,"passes_attempted":447},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.81,"possession":55,"shots":20,"shots_on_target":5,"big_chances":3,"corners":5,"yellow_cards":3,"red_cards":0,"pass_accuracy":88,"passes_completed":494,"passes_attempted":564},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Lille OSC","source_name":"Lille","slug":"lille","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lille","lilleosc","losclille"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lille.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/LOSC%20Lille.png","logo_blob_sha":"318a01561441fae398ba9c90775fe05a60903a1f","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/LOSC Lille.png"},"away_club":{"name":"Real Betis Balompié","source_name":"Betis","slug":"real-betis-balompie","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["betis","realbetisbalompie","realbetis"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/betis.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Betis%20Balompi%C3%A9.png","logo_blob_sha":"8e3808a0788aa8f7ae7915265544774c9317518d","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Betis Balompié.png"}},{"id":"CL-05","source_key":"1389b6df6427e32d849523f6fdd273e59c3c8217294e8d10d559d8217281d406","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T19:00:00.000Z","displayed_date":"2026-09-08T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.28,"possession":36,"shots":5,"shots_on_target":0,"big_chances":0,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":81,"passes_completed":285,"passes_attempted":353},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.32,"possession":64,"shots":20,"shots_on_target":10,"big_chances":6,"corners":5,"yellow_cards":3,"red_cards":null,"pass_accuracy":93,"passes_completed":589,"passes_attempted":635},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FC Porto","source_name":"FC Porto","slug":"fc-porto","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["fcporto","porto"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/fc-porto.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/FC%20Porto.png","logo_blob_sha":"9cdf906e1870ba57bd97aba929a084f1742f663b","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/FC Porto.png"},"away_club":{"name":"Manchester City FC","source_name":"Manchester City","slug":"manchester-city-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["manchestercity","manchestercityfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/manchester-city.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Manchester%20City.png","logo_blob_sha":"b55d4568ad21f2c3bd09805a666b3252eda0595a","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Manchester City.png"}},{"id":"CL-06","source_key":"7150f7cea01bb229eecedb040919c4a800647ce191b52c28d5842539db8d9790","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T19:00:00.000Z","displayed_date":"2026-09-08T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.91,"possession":36,"shots":16,"shots_on_target":8,"big_chances":9,"corners":4,"yellow_cards":1,"red_cards":null,"pass_accuracy":87,"passes_completed":305,"passes_attempted":352},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.82,"possession":64,"shots":21,"shots_on_target":7,"big_chances":4,"corners":11,"yellow_cards":3,"red_cards":null,"pass_accuracy":94,"passes_completed":582,"passes_attempted":621},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Real Madrid CF","source_name":"Real Madrid","slug":"real-madrid-cf","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["realmadrid","realmadridcf"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/real-madrid.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Madrid.png","logo_blob_sha":"e713ce0470f9673294c374596889a659b2624dcf","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Madrid.png"},"away_club":{"name":"FC Internazionale Milano","source_name":"Inter","slug":"fc-internazionale-milano","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["inter","fcinternazionalemilano","intermilan","internazionale"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/inter.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Inter%20Milan.png","logo_blob_sha":"3749aa06618e3946683484d069a9ef9a87e52341","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Inter Milan.png"}},{"id":"CL-07","source_key":"a0ff04bdd4d45e3d78ee982e4e2c6e861b903cb990c864dbe098bf5d681cf78d","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T16:45:00.000Z","displayed_date":"2026-09-09T18:45","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.18,"possession":62,"shots":17,"shots_on_target":3,"big_chances":4,"corners":3,"yellow_cards":0,"red_cards":null,"pass_accuracy":86,"passes_completed":540,"passes_attempted":626},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.63,"possession":38,"shots":9,"shots_on_target":3,"big_chances":0,"corners":5,"yellow_cards":3,"red_cards":null,"pass_accuracy":71,"passes_completed":273,"passes_attempted":384},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"VfB Stuttgart","source_name":"Stuttgart","slug":"vfb-stuttgart","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["stuttgart","vfbstuttgart"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/stuttgart.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/VfB%20Stuttgart.png","logo_blob_sha":"c42c4eccbc2c63925567801ce896ef659e143881","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/VfB Stuttgart.png"},"away_club":{"name":"Viking FK","source_name":"Viking","slug":"viking-fk","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["viking","vikingfk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/viking.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/Viking%20FK.png","logo_blob_sha":"8616d4ac676eabd94938492b9098b298fba34145","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/Viking FK.png"}},{"id":"CL-08","source_key":"0964e6bc772606f8101e721ae78adf71c096066b259259140614897247f1b8ba","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T16:45:00.000Z","displayed_date":"2026-09-09T18:45","timezone_proposal":"Europe/Paris","goals_home":5,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.11,"possession":72,"shots":24,"shots_on_target":9,"big_chances":3,"corners":4,"yellow_cards":1,"red_cards":null,"pass_accuracy":94,"passes_completed":746,"passes_attempted":793},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.53,"possession":28,"shots":4,"shots_on_target":2,"big_chances":2,"corners":1,"yellow_cards":1,"red_cards":null,"pass_accuracy":83,"passes_completed":256,"passes_attempted":308},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FC Barcelona","source_name":"Barcelone","slug":"fc-barcelona","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["barcelone","fcbarcelona","barcelona"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/barcelone.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/FC%20Barcelona.png","logo_blob_sha":"bfaffd03668480678408bc5021e592de8f2b8d4e","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/FC Barcelona.png"},"away_club":{"name":"Feyenoord Rotterdam","source_name":"Feyenoord","slug":"feyenoord-rotterdam","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["feyenoord","feyenoordrotterdam"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/feyenoord.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/Feyenoord%20Rotterdam.png","logo_blob_sha":"7ba0886fc814f4c57e560c3320fdc1f99bed9fec","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/Feyenoord Rotterdam.png"}},{"id":"CL-09","source_key":"535229bc026f4cce19250215dc3e770a4469eb891d67dd9694437000656c4928","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-08T19:00:00.000Z","displayed_date":"2026-09-08T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.83,"possession":52,"shots":18,"shots_on_target":6,"big_chances":6,"corners":9,"yellow_cards":1,"red_cards":null,"pass_accuracy":90,"passes_completed":461,"passes_attempted":514},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.45,"possession":48,"shots":13,"shots_on_target":6,"big_chances":2,"corners":7,"yellow_cards":3,"red_cards":null,"pass_accuracy":86,"passes_completed":413,"passes_attempted":481},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Borussia Dortmund","source_name":"Dortmund","slug":"borussia-dortmund","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["dortmund","borussiadortmund"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/dortmund.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Borussia%20Dortmund.png","logo_blob_sha":"2dc4b0289782930c6b81b40309e81039928225fc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Borussia Dortmund.png"},"away_club":{"name":"Villarreal CF","source_name":"Villarreal","slug":"villarreal-cf","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["villarreal","villarrealcf"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/villarreal.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Villarreal%20CF.png","logo_blob_sha":"f750f3e8ceb5613d439ece556ad6a0edf7a187d0","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Villarreal CF.png"}},{"id":"CL-10","source_key":"cf29dd9ac6f66eb3c868412292cb688f8b3fd83bccaaefdf0d9a13f03979445c","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T19:00:00.000Z","displayed_date":"2026-09-09T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.23,"possession":42,"shots":5,"shots_on_target":3,"big_chances":0,"corners":0,"yellow_cards":2,"red_cards":null,"pass_accuracy":86,"passes_completed":383,"passes_attempted":446},"away_stats":{"woodwork":null,"team_rating":null,"xg":4.04,"possession":58,"shots":26,"shots_on_target":8,"big_chances":5,"corners":6,"yellow_cards":1,"red_cards":null,"pass_accuracy":92,"passes_completed":559,"passes_attempted":608},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"SSC Napoli","source_name":"Naples","slug":"ssc-napoli","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["naples","sscnapoli","napoli"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/naples.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/SSC%20Napoli.png","logo_blob_sha":"31c5cd81086c54d5150b4b767e7d2761dfa4d7c8","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/SSC Napoli.png"},"away_club":{"name":"Arsenal FC","source_name":"Arsenal","slug":"arsenal-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["arsenal","arsenalfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/arsenal.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Arsenal%20FC.png","logo_blob_sha":"24f24c15aa0e0094cbb54fab4c7fc82407b6a0ff","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Arsenal FC.png"}},{"id":"CL-11","source_key":"ef9dc09d6499b93f88e2a576df6b2e73a0be584046827c567de79861160e8187","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T19:00:00.000Z","displayed_date":"2026-09-09T21:00","timezone_proposal":"Europe/Paris","goals_home":6,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":4.57,"possession":72,"shots":35,"shots_on_target":14,"big_chances":8,"corners":7,"yellow_cards":0,"red_cards":null,"pass_accuracy":92,"passes_completed":674,"passes_attempted":732},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.76,"possession":28,"shots":9,"shots_on_target":4,"big_chances":1,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":74,"passes_completed":212,"passes_attempted":285},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Paris Saint-Germain FC","source_name":"PSG","slug":"paris-saint-germain","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["psg","parissaintgermainfc","parissaintgermain","parissg"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/psg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Paris%20Saint-Germain.png","logo_blob_sha":"823a6035ccfc9a6f120d6fa8c91e0b86a68c0793","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Paris Saint-Germain.png"},"away_club":{"name":"ŠK Slovan Bratislava","source_name":"Slovan Bratislava","slug":"sk-slovan-bratislava","country":"Slovaquie","domestic_competition":null,"domestic_league":"Première division slovaque","identity_keys":["slovanbratislava","skslovanbratislava"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/slovan-bratislava.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/250px-SK_Slovan_Bratislava_logo.svg.png","logo_blob_sha":"be3a21e9fbdfe8e6f468d7f2284d6a96ed11c53c","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/250px-SK_Slovan_Bratislava_logo.svg.png"}},{"id":"CL-12","source_key":"74c2ff220ace73ffac1fe78b79417fbe4616f916af033efedcb2d3b65ce96b91","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T19:00:00.000Z","displayed_date":"2026-09-09T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.62,"possession":45,"shots":14,"shots_on_target":5,"big_chances":4,"corners":7,"yellow_cards":1,"red_cards":null,"pass_accuracy":84,"passes_completed":354,"passes_attempted":419},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.91,"possession":55,"shots":9,"shots_on_target":4,"big_chances":1,"corners":5,"yellow_cards":1,"red_cards":null,"pass_accuracy":85,"passes_completed":438,"passes_attempted":515},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Liverpool FC","source_name":"Liverpool","slug":"liverpool-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["liverpool","liverpoolfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/liverpool.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Liverpool%20FC.png","logo_blob_sha":"654691d267680a6683fe58c55619de0684185404","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Liverpool FC.png"},"away_club":{"name":"Club Atlético de Madrid","source_name":"Atl. Madrid","slug":"club-atletico-de-madrid","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["atlmadrid","clubatleticodemadrid","atleticodemadrid","atleticomadrid"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/atl-madrid.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Atl%C3%A9tico%20de%20Madrid.png","logo_blob_sha":"7398c88ac9e34f7bb7df9207802bffe07db5d560","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Atlético de Madrid.png"}},{"id":"CL-13","source_key":"53dddce31564e1015c2a4207f65d7684beac40274ffe259458d7d211af93bd39","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T16:45:00.000Z","displayed_date":"2026-09-10T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.44,"possession":54,"shots":10,"shots_on_target":2,"big_chances":0,"corners":3,"yellow_cards":3,"red_cards":null,"pass_accuracy":87,"passes_completed":380,"passes_attempted":439},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.62,"possession":46,"shots":8,"shots_on_target":2,"big_chances":0,"corners":3,"yellow_cards":6,"red_cards":null,"pass_accuracy":81,"passes_completed":314,"passes_attempted":389},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"PSV Eindhoven","source_name":"PSV","slug":"psv-eindhoven","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["psv","psveindhoven"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/psv.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/PSV%20Eindhoven.png","logo_blob_sha":"b398db001e288d7261d647188b91782f7ee85f00","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/PSV Eindhoven.png"},"away_club":{"name":"Shakhtar Donetsk","source_name":"Shakhtar","slug":"shakhtar-donetsk","country":"Ukraine","domestic_competition":null,"domestic_league":"Premier League ukrainienne","identity_keys":["shakhtar","shakhtardonetsk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/shakhtar.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Ukraine%20-%20Premier%20Liga/Shakhtar%20Donetsk.png","logo_blob_sha":"f564222a059023f10ee9e58cbf79bd50de543915","logo_repository":"luukhopman/football-logos","logo_path":"logos/Ukraine - Premier Liga/Shakhtar Donetsk.png"}},{"id":"CL-14","source_key":"228acddc2ca26e7960dfdddfc6fb25370cfb16626c87f6e53a4dc598f9a5e7c7","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T16:45:00.000Z","displayed_date":"2026-09-10T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.58,"possession":42,"shots":11,"shots_on_target":5,"big_chances":3,"corners":1,"yellow_cards":4,"red_cards":null,"pass_accuracy":84,"passes_completed":369,"passes_attempted":441},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.47,"possession":58,"shots":8,"shots_on_target":3,"big_chances":1,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":90,"passes_completed":553,"passes_attempted":614},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Fenerbahce","source_name":"Fenerbahce","slug":"fenerbahce","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["fenerbahce"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/fenerbahce.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Fenerbahce.png","logo_blob_sha":"028d2942488922fc78ea6e0f336c1400eee198bc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Fenerbahce.png"},"away_club":{"name":"AS Roma","source_name":"AS Rome","slug":"as-roma","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["asrome","asroma","roma"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/as-rome.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/AS%20Roma.png","logo_blob_sha":"29eb52986c5a31579b6b73ba16ebb6f3d3597554","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/AS Roma.png"}},{"id":"CL-15","source_key":"03583ef514d0e891fa4e9e00478d176e9d733f04176e03a9ad8e2f80a1bc8601","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-09T19:00:00.000Z","displayed_date":"2026-09-09T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.75,"possession":38,"shots":8,"shots_on_target":5,"big_chances":2,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":81,"passes_completed":299,"passes_attempted":368},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.24,"possession":62,"shots":10,"shots_on_target":3,"big_chances":2,"corners":4,"yellow_cards":3,"red_cards":null,"pass_accuracy":90,"passes_completed":519,"passes_attempted":579},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Sporting Clube de Portugal","source_name":"Sporting","slug":"sporting-cp","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["sporting","sportingclubedeportugal","sportingcp","sportingportugal"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sporting.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/Sporting%20CP.png","logo_blob_sha":"75ec4ab8971a86ca3f327197f0fd3374cf016e75","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/Sporting CP.png"},"away_club":{"name":"Galatasaray","source_name":"Galatasaray","slug":"galatasaray","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["galatasaray"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/galatasaray.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Galatasaray.png","logo_blob_sha":"56b20744bc010770258cc64d08235aaede51fd67","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Galatasaray.png"}},{"id":"CL-16","source_key":"5981ef29ecf6fae1e68516dacc214a331936a5dd6b4807325a1117f669185191","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T19:00:00.000Z","displayed_date":"2026-09-10T21:00","timezone_proposal":"Europe/Paris","goals_home":4,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.98,"possession":50,"shots":14,"shots_on_target":6,"big_chances":7,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":90,"passes_completed":467,"passes_attempted":519},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.36,"possession":50,"shots":14,"shots_on_target":4,"big_chances":3,"corners":5,"yellow_cards":3,"red_cards":null,"pass_accuracy":89,"passes_completed":444,"passes_attempted":498},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Como 1907","source_name":"Côme","slug":"como-1907","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["come","como1907","como"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/come.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Como%201907.png","logo_blob_sha":"e2e17a77263e709c88215a02a170b31ac10457bc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Como 1907.png"},"away_club":{"name":"RB Leipzig","source_name":"RB Leipzig","slug":"rb-leipzig","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["rbleipzig"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/rb-leipzig.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/RB%20Leipzig.png","logo_blob_sha":"06a031c8920a0f0dcd3df6b2e95629fa8b99ced9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/RB Leipzig.png"}},{"id":"CL-17","source_key":"df7f0bee5e7ba3f679735b167145312859497b449e68fb0c0f97c4dbe3043299","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T19:00:00.000Z","displayed_date":"2026-09-10T21:00","timezone_proposal":"Europe/Paris","goals_home":4,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":3.55,"possession":58,"shots":21,"shots_on_target":10,"big_chances":5,"corners":7,"yellow_cards":1,"red_cards":null,"pass_accuracy":92,"passes_completed":573,"passes_attempted":624},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.83,"possession":42,"shots":11,"shots_on_target":0,"big_chances":2,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":86,"passes_completed":391,"passes_attempted":455},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Manchester United FC","source_name":"Manchester Utd","slug":"manchester-united-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["manchesterutd","manchesterunitedfc","manchesterunited"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/manchester-utd.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Manchester%20United.png","logo_blob_sha":"4e2a112b088c67916aaf973d4eb1a6dfbdb38b88","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Manchester United.png"},"away_club":{"name":"FK Sabah","source_name":"Sabah FC","slug":"fk-sabah","country":"Azerbaïdjan","domestic_competition":null,"domestic_league":"Première division azerbaïdjanaise","identity_keys":["sabahfc","fksabah","sabahfk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sabah-fc.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/Sabah_FC__Azerbaijan_.png","logo_blob_sha":"39d257ebd6c686ccc651812c44976a2f8ba8cbc8","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/Sabah_FC__Azerbaijan_.png"}},{"id":"CL-18","source_key":"c3c8a11c9ac75905c3443501a97bd791ef12eba5c7afefc3938fe99c0496bbeb","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T19:00:00.000Z","displayed_date":"2026-09-10T21:00","timezone_proposal":"Europe/Paris","goals_home":5,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.62,"possession":66,"shots":25,"shots_on_target":12,"big_chances":3,"corners":6,"yellow_cards":0,"red_cards":null,"pass_accuracy":93,"passes_completed":648,"passes_attempted":699},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.3,"possession":34,"shots":3,"shots_on_target":0,"big_chances":0,"corners":3,"yellow_cards":1,"red_cards":null,"pass_accuracy":80,"passes_completed":285,"passes_attempted":356},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FC Bayern München","source_name":"Bayern Munich","slug":"fc-bayern-munchen","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["bayernmunich","fcbayernmunchen","bayernmunchen","bayernmunichfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bayern-munich.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Bayern%20Munich.png","logo_blob_sha":"499ce6f97c63f974b5b439eb977377e127f71a34","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Bayern Munich.png"},"away_club":{"name":"FK BodøGlimt","source_name":"Bodo/Glimt","slug":"fk-bod-glimt","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["bodoglimt","fkbodglimt","bodglimt"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bodo-glimt.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/FK%20Bod%C3%B8Glimt.png","logo_blob_sha":"bfe2c86a333e2556dc5a6dbf7876f63cfa1f517e","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/FK BodøGlimt.png"}},{"id":"CL-19","source_key":"2a3223d8f29896a938d26d8fc4b59bb4cb1b1646717fef00e1cfaf01a6dfcc2e","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T16:45:00.000Z","displayed_date":"2026-10-13T18:45","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.34,"possession":45,"shots":13,"shots_on_target":6,"big_chances":1,"corners":3,"yellow_cards":3,"red_cards":null,"pass_accuracy":74,"passes_completed":251,"passes_attempted":341},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.14,"possession":55,"shots":18,"shots_on_target":8,"big_chances":5,"corners":6,"yellow_cards":2,"red_cards":null,"pass_accuracy":78,"passes_completed":315,"passes_attempted":403},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FK Sabah","source_name":"Sabah FC","slug":"fk-sabah","country":"Azerbaïdjan","domestic_competition":null,"domestic_league":"Première division azerbaïdjanaise","identity_keys":["sabahfc","fksabah","sabahfk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sabah-fc.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/Sabah_FC__Azerbaijan_.png","logo_blob_sha":"39d257ebd6c686ccc651812c44976a2f8ba8cbc8","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/Sabah_FC__Azerbaijan_.png"},"away_club":{"name":"SK Slavia Prague","source_name":"Slavia Prague","slug":"sk-slavia-prague","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["slaviaprague","skslaviaprague","slaviapraha"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/slavia-prague.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/SK%20Slavia%20Prague.png","logo_blob_sha":"844813da06ba270677d8fffafcc2b304fe0c8e99","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/SK Slavia Prague.png"}},{"id":"CL-20","source_key":"c1f131e5066cf0273a7190aaa9188c66c5c2dba1ae50ea7800106231254777cb","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T16:45:00.000Z","displayed_date":"2026-10-13T18:45","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.51,"possession":56,"shots":21,"shots_on_target":6,"big_chances":1,"corners":6,"yellow_cards":2,"red_cards":null,"pass_accuracy":88,"passes_completed":481,"passes_attempted":544},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.67,"possession":44,"shots":11,"shots_on_target":5,"big_chances":3,"corners":3,"yellow_cards":0,"red_cards":null,"pass_accuracy":85,"passes_completed":366,"passes_attempted":432},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Racing Club de Lens","source_name":"Lens","slug":"lens","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lens","racingclubdelens","rclens"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lens.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/RC%20Lens.png","logo_blob_sha":"eea54b4f024c3c3cf0baee558823579e6f7df612","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/RC Lens.png"},"away_club":{"name":"Sporting Clube de Portugal","source_name":"Sporting","slug":"sporting-cp","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["sporting","sportingclubedeportugal","sportingcp","sportingportugal"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sporting.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/Sporting%20CP.png","logo_blob_sha":"75ec4ab8971a86ca3f327197f0fd3374cf016e75","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/Sporting CP.png"}},{"id":"CL-21","source_key":"11ab9a291ab1270618cfb686782e204c61ed52f00928d7493b9a56b13526709e","competition":"champions-league","season":"2026-2027","round":"1","kickoff":"2026-09-10T19:00:00.000Z","displayed_date":"2026-09-10T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.58,"possession":37,"shots":17,"shots_on_target":5,"big_chances":2,"corners":6,"yellow_cards":0,"red_cards":1,"pass_accuracy":72,"passes_completed":190,"passes_attempted":264},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.78,"possession":63,"shots":26,"shots_on_target":8,"big_chances":4,"corners":9,"yellow_cards":1,"red_cards":0,"pass_accuracy":82,"passes_completed":360,"passes_attempted":441},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"SK Slavia Prague","source_name":"Slavia Prague","slug":"sk-slavia-prague","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["slaviaprague","skslaviaprague","slaviapraha"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/slavia-prague.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/SK%20Slavia%20Prague.png","logo_blob_sha":"844813da06ba270677d8fffafcc2b304fe0c8e99","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/SK Slavia Prague.png"},"away_club":{"name":"Racing Club de Lens","source_name":"Lens","slug":"lens","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lens","racingclubdelens","rclens"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lens.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/RC%20Lens.png","logo_blob_sha":"eea54b4f024c3c3cf0baee558823579e6f7df612","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/RC Lens.png"}},{"id":"CL-22","source_key":"a59d356b29a347230130c9fa234405cf0cc281f730bd219cd5af86e85194bb45","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.76,"possession":43,"shots":19,"shots_on_target":7,"big_chances":3,"corners":6,"yellow_cards":1,"red_cards":null,"pass_accuracy":83,"passes_completed":289,"passes_attempted":350},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.45,"possession":57,"shots":11,"shots_on_target":5,"big_chances":1,"corners":12,"yellow_cards":2,"red_cards":null,"pass_accuracy":83,"passes_completed":387,"passes_attempted":464},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"RB Leipzig","source_name":"RB Leipzig","slug":"rb-leipzig","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["rbleipzig"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/rb-leipzig.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/RB%20Leipzig.png","logo_blob_sha":"06a031c8920a0f0dcd3df6b2e95629fa8b99ced9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/RB Leipzig.png"},"away_club":{"name":"PSV Eindhoven","source_name":"PSV","slug":"psv-eindhoven","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["psv","psveindhoven"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/psv.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/PSV%20Eindhoven.png","logo_blob_sha":"b398db001e288d7261d647188b91782f7ee85f00","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/PSV Eindhoven.png"}},{"id":"CL-23","source_key":"f908719ac2e8a14be6a508ffc00f21aebff68c9e7385ad171f90839f0d488d8d","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.72,"possession":34,"shots":8,"shots_on_target":5,"big_chances":1,"corners":7,"yellow_cards":2,"red_cards":0,"pass_accuracy":74,"passes_completed":210,"passes_attempted":284},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.29,"possession":66,"shots":25,"shots_on_target":8,"big_chances":3,"corners":15,"yellow_cards":4,"red_cards":1,"pass_accuracy":88,"passes_completed":498,"passes_attempted":566},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Viking FK","source_name":"Viking","slug":"viking-fk","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["viking","vikingfk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/viking.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/Viking%20FK.png","logo_blob_sha":"8616d4ac676eabd94938492b9098b298fba34145","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/Viking FK.png"},"away_club":{"name":"FC Bayern München","source_name":"Bayern Munich","slug":"fc-bayern-munchen","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["bayernmunich","fcbayernmunchen","bayernmunchen","bayernmunichfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bayern-munich.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Bayern%20Munich.png","logo_blob_sha":"499ce6f97c63f974b5b439eb977377e127f71a34","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Bayern Munich.png"}},{"id":"CL-24","source_key":"b0ce75abf045b508c297c21dfb139f10113c85ed897d7e3176c10988dfdab9b8","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.85,"possession":58,"shots":16,"shots_on_target":8,"big_chances":4,"corners":7,"yellow_cards":2,"red_cards":null,"pass_accuracy":90,"passes_completed":488,"passes_attempted":542},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.38,"possession":42,"shots":4,"shots_on_target":0,"big_chances":0,"corners":0,"yellow_cards":1,"red_cards":null,"pass_accuracy":85,"passes_completed":343,"passes_attempted":404},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Arsenal FC","source_name":"Arsenal","slug":"arsenal-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["arsenal","arsenalfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/arsenal.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Arsenal%20FC.png","logo_blob_sha":"24f24c15aa0e0094cbb54fab4c7fc82407b6a0ff","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Arsenal FC.png"},"away_club":{"name":"Lille OSC","source_name":"Lille","slug":"lille","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lille","lilleosc","losclille"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lille.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/LOSC%20Lille.png","logo_blob_sha":"318a01561441fae398ba9c90775fe05a60903a1f","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/LOSC Lille.png"}},{"id":"CL-25","source_key":"6688cfc4e4195bd8e0f4e40be774dec43385c6f8c6c262672101d8be4f1890eb","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.46,"possession":58,"shots":11,"shots_on_target":5,"big_chances":2,"corners":2,"yellow_cards":1,"red_cards":0,"pass_accuracy":89,"passes_completed":577,"passes_attempted":651},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.98,"possession":42,"shots":9,"shots_on_target":4,"big_chances":4,"corners":5,"yellow_cards":1,"red_cards":1,"pass_accuracy":86,"passes_completed":396,"passes_attempted":463},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Club Atlético de Madrid","source_name":"Atl. Madrid","slug":"club-atletico-de-madrid","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["atlmadrid","clubatleticodemadrid","atleticodemadrid","atleticomadrid"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/atl-madrid.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Atl%C3%A9tico%20de%20Madrid.png","logo_blob_sha":"7398c88ac9e34f7bb7df9207802bffe07db5d560","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Atlético de Madrid.png"},"away_club":{"name":"Manchester United FC","source_name":"Manchester Utd","slug":"manchester-united-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["manchesterutd","manchesterunitedfc","manchesterunited"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/manchester-utd.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Manchester%20United.png","logo_blob_sha":"4e2a112b088c67916aaf973d4eb1a6dfbdb38b88","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Manchester United.png"}},{"id":"CL-26","source_key":"4929eeb79009ee1c3d5b9c74df159e46587fbeea63f6f8059a11e30b3e4b5be9","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.42,"possession":29,"shots":5,"shots_on_target":3,"big_chances":0,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":74,"passes_completed":203,"passes_attempted":274},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.73,"possession":71,"shots":22,"shots_on_target":11,"big_chances":10,"corners":6,"yellow_cards":0,"red_cards":null,"pass_accuracy":91,"passes_completed":627,"passes_attempted":691},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Galatasaray","source_name":"Galatasaray","slug":"galatasaray","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["galatasaray"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/galatasaray.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Galatasaray.png","logo_blob_sha":"56b20744bc010770258cc64d08235aaede51fd67","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Galatasaray.png"},"away_club":{"name":"FC Barcelona","source_name":"Barcelone","slug":"fc-barcelona","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["barcelone","fcbarcelona","barcelona"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/barcelone.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/FC%20Barcelona.png","logo_blob_sha":"bfaffd03668480678408bc5021e592de8f2b8d4e","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/FC Barcelona.png"}},{"id":"CL-27","source_key":"10acabb749547ef28ba9f39841fb700b06e8d25b1e31025bad848200ebd87866","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":4.33,"possession":53,"shots":30,"shots_on_target":12,"big_chances":7,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":87,"passes_completed":463,"passes_attempted":533},"away_stats":{"woodwork":null,"team_rating":null,"xg":4.28,"possession":47,"shots":18,"shots_on_target":8,"big_chances":6,"corners":4,"yellow_cards":5,"red_cards":null,"pass_accuracy":86,"passes_completed":409,"passes_attempted":475},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FC Internazionale Milano","source_name":"Inter","slug":"fc-internazionale-milano","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["inter","fcinternazionalemilano","intermilan","internazionale"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/inter.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Inter%20Milan.png","logo_blob_sha":"3749aa06618e3946683484d069a9ef9a87e52341","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Inter Milan.png"},"away_club":{"name":"Club Brugge KV","source_name":"Club Brugge","slug":"club-brugge-kv","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["clubbrugge","clubbruggekv","clubbruges"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/club-brugge.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/Club%20Brugge%20KV.png","logo_blob_sha":"0a85af7d0dabccc1713b929cec01542dd6dd49dc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/Club Brugge KV.png"}},{"id":"CL-28","source_key":"4f30065e1e2e53561c0da26b75127c947f57b6b8af9e274374c8d899cbe77684","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T16:45:00.000Z","displayed_date":"2026-10-14T18:45","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.59,"possession":48,"shots":13,"shots_on_target":5,"big_chances":0,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":87,"passes_completed":450,"passes_attempted":517},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.28,"possession":52,"shots":11,"shots_on_target":5,"big_chances":3,"corners":1,"yellow_cards":3,"red_cards":null,"pass_accuracy":91,"passes_completed":511,"passes_attempted":564},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Feyenoord Rotterdam","source_name":"Feyenoord","slug":"feyenoord-rotterdam","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["feyenoord","feyenoordrotterdam"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/feyenoord.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/Feyenoord%20Rotterdam.png","logo_blob_sha":"7ba0886fc814f4c57e560c3320fdc1f99bed9fec","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/Feyenoord Rotterdam.png"},"away_club":{"name":"Como 1907","source_name":"Côme","slug":"como-1907","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["come","como1907","como"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/come.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Como%201907.png","logo_blob_sha":"e2e17a77263e709c88215a02a170b31ac10457bc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Como 1907.png"}},{"id":"CL-29","source_key":"e2e5ea3c8a92b988bac301f3230a1f9c75f4389595a088fcf3039477a5bc469e","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-13T19:00:00.000Z","displayed_date":"2026-10-13T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.25,"possession":53,"shots":16,"shots_on_target":4,"big_chances":2,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":85,"passes_completed":392,"passes_attempted":459},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.7,"possession":47,"shots":11,"shots_on_target":3,"big_chances":3,"corners":4,"yellow_cards":3,"red_cards":null,"pass_accuracy":83,"passes_completed":329,"passes_attempted":395},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Villarreal CF","source_name":"Villarreal","slug":"villarreal-cf","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["villarreal","villarrealcf"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/villarreal.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Villarreal%20CF.png","logo_blob_sha":"f750f3e8ceb5613d439ece556ad6a0edf7a187d0","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Villarreal CF.png"},"away_club":{"name":"SSC Napoli","source_name":"Naples","slug":"ssc-napoli","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["naples","sscnapoli","napoli"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/naples.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/SSC%20Napoli.png","logo_blob_sha":"31c5cd81086c54d5150b4b767e7d2761dfa4d7c8","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/SSC Napoli.png"}},{"id":"CL-30","source_key":"d9bc4b25c0c1a716c80bcf25cf0d9ee5f1402bd9954afece99adb9202fda7339","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.78,"possession":36,"shots":15,"shots_on_target":1,"big_chances":1,"corners":1,"yellow_cards":1,"red_cards":null,"pass_accuracy":81,"passes_completed":288,"passes_attempted":357},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.19,"possession":64,"shots":16,"shots_on_target":8,"big_chances":7,"corners":8,"yellow_cards":3,"red_cards":null,"pass_accuracy":89,"passes_completed":561,"passes_attempted":627},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"ŠK Slovan Bratislava","source_name":"Slovan Bratislava","slug":"sk-slovan-bratislava","country":"Slovaquie","domestic_competition":null,"domestic_league":"Première division slovaque","identity_keys":["slovanbratislava","skslovanbratislava"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/slovan-bratislava.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/250px-SK_Slovan_Bratislava_logo.svg.png","logo_blob_sha":"be3a21e9fbdfe8e6f468d7f2284d6a96ed11c53c","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/250px-SK_Slovan_Bratislava_logo.svg.png"},"away_club":{"name":"VfB Stuttgart","source_name":"Stuttgart","slug":"vfb-stuttgart","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["stuttgart","vfbstuttgart"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/stuttgart.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/VfB%20Stuttgart.png","logo_blob_sha":"c42c4eccbc2c63925567801ce896ef659e143881","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/VfB Stuttgart.png"}},{"id":"CL-31","source_key":"9b2802812793c3cb0117083f454522741508dd46b0772da3928ce0c40fc8258a","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.36,"possession":54,"shots":12,"shots_on_target":4,"big_chances":2,"corners":5,"yellow_cards":1,"red_cards":null,"pass_accuracy":90,"passes_completed":403,"passes_attempted":446},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.34,"possession":46,"shots":13,"shots_on_target":3,"big_chances":5,"corners":2,"yellow_cards":4,"red_cards":null,"pass_accuracy":86,"passes_completed":318,"passes_attempted":371},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Shakhtar Donetsk","source_name":"Shakhtar","slug":"shakhtar-donetsk","country":"Ukraine","domestic_competition":null,"domestic_league":"Premier League ukrainienne","identity_keys":["shakhtar","shakhtardonetsk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/shakhtar.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Ukraine%20-%20Premier%20Liga/Shakhtar%20Donetsk.png","logo_blob_sha":"f564222a059023f10ee9e58cbf79bd50de543915","logo_repository":"luukhopman/football-logos","logo_path":"logos/Ukraine - Premier Liga/Shakhtar Donetsk.png"},"away_club":{"name":"AEK Athens","source_name":"AEK","slug":"aek-athens","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["aek","aekathens","aekathenes"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/aek.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/AEK%20Athens.png","logo_blob_sha":"3fe7958ca179b78065fcdca8ff1d1e920d739294","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/AEK Athens.png"}},{"id":"CL-32","source_key":"a0afe9904a76e8090fb2f9677d7fa7c402809a6ae9618abd67c0b3c3a1f15e07","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":6,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":3.11,"possession":45,"shots":20,"shots_on_target":11,"big_chances":3,"corners":9,"yellow_cards":0,"red_cards":null,"pass_accuracy":90,"passes_completed":350,"passes_attempted":389},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.73,"possession":55,"shots":15,"shots_on_target":4,"big_chances":3,"corners":7,"yellow_cards":2,"red_cards":null,"pass_accuracy":90,"passes_completed":423,"passes_attempted":470},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Aston Villa FC","source_name":"Aston Villa","slug":"aston-villa-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["astonvilla","astonvillafc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/aston-villa.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Aston%20Villa.png","logo_blob_sha":"f1081b911ae6592533eeb92f0f1cddd661b8e03b","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Aston Villa.png"},"away_club":{"name":"Fenerbahce","source_name":"Fenerbahce","slug":"fenerbahce","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["fenerbahce"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/fenerbahce.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Fenerbahce.png","logo_blob_sha":"028d2942488922fc78ea6e0f336c1400eee198bc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Fenerbahce.png"}},{"id":"CL-33","source_key":"b8d9aa7f5948658939ac56d3b278f9f626b1015caca470bb90163b22591ccc0e","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.12,"possession":48,"shots":11,"shots_on_target":3,"big_chances":3,"corners":4,"yellow_cards":0,"red_cards":null,"pass_accuracy":85,"passes_completed":467,"passes_attempted":549},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.79,"possession":52,"shots":9,"shots_on_target":4,"big_chances":1,"corners":9,"yellow_cards":2,"red_cards":null,"pass_accuracy":86,"passes_completed":504,"passes_attempted":583},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FK BodøGlimt","source_name":"Bodo/Glimt","slug":"fk-bod-glimt","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["bodoglimt","fkbodglimt","bodglimt"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bodo-glimt.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/FK%20Bod%C3%B8Glimt.png","logo_blob_sha":"bfe2c86a333e2556dc5a6dbf7876f63cfa1f517e","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/FK BodøGlimt.png"},"away_club":{"name":"Borussia Dortmund","source_name":"Dortmund","slug":"borussia-dortmund","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["dortmund","borussiadortmund"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/dortmund.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Borussia%20Dortmund.png","logo_blob_sha":"2dc4b0289782930c6b81b40309e81039928225fc","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Borussia Dortmund.png"}},{"id":"CL-34","source_key":"38013c8783869bc4938b8c0d398d394e52aac802c3ba94de510fae65b05e5fb9","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.68,"possession":56,"shots":17,"shots_on_target":7,"big_chances":2,"corners":5,"yellow_cards":4,"red_cards":null,"pass_accuracy":87,"passes_completed":438,"passes_attempted":502},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.96,"possession":44,"shots":11,"shots_on_target":5,"big_chances":3,"corners":1,"yellow_cards":4,"red_cards":null,"pass_accuracy":82,"passes_completed":319,"passes_attempted":391},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"Real Betis Balompié","source_name":"Betis","slug":"real-betis-balompie","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["betis","realbetisbalompie","realbetis"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/betis.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Betis%20Balompi%C3%A9.png","logo_blob_sha":"8e3808a0788aa8f7ae7915265544774c9317518d","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Betis Balompié.png"},"away_club":{"name":"FC Porto","source_name":"FC Porto","slug":"fc-porto","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["fcporto","porto"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/fc-porto.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/FC%20Porto.png","logo_blob_sha":"9cdf906e1870ba57bd97aba929a084f1742f663b","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/FC Porto.png"}},{"id":"CL-35","source_key":"7a51649e8d83a8462f9a899490d86ce5b4377bd438dfe9b64b999fe305f05e51","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T16:45:00.000Z","displayed_date":"2026-10-14T18:45","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":6,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.04,"possession":36,"shots":12,"shots_on_target":4,"big_chances":5,"corners":3,"yellow_cards":1,"red_cards":null,"pass_accuracy":81,"passes_completed":251,"passes_attempted":310},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.25,"possession":64,"shots":26,"shots_on_target":9,"big_chances":5,"corners":11,"yellow_cards":0,"red_cards":null,"pass_accuracy":91,"passes_completed":523,"passes_attempted":575},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"LASK","source_name":"LASK","slug":"lask","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["lask"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lask.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/LASK.png","logo_blob_sha":"44ca0eb54b5f820a6a7f294f3f7230e038bcdc80","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/LASK.png"},"away_club":{"name":"Liverpool FC","source_name":"Liverpool","slug":"liverpool-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["liverpool","liverpoolfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/liverpool.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Liverpool%20FC.png","logo_blob_sha":"654691d267680a6683fe58c55619de0684185404","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Liverpool FC.png"}},{"id":"CL-36","source_key":"92d3d8ac42281273d159feae38c0bd2a295632ec8468b17f4b32b3f029ae44e5","competition":"champions-league","season":"2026-2027","round":"2","kickoff":"2026-10-14T19:00:00.000Z","displayed_date":"2026-10-14T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.41,"possession":54,"shots":14,"shots_on_target":7,"big_chances":3,"corners":5,"yellow_cards":3,"red_cards":null,"pass_accuracy":86,"passes_completed":469,"passes_attempted":546},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.43,"possession":46,"shots":16,"shots_on_target":8,"big_chances":4,"corners":9,"yellow_cards":1,"red_cards":null,"pass_accuracy":83,"passes_completed":385,"passes_attempted":462},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"AS Roma","source_name":"AS Rome","slug":"as-roma","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["asrome","asroma","roma"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/as-rome.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/AS%20Roma.png","logo_blob_sha":"29eb52986c5a31579b6b73ba16ebb6f3d3597554","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/AS Roma.png"},"away_club":{"name":"Real Madrid CF","source_name":"Real Madrid","slug":"real-madrid-cf","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["realmadrid","realmadridcf"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/real-madrid.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Madrid.png","logo_blob_sha":"e713ce0470f9673294c374596889a659b2624dcf","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Madrid.png"}},{"id":"EL-01","source_key":"00289c60b703aebd26d3817a4864367b0a3078de1f7027a042eac6df030cfcf8","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T16:45:00.000Z","displayed_date":"2026-09-16T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.91,"possession":41,"shots":13,"shots_on_target":2,"big_chances":3,"corners":2,"yellow_cards":3,"red_cards":null,"pass_accuracy":83,"passes_completed":295,"passes_attempted":354},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.63,"possession":59,"shots":23,"shots_on_target":8,"big_chances":5,"corners":13,"yellow_cards":0,"red_cards":null,"pass_accuracy":89,"passes_completed":424,"passes_attempted":475},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Numéro de journée proposé par regroupement des dates : à confirmer.","home_club":{"name":"FC Ararat-Armenia","source_name":"Ararat-Armenia","slug":"fc-ararat-armenia","country":"Arménie","domestic_competition":null,"domestic_league":"Première division arménienne","identity_keys":["araratarmenia","fcararatarmenia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ararat-armenia.svg","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/FC_Ararat-Armenia_logo.svg","logo_blob_sha":"81676284a494b149e4d5417e8ec218da8ef27a12","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/FC_Ararat-Armenia_logo.svg"},"away_club":{"name":"AC Sparta Prague","source_name":"Sparta Prague","slug":"ac-sparta-prague","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["spartaprague","acspartaprague","spartapraha"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sparta-prague.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/AC%20Sparta%20Prague.png","logo_blob_sha":"74eeb7b6e8fa0715da0cb1fdc881c20b7f82afea","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/AC Sparta Prague.png"}},{"id":"EL-02","source_key":"9393c60f49e214dbdd58449e821285b44aaa715ca88eddf799597d861de628d8","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T16:45:00.000Z","displayed_date":"2026-09-16T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.3,"possession":46,"shots":10,"shots_on_target":4,"big_chances":0,"corners":3,"yellow_cards":0,"red_cards":null,"pass_accuracy":86,"passes_completed":421,"passes_attempted":487},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.46,"possession":54,"shots":19,"shots_on_target":5,"big_chances":1,"corners":11,"yellow_cards":1,"red_cards":null,"pass_accuracy":92,"passes_completed":505,"passes_attempted":551},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"AC Omonia","source_name":"Omonia","slug":"ac-omonia","country":"Chypre","domestic_competition":null,"domestic_league":"Première division chypriote","identity_keys":["omonia","acomonia","omonianicosia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/omonia.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/250px-AC_Omonia_logo.svg.png","logo_blob_sha":"631b911e0f9ff6e6615a8ed055e5b31cf5b7c863","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/250px-AC_Omonia_logo.svg.png"},"away_club":{"name":"RC Celta de Vigo","source_name":"Celta Vigo","slug":"rc-celta-de-vigo","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["celtavigo","rcceltadevigo","celtadevigo"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celta-vigo.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Celta%20de%20Vigo.png","logo_blob_sha":"323bf79463695cde7b996fa4dd3cefa6c0ba1dd0","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Celta de Vigo.png"}},{"id":"EL-03","source_key":"aa82fcd8161e09cdc2b0df3c9390ebb2fc6e7ecafa35660a54ccaf2e21b2dbf6","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.73,"possession":38,"shots":11,"shots_on_target":4,"big_chances":0,"corners":5,"yellow_cards":2,"red_cards":null,"pass_accuracy":65,"passes_completed":186,"passes_attempted":286},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.75,"possession":62,"shots":23,"shots_on_target":5,"big_chances":2,"corners":4,"yellow_cards":0,"red_cards":null,"pass_accuracy":83,"passes_completed":385,"passes_attempted":465},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"SK Sturm Graz","source_name":"Sturm Graz","slug":"sk-sturm-graz","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["sturmgraz","sksturmgraz"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sturm-graz.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/SK%20Sturm%20Graz.png","logo_blob_sha":"e1cac8a3d9045d1953df624b247019c4a6080f0f","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/SK Sturm Graz.png"},"away_club":{"name":"Stade Rennais FC 1901","source_name":"Rennes","slug":"rennes","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["rennes","staderennaisfc1901","staderennaisfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/rennes.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Stade%20Rennais%20FC.png","logo_blob_sha":"8d8f6dc72967d38b80ae257380e0cf13fd270028","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Stade Rennais FC.png"}},{"id":"EL-04","source_key":"39459d79384cbdfe23c7dad9e6f235bc7d47c6cc8c0395e5d614d3d9380f1b1b","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.04,"possession":50,"shots":11,"shots_on_target":4,"big_chances":4,"corners":5,"yellow_cards":1,"red_cards":null,"pass_accuracy":87,"passes_completed":425,"passes_attempted":491},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.56,"possession":50,"shots":12,"shots_on_target":4,"big_chances":4,"corners":3,"yellow_cards":3,"red_cards":null,"pass_accuracy":85,"passes_completed":416,"passes_attempted":488},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Olympique Lyonnais","source_name":"Lyon","slug":"lyon","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lyon","olympiquelyonnais","olympiquelyon","ol"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lyon.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Olympique%20Lyon.png","logo_blob_sha":"7390f0bd833cb2a7072cae62a1fe2f59276682a6","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Olympique Lyon.png"},"away_club":{"name":"Crystal Palace FC","source_name":"Crystal Palace","slug":"crystal-palace-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["crystalpalace","crystalpalacefc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/crystal-palace.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Crystal%20Palace.png","logo_blob_sha":"2653b2a05078e9d0c21a26a449e0ff469e67f5b1","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Crystal Palace.png"}},{"id":"EL-05","source_key":"0a23b33dd2e5e804162dfa785dfd98e8bf5bc580298b915f2b2962a4cdc4b0e1","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.89,"possession":58,"shots":26,"shots_on_target":6,"big_chances":7,"corners":13,"yellow_cards":2,"red_cards":null,"pass_accuracy":83,"passes_completed":383,"passes_attempted":462},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.48,"possession":42,"shots":4,"shots_on_target":3,"big_chances":1,"corners":0,"yellow_cards":3,"red_cards":null,"pass_accuracy":76,"passes_completed":263,"passes_attempted":346},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Olympiacos Piraeus","source_name":"Olympiakos","slug":"olympiacos-piraeus","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["olympiakos","olympiacospiraeus","olympiacos"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/olympiakos.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/Olympiacos%20Piraeus.png","logo_blob_sha":"8db40026e792ce1610ef2565ac5c6725ae1fbb39","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/Olympiacos Piraeus.png"},"away_club":{"name":"Jagiellonia Bialystok","source_name":"Jagiellonia","slug":"jagiellonia-bialystok","country":"Pologne","domestic_competition":null,"domestic_league":"Ekstraklasa","identity_keys":["jagiellonia","jagielloniabialystok"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/jagiellonia.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Poland%20-%20PKO%20BP%20Ekstraklasa/Jagiellonia%20Bialystok.png","logo_blob_sha":"618cff2f06846e0e7beb564167eb7e3f957a1222","logo_repository":"luukhopman/football-logos","logo_path":"logos/Poland - PKO BP Ekstraklasa/Jagiellonia Bialystok.png"}},{"id":"EL-06","source_key":"6a20a32f6d2fe092fad4ce3cce6b8e681e196e023a3eabc22dab981ea357f4d3","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.96,"possession":45,"shots":20,"shots_on_target":5,"big_chances":3,"corners":12,"yellow_cards":3,"red_cards":null,"pass_accuracy":78,"passes_completed":300,"passes_attempted":383},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.32,"possession":55,"shots":11,"shots_on_target":2,"big_chances":3,"corners":5,"yellow_cards":2,"red_cards":null,"pass_accuracy":82,"passes_completed":404,"passes_attempted":495},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Sunderland AFC","source_name":"Sunderland","slug":"sunderland-afc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["sunderland","sunderlandafc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sunderland.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Sunderland%20AFC.png","logo_blob_sha":"af221f2cd30474564b0b4c9690e397fc1aaf03e9","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Sunderland AFC.png"},"away_club":{"name":"AZ Alkmaar","source_name":"Alkmaar","slug":"az-alkmaar","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["alkmaar","azalkmaar","az"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/alkmaar.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/AZ%20Alkmaar.png","logo_blob_sha":"81a59c1bee5c84ad56677a49df03f8fc9343e135","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/AZ Alkmaar.png"}},{"id":"EL-07","source_key":"2f693f84c20c1cac525db70376117d88fccd576186db8e0e8430a555e6e326a9","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.82,"possession":58,"shots":14,"shots_on_target":5,"big_chances":5,"corners":6,"yellow_cards":0,"red_cards":null,"pass_accuracy":84,"passes_completed":395,"passes_attempted":473},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.2,"possession":42,"shots":13,"shots_on_target":10,"big_chances":2,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":78,"passes_completed":273,"passes_attempted":349},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"RSC Anderlecht","source_name":"Anderlecht","slug":"rsc-anderlecht","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["anderlecht","rscanderlecht"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/anderlecht.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/RSC%20Anderlecht.png","logo_blob_sha":"ab618379b511cd81ce1058716c8ac95b404d3422","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/RSC Anderlecht.png"},"away_club":{"name":"Olympique Lyonnais","source_name":"Lyon","slug":"lyon","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["lyon","olympiquelyonnais","olympiquelyon","ol"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lyon.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Olympique%20Lyon.png","logo_blob_sha":"7390f0bd833cb2a7072cae62a1fe2f59276682a6","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Olympique Lyon.png"}},{"id":"EL-08","source_key":"1495b667bc9098fb4dc266ce3b56673bae8b4bcdfbcce0f7ccb9c1198dc4aa71","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.4,"possession":56,"shots":17,"shots_on_target":8,"big_chances":5,"corners":6,"yellow_cards":null,"red_cards":null,"pass_accuracy":88,"passes_completed":545,"passes_attempted":621},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.89,"possession":44,"shots":5,"shots_on_target":3,"big_chances":3,"corners":2,"yellow_cards":null,"red_cards":null,"pass_accuracy":88,"passes_completed":440,"passes_attempted":499},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Bayer 04 Leverkusen","source_name":"Bayer Leverkusen","slug":"bayer-04-leverkusen","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["bayerleverkusen","bayer04leverkusen","leverkusen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bayer-leverkusen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Bayer%2004%20Leverkusen.png","logo_blob_sha":"22cef703c4bb657a60d874d4b62f0a6b35ce3e93","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Bayer 04 Leverkusen.png"},"away_club":{"name":"NK Celje","source_name":"Celje","slug":"nk-celje","country":"Slovénie","domestic_competition":null,"domestic_league":"PrvaLiga","identity_keys":["celje","nkcelje"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celje.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/NK_Celje.png","logo_blob_sha":"300627b2a0a23546ecade6f6ae34661fd8acbfdc","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/NK_Celje.png"}},{"id":"EL-09","source_key":"32b067bc8ec5a8bea2b09e4896bf510cd8fc7ba18938bc7cdf073576035bbd12","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.03,"possession":61,"shots":17,"shots_on_target":4,"big_chances":0,"corners":10,"yellow_cards":1,"red_cards":null,"pass_accuracy":91,"passes_completed":521,"passes_attempted":570},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.63,"possession":39,"shots":11,"shots_on_target":4,"big_chances":1,"corners":1,"yellow_cards":5,"red_cards":null,"pass_accuracy":85,"passes_completed":324,"passes_attempted":381},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"AC Milan","source_name":"AC Milan","slug":"ac-milan","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["acmilan"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ac-milan.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/AC%20Milan.png","logo_blob_sha":"e6209230efa5637278c47ba989f57c60e7fc0b66","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/AC Milan.png"},"away_club":{"name":"Sport Lisboa e Benfica","source_name":"Benfica","slug":"sl-benfica","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["benfica","sportlisboaebenfica","slbenfica"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/benfica.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/SL%20Benfica.png","logo_blob_sha":"8b41b56ef8737217701fdb29b1bdae07b111a4a7","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/SL Benfica.png"}},{"id":"EL-10","source_key":"c217258ba011d31928fe3e02f51b346bb29237d6f60b1428407cd1d1c846ab9b","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T16:45:00.000Z","displayed_date":"2026-09-17T18:45","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.93,"possession":50,"shots":14,"shots_on_target":0,"big_chances":2,"corners":5,"yellow_cards":1,"red_cards":null,"pass_accuracy":86,"passes_completed":401,"passes_attempted":464},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.59,"possession":50,"shots":12,"shots_on_target":7,"big_chances":4,"corners":4,"yellow_cards":5,"red_cards":null,"pass_accuracy":86,"passes_completed":405,"passes_attempted":471},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Levski Sofia","source_name":"Levski","slug":"levski-sofia","country":"Bulgarie","domestic_competition":null,"domestic_league":"Première division bulgare","identity_keys":["levski","levskisofia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/levski.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Bulgaria%20-%20efbet%20Liga/Levski%20Sofia.png","logo_blob_sha":"84ba744ff0e13e50fa635950a7a2c7ab6c7b9ca9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Bulgaria - efbet Liga/Levski Sofia.png"},"away_club":{"name":"Red Bull Salzburg","source_name":"Red Bull Salzbourg","slug":"red-bull-salzburg","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["redbullsalzbourg","redbullsalzburg","rbsalzburg"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/red-bull-salzbourg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/Red%20Bull%20Salzburg.png","logo_blob_sha":"31e95f49ed5da7a789c454a9c3aaef3928ef9b06","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/Red Bull Salzburg.png"}},{"id":"EL-11","source_key":"b8f4216aed484a436039814fc4c323c929f089ae511aa2dbac45edb0b485f228","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T16:45:00.000Z","displayed_date":"2026-09-17T18:45","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.42,"possession":33,"shots":9,"shots_on_target":3,"big_chances":3,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":64,"passes_completed":166,"passes_attempted":260},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.73,"possession":67,"shots":21,"shots_on_target":5,"big_chances":2,"corners":8,"yellow_cards":3,"red_cards":null,"pass_accuracy":86,"passes_completed":450,"passes_attempted":526},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"OFI Crete","source_name":"OFI Crète","slug":"ofi-crete","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["oficrete"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ofi-crete.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/OFI%20Crete.png","logo_blob_sha":"0a7e49ae0529aa01618f309d57665dad85f71c97","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/OFI Crete.png"},"away_club":{"name":"TSG 1899 Hoffenheim","source_name":"Hoffenheim","slug":"tsg-1899-hoffenheim","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["hoffenheim","tsg1899hoffenheim","tsghoffenheim"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/hoffenheim.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/TSG%201899%20Hoffenheim.png","logo_blob_sha":"dc5fe98029eededad6268a654625eff99a8a364d","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/TSG 1899 Hoffenheim.png"}},{"id":"EL-12","source_key":"a2aa42a1a2664990d538937b1c7120d7f17649ebc5c7bfe9b45e29c8d1e2dbad","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":4,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.93,"possession":55,"shots":18,"shots_on_target":7,"big_chances":3,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":87,"passes_completed":493,"passes_attempted":564},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.26,"possession":45,"shots":14,"shots_on_target":3,"big_chances":1,"corners":3,"yellow_cards":1,"red_cards":null,"pass_accuracy":86,"passes_completed":395,"passes_attempted":458},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Besiktas JK","source_name":"Besiktas","slug":"besiktas-jk","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["besiktas","besiktasjk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/besiktas.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Besiktas%20JK.png","logo_blob_sha":"114a7809a45417c149bc70376014475d677fcca8","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Besiktas JK.png"},"away_club":{"name":"Olympique de Marseille","source_name":"Marseille","slug":"olympique-de-marseille","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["marseille","olympiquedemarseille","olympiquemarseille","om"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/marseille.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Olympique%20Marseille.png","logo_blob_sha":"499c1c14e743ccda34191faa42c536b5f89228fb","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Olympique Marseille.png"}},{"id":"EL-13","source_key":"fb0fd599dabf45961aded90d9bc6764fdc1d99295b7fc09bea842792669295b1","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.39,"possession":62,"shots":16,"shots_on_target":5,"big_chances":3,"corners":10,"yellow_cards":3,"red_cards":null,"pass_accuracy":84,"passes_completed":493,"passes_attempted":587},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.74,"possession":38,"shots":11,"shots_on_target":3,"big_chances":3,"corners":3,"yellow_cards":3,"red_cards":null,"pass_accuracy":76,"passes_completed":282,"passes_attempted":370},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Real Sociedad de Fútbol","source_name":"Real Sociedad","slug":"real-sociedad-de-futbol","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["realsociedad","realsociedaddefutbol"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/real-sociedad.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Sociedad.png","logo_blob_sha":"b1d8bcdf54803231b466a3b698549eecd55270d2","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Sociedad.png"},"away_club":{"name":"AFC Bournemouth","source_name":"Bournemouth","slug":"afc-bournemouth","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["bournemouth","afcbournemouth"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bournemouth.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/AFC%20Bournemouth.png","logo_blob_sha":"14810679717c6be956912126c4ab8bd6341971c4","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/AFC Bournemouth.png"}},{"id":"EL-14","source_key":"605b585c31eeef2826e0571273e68ee6c9bd9c0adb25b97e4cbe00484ad60f90","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-16T19:00:00.000Z","displayed_date":"2026-09-16T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.96,"possession":66,"shots":15,"shots_on_target":2,"big_chances":1,"corners":6,"yellow_cards":null,"red_cards":null,"pass_accuracy":89,"passes_completed":620,"passes_attempted":697},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.3,"possession":34,"shots":7,"shots_on_target":1,"big_chances":0,"corners":2,"yellow_cards":null,"red_cards":null,"pass_accuracy":75,"passes_completed":263,"passes_attempted":351},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Hapoel Beer Sheva","source_name":"H. Beer Sheva","slug":"hapoel-beer-sheva","country":"Israël","domestic_competition":null,"domestic_league":"Première division israélienne","identity_keys":["hbeersheva","hapoelbeersheva"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/h-beer-sheva.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Israel%20-%20Ligat%20ha%27Al/Hapoel%20Beer%20Sheva.png","logo_blob_sha":"52c936838b0f957d3af34dbbfa5bf0a40f1eda72","logo_repository":"luukhopman/football-logos","logo_path":"logos/Israel - Ligat ha'Al/Hapoel Beer Sheva.png"},"away_club":{"name":"GNK Dinamo Zagreb","source_name":"Din. Zagreb","slug":"gnk-dinamo-zagreb","country":"Croatie","domestic_competition":null,"domestic_league":"Première division croate","identity_keys":["dinzagreb","gnkdinamozagreb","dinamozagreb"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/din-zagreb.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Croatia%20-%20SuperSport%20HNL/GNK%20Dinamo%20Zagreb.png","logo_blob_sha":"00540ee78b21d953553d06d16e5adc1f8003e494","logo_repository":"luukhopman/football-logos","logo_path":"logos/Croatia - SuperSport HNL/GNK Dinamo Zagreb.png"}},{"id":"EL-15","source_key":"be844942a4a112bb3d3c4c47aad3ba9112d9d2e15141c61fcdf8f983665404f4","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":4,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.23,"possession":53,"shots":16,"shots_on_target":6,"big_chances":3,"corners":6,"yellow_cards":0,"red_cards":0,"pass_accuracy":88,"passes_completed":478,"passes_attempted":544},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.54,"possession":47,"shots":17,"shots_on_target":6,"big_chances":4,"corners":5,"yellow_cards":2,"red_cards":1,"pass_accuracy":84,"passes_completed":410,"passes_attempted":488},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Crystal Palace FC","source_name":"Crystal Palace","slug":"crystal-palace-fc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["crystalpalace","crystalpalacefc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/crystal-palace.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Crystal%20Palace.png","logo_blob_sha":"2653b2a05078e9d0c21a26a449e0ff469e67f5b1","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Crystal Palace.png"},"away_club":{"name":"Lech Poznan","source_name":"Lech","slug":"lech-poznan","country":"Pologne","domestic_competition":null,"domestic_league":"Ekstraklasa","identity_keys":["lech","lechpoznan"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lech.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Poland%20-%20PKO%20BP%20Ekstraklasa/Lech%20Poznan.png","logo_blob_sha":"2bcab10ccd6ac974db36ffe0ce30516d4c20cec9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Poland - PKO BP Ekstraklasa/Lech Poznan.png"}},{"id":"EL-16","source_key":"4f1690652a19d58e0d98f2a20a8677979cafe1e2ea9d4900cd06bb2c3b25f434","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.06,"possession":49,"shots":14,"shots_on_target":5,"big_chances":2,"corners":5,"yellow_cards":2,"red_cards":null,"pass_accuracy":79,"passes_completed":374,"passes_attempted":476},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.3,"possession":51,"shots":22,"shots_on_target":13,"big_chances":7,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":85,"passes_completed":446,"passes_attempted":525},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"FC Viktoria Plzen","source_name":"Plzen","slug":"fc-viktoria-plzen","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["plzen","fcviktoriaplzen","viktoriaplzen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/plzen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/FC%20Viktoria%20Plzen.png","logo_blob_sha":"e5da09b87feac80e5da28e73d59b795361991d62","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/FC Viktoria Plzen.png"},"away_club":{"name":"Union Saint-Gilloise","source_name":"Royale Union SG","slug":"union-saint-gilloise","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["royaleunionsg","unionsaintgilloise"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/royale-union-sg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/Union%20Saint-Gilloise.png","logo_blob_sha":"b0ad43b8b7d116319ded137e1f6d64b64a8c5388","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/Union Saint-Gilloise.png"}},{"id":"EL-17","source_key":"ace8756cd3ec51e1d6f0117c8e7fdcd6c37ca40dd2dcd707d84131d30f48da56","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.31,"possession":63,"shots":16,"shots_on_target":4,"big_chances":4,"corners":11,"yellow_cards":0,"red_cards":null,"pass_accuracy":89,"passes_completed":533,"passes_attempted":596},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.15,"possession":37,"shots":14,"shots_on_target":6,"big_chances":1,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":80,"passes_completed":290,"passes_attempted":361},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Celtic FC","source_name":"Celtic","slug":"celtic-fc","country":"Écosse","domestic_competition":null,"domestic_league":"Scottish Premiership","identity_keys":["celtic","celticfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celtic.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Scotland%20-%20Scottish%20Premiership/Celtic%20FC.png","logo_blob_sha":"ef0cadb69e70e950482a58dc230061295f27f20b","logo_repository":"luukhopman/football-logos","logo_path":"logos/Scotland - Scottish Premiership/Celtic FC.png"},"away_club":{"name":"Ferencvárosi TC","source_name":"Ferencvaros","slug":"ferencvarosi-tc","country":"Hongrie","domestic_competition":null,"domestic_league":"Première division hongroise","identity_keys":["ferencvaros","ferencvarositc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ferencvaros.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/960px-Ferencvarosi_TC.svg.png","logo_blob_sha":"fa04410797b88f88d5c2651644de76c1eed13cd2","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/960px-Ferencvarosi_TC.svg.png"}},{"id":"EL-18","source_key":"994d092493f84cb871c013362cb5937f198502b413b4aced762825230b190071","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":5,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":4.2,"possession":48,"shots":11,"shots_on_target":7,"big_chances":5,"corners":0,"yellow_cards":1,"red_cards":null,"pass_accuracy":89,"passes_completed":446,"passes_attempted":499},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.82,"possession":52,"shots":11,"shots_on_target":3,"big_chances":0,"corners":1,"yellow_cards":1,"red_cards":null,"pass_accuracy":90,"passes_completed":495,"passes_attempted":550},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Juventus FC","source_name":"Juventus","slug":"juventus-fc","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["juventus","juventusfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/juventus.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Juventus%20FC.png","logo_blob_sha":"89d23971e016e5ffc61c6bf86d0b2c1bce887b4a","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Juventus FC.png"},"away_club":{"name":"NEC Nijmegen","source_name":"Nijmegen","slug":"nec-nijmegen","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["nijmegen","necnijmegen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/nijmegen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/NEC%20Nijmegen.png","logo_blob_sha":"095802d08b20c08447839ff9ad6183205bb152c9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/NEC Nijmegen.png"}},{"id":"EL-19","source_key":"d38bec8f9cd195febbb0c55938fae7d6326698227ee01af8e752fa38bc4e18cb","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.04,"possession":39,"shots":3,"shots_on_target":1,"big_chances":0,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":72,"passes_completed":213,"passes_attempted":294},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.8,"possession":61,"shots":22,"shots_on_target":5,"big_chances":4,"corners":9,"yellow_cards":3,"red_cards":null,"pass_accuracy":85,"passes_completed":363,"passes_attempted":427},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Championnat d’origine de Torreense : à renseigner avant création du club.","home_club":{"name":"SC União Torreense","source_name":"Torreense","slug":"sc-uniao-torreense","country":"Portugal","domestic_competition":null,"domestic_league":null,"identity_keys":["torreense","scuniaotorreense"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/torreense.svg","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/S.C.U._Torreense_logo.svg","logo_blob_sha":"6651b462a16e1db8e20739fc66647b544b6e88b2","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/S.C.U._Torreense_logo.svg"},"away_club":{"name":"Sunderland AFC","source_name":"Sunderland","slug":"sunderland-afc","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["sunderland","sunderlandafc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sunderland.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/Sunderland%20AFC.png","logo_blob_sha":"af221f2cd30474564b0b4c9690e397fc1aaf03e9","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/Sunderland AFC.png"}},{"id":"EL-20","source_key":"9b63c546c32f1b12df87171b6d6e05bab7d08bf58670de6311f5a7df9030f9a7","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.04,"possession":52,"shots":15,"shots_on_target":8,"big_chances":2,"corners":6,"yellow_cards":3,"red_cards":null,"pass_accuracy":84,"passes_completed":343,"passes_attempted":409},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.78,"possession":48,"shots":6,"shots_on_target":2,"big_chances":1,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":77,"passes_completed":303,"passes_attempted":391},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"AC Sparta Prague","source_name":"Sparta Prague","slug":"ac-sparta-prague","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["spartaprague","acspartaprague","spartapraha"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sparta-prague.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/AC%20Sparta%20Prague.png","logo_blob_sha":"74eeb7b6e8fa0715da0cb1fdc881c20b7f82afea","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/AC Sparta Prague.png"},"away_club":{"name":"Lillestrøm SK","source_name":"Lillestrom","slug":"lillestr-m-sk","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["lillestrom","lillestrmsk","lillestrm"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lillestrom.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/Lillestr%C3%B8m%20SK.png","logo_blob_sha":"00be5ee373417bac89bb7242e1a66ccd9ab6ab14","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/Lillestrøm SK.png"}},{"id":"EL-21","source_key":"110c0ad9c4b191444092672f3a42e5c62ccb1d8b9dfd8dd776b4e3b98aebf8a1","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.84,"possession":44,"shots":16,"shots_on_target":5,"big_chances":1,"corners":4,"yellow_cards":2,"red_cards":null,"pass_accuracy":79,"passes_completed":340,"passes_attempted":429},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.7,"possession":56,"shots":6,"shots_on_target":1,"big_chances":2,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":83,"passes_completed":455,"passes_attempted":550},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Union Saint-Gilloise","source_name":"Royale Union SG","slug":"union-saint-gilloise","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["royaleunionsg","unionsaintgilloise"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/royale-union-sg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/Union%20Saint-Gilloise.png","logo_blob_sha":"b0ad43b8b7d116319ded137e1f6d64b64a8c5388","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/Union Saint-Gilloise.png"},"away_club":{"name":"Real Sociedad de Fútbol","source_name":"Real Sociedad","slug":"real-sociedad-de-futbol","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["realsociedad","realsociedaddefutbol"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/real-sociedad.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Real%20Sociedad.png","logo_blob_sha":"b1d8bcdf54803231b466a3b698549eecd55270d2","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Real Sociedad.png"}},{"id":"EL-22","source_key":"0905f895dbfcfed09fbfa2ba58963845f8ecb9effbb59c5d3ef173fab06a675b","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.71,"possession":59,"shots":15,"shots_on_target":7,"big_chances":4,"corners":5,"yellow_cards":4,"red_cards":null,"pass_accuracy":85,"passes_completed":499,"passes_attempted":589},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.07,"possession":41,"shots":6,"shots_on_target":4,"big_chances":1,"corners":1,"yellow_cards":4,"red_cards":null,"pass_accuracy":78,"passes_completed":311,"passes_attempted":401},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"AZ Alkmaar","source_name":"Alkmaar","slug":"az-alkmaar","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["alkmaar","azalkmaar","az"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/alkmaar.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/AZ%20Alkmaar.png","logo_blob_sha":"81a59c1bee5c84ad56677a49df03f8fc9343e135","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/AZ Alkmaar.png"},"away_club":{"name":"Hapoel Beer Sheva","source_name":"H. Beer Sheva","slug":"hapoel-beer-sheva","country":"Israël","domestic_competition":null,"domestic_league":"Première division israélienne","identity_keys":["hbeersheva","hapoelbeersheva"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/h-beer-sheva.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Israel%20-%20Ligat%20ha%27Al/Hapoel%20Beer%20Sheva.png","logo_blob_sha":"52c936838b0f957d3af34dbbfa5bf0a40f1eda72","logo_repository":"luukhopman/football-logos","logo_path":"logos/Israel - Ligat ha'Al/Hapoel Beer Sheva.png"}},{"id":"EL-23","source_key":"d0fffa65d889be242f24ffefd9d34ab2c7eeecb3d7e30d743ce070603a897b26","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.89,"possession":61,"shots":12,"shots_on_target":2,"big_chances":1,"corners":3,"yellow_cards":4,"red_cards":null,"pass_accuracy":89,"passes_completed":594,"passes_attempted":668},"away_stats":{"woodwork":null,"team_rating":null,"xg":2.06,"possession":39,"shots":14,"shots_on_target":6,"big_chances":5,"corners":5,"yellow_cards":2,"red_cards":null,"pass_accuracy":82,"passes_completed":351,"passes_attempted":427},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"NK Celje","source_name":"Celje","slug":"nk-celje","country":"Slovénie","domestic_competition":null,"domestic_league":"PrvaLiga","identity_keys":["celje","nkcelje"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celje.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/NK_Celje.png","logo_blob_sha":"300627b2a0a23546ecade6f6ae34661fd8acbfdc","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/NK_Celje.png"},"away_club":{"name":"AC Omonia","source_name":"Omonia","slug":"ac-omonia","country":"Chypre","domestic_competition":null,"domestic_league":"Première division chypriote","identity_keys":["omonia","acomonia","omonianicosia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/omonia.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/250px-AC_Omonia_logo.svg.png","logo_blob_sha":"631b911e0f9ff6e6615a8ed055e5b31cf5b7c863","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/250px-AC_Omonia_logo.svg.png"}},{"id":"EL-24","source_key":"2cc88e3c374b2ac64791de1496a2f265aa7032fabd51b6e0e86a98b610fe1fbd","competition":"europa-league","season":"2026-2027","round":"1","kickoff":"2026-09-17T19:00:00.000Z","displayed_date":"2026-09-17T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.58,"possession":67,"shots":25,"shots_on_target":6,"big_chances":3,"corners":11,"yellow_cards":1,"red_cards":null,"pass_accuracy":87,"passes_completed":486,"passes_attempted":559},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.52,"possession":33,"shots":11,"shots_on_target":3,"big_chances":3,"corners":2,"yellow_cards":5,"red_cards":null,"pass_accuracy":75,"passes_completed":211,"passes_attempted":281},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer. Championnat d’origine de Torreense : à renseigner avant création du club.","home_club":{"name":"Lillestrøm SK","source_name":"Lillestrom","slug":"lillestr-m-sk","country":"Norvège","domestic_competition":null,"domestic_league":"Eliteserien","identity_keys":["lillestrom","lillestrmsk","lillestrm"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lillestrom.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Norway%20-%20Eliteserien/Lillestr%C3%B8m%20SK.png","logo_blob_sha":"00be5ee373417bac89bb7242e1a66ccd9ab6ab14","logo_repository":"luukhopman/football-logos","logo_path":"logos/Norway - Eliteserien/Lillestrøm SK.png"},"away_club":{"name":"SC União Torreense","source_name":"Torreense","slug":"sc-uniao-torreense","country":"Portugal","domestic_competition":null,"domestic_league":null,"identity_keys":["torreense","scuniaotorreense"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/torreense.svg","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/S.C.U._Torreense_logo.svg","logo_blob_sha":"6651b462a16e1db8e20739fc66647b544b6e88b2","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/S.C.U._Torreense_logo.svg"}},{"id":"EL-25","source_key":"357a1a05acb1c16b4d781b71d210c393d8be741aa0da0004f7b05bbbd5f5329a","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.49,"possession":39,"shots":10,"shots_on_target":3,"big_chances":0,"corners":4,"yellow_cards":1,"red_cards":null,"pass_accuracy":80,"passes_completed":295,"passes_attempted":370},"away_stats":{"woodwork":null,"team_rating":null,"xg":5.16,"possession":61,"shots":22,"shots_on_target":10,"big_chances":8,"corners":5,"yellow_cards":2,"red_cards":null,"pass_accuracy":91,"passes_completed":534,"passes_attempted":584},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Lech Poznan","source_name":"Lech","slug":"lech-poznan","country":"Pologne","domestic_competition":null,"domestic_league":"Ekstraklasa","identity_keys":["lech","lechpoznan"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/lech.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Poland%20-%20PKO%20BP%20Ekstraklasa/Lech%20Poznan.png","logo_blob_sha":"2bcab10ccd6ac974db36ffe0ce30516d4c20cec9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Poland - PKO BP Ekstraklasa/Lech Poznan.png"},"away_club":{"name":"Bayer 04 Leverkusen","source_name":"Bayer Leverkusen","slug":"bayer-04-leverkusen","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["bayerleverkusen","bayer04leverkusen","leverkusen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bayer-leverkusen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/Bayer%2004%20Leverkusen.png","logo_blob_sha":"22cef703c4bb657a60d874d4b62f0a6b35ce3e93","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/Bayer 04 Leverkusen.png"}},{"id":"EL-26","source_key":"f3b0f9943c815e9bddb576ad094dcae8c4fea58d2c8966a341ef63a492b4f0f8","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.82,"possession":56,"shots":11,"shots_on_target":5,"big_chances":2,"corners":9,"yellow_cards":2,"red_cards":null,"pass_accuracy":86,"passes_completed":458,"passes_attempted":532},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.57,"possession":44,"shots":9,"shots_on_target":4,"big_chances":1,"corners":1,"yellow_cards":2,"red_cards":null,"pass_accuracy":82,"passes_completed":348,"passes_attempted":426},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Olympique de Marseille","source_name":"Marseille","slug":"olympique-de-marseille","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["marseille","olympiquedemarseille","olympiquemarseille","om"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/marseille.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Olympique%20Marseille.png","logo_blob_sha":"499c1c14e743ccda34191faa42c536b5f89228fb","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Olympique Marseille.png"},"away_club":{"name":"Olympiacos Piraeus","source_name":"Olympiakos","slug":"olympiacos-piraeus","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["olympiakos","olympiacospiraeus","olympiacos"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/olympiakos.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/Olympiacos%20Piraeus.png","logo_blob_sha":"8db40026e792ce1610ef2565ac5c6725ae1fbb39","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/Olympiacos Piraeus.png"}},{"id":"EL-27","source_key":"746fa3110add6300f039a25693377a1b94ec12ccb4c93475d59fcc78c3083873","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":4,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":3.18,"possession":53,"shots":26,"shots_on_target":7,"big_chances":4,"corners":8,"yellow_cards":3,"red_cards":null,"pass_accuracy":91,"passes_completed":526,"passes_attempted":576},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.36,"possession":47,"shots":14,"shots_on_target":7,"big_chances":2,"corners":6,"yellow_cards":0,"red_cards":null,"pass_accuracy":89,"passes_completed":455,"passes_attempted":509},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Sport Lisboa e Benfica","source_name":"Benfica","slug":"sl-benfica","country":"Portugal","domestic_competition":"liga-portugal","domestic_league":"Liga Portugal","identity_keys":["benfica","sportlisboaebenfica","slbenfica"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/benfica.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Portugal%20-%20Liga%20Portugal/SL%20Benfica.png","logo_blob_sha":"8b41b56ef8737217701fdb29b1bdae07b111a4a7","logo_repository":"luukhopman/football-logos","logo_path":"logos/Portugal - Liga Portugal/SL Benfica.png"},"away_club":{"name":"Celtic FC","source_name":"Celtic","slug":"celtic-fc","country":"Écosse","domestic_competition":null,"domestic_league":"Scottish Premiership","identity_keys":["celtic","celticfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celtic.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Scotland%20-%20Scottish%20Premiership/Celtic%20FC.png","logo_blob_sha":"ef0cadb69e70e950482a58dc230061295f27f20b","logo_repository":"luukhopman/football-logos","logo_path":"logos/Scotland - Scottish Premiership/Celtic FC.png"}},{"id":"EL-28","source_key":"8608f26b13156b694a38bb68d2398d7689079f66c69fe741da044503ec0dfda5","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.02,"possession":43,"shots":13,"shots_on_target":5,"big_chances":3,"corners":2,"yellow_cards":3,"red_cards":null,"pass_accuracy":85,"passes_completed":328,"passes_attempted":388},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.96,"possession":57,"shots":15,"shots_on_target":4,"big_chances":1,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":89,"passes_completed":465,"passes_attempted":524},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Jagiellonia Bialystok","source_name":"Jagiellonia","slug":"jagiellonia-bialystok","country":"Pologne","domestic_competition":null,"domestic_league":"Ekstraklasa","identity_keys":["jagiellonia","jagielloniabialystok"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/jagiellonia.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Poland%20-%20PKO%20BP%20Ekstraklasa/Jagiellonia%20Bialystok.png","logo_blob_sha":"618cff2f06846e0e7beb564167eb7e3f957a1222","logo_repository":"luukhopman/football-logos","logo_path":"logos/Poland - PKO BP Ekstraklasa/Jagiellonia Bialystok.png"},"away_club":{"name":"FC Ararat-Armenia","source_name":"Ararat-Armenia","slug":"fc-ararat-armenia","country":"Arménie","domestic_competition":null,"domestic_league":"Première division arménienne","identity_keys":["araratarmenia","fcararatarmenia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ararat-armenia.svg","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/FC_Ararat-Armenia_logo.svg","logo_blob_sha":"81676284a494b149e4d5417e8ec218da8ef27a12","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/FC_Ararat-Armenia_logo.svg"}},{"id":"EL-29","source_key":"e616e6c766f03bef4b222b0e25fe3548581f39a0ef321d79c2d2c0a7ab115c9d","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.46,"possession":67,"shots":25,"shots_on_target":9,"big_chances":2,"corners":13,"yellow_cards":3,"red_cards":null,"pass_accuracy":89,"passes_completed":476,"passes_attempted":536},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.06,"possession":33,"shots":2,"shots_on_target":1,"big_chances":0,"corners":3,"yellow_cards":2,"red_cards":null,"pass_accuracy":68,"passes_completed":179,"passes_attempted":263},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Stade Rennais FC 1901","source_name":"Rennes","slug":"rennes","country":"France","domestic_competition":"ligue-1","domestic_league":"Ligue 1","identity_keys":["rennes","staderennaisfc1901","staderennaisfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/rennes.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/France%20-%20Ligue%201/Stade%20Rennais%20FC.png","logo_blob_sha":"8d8f6dc72967d38b80ae257380e0cf13fd270028","logo_repository":"luukhopman/football-logos","logo_path":"logos/France - Ligue 1/Stade Rennais FC.png"},"away_club":{"name":"OFI Crete","source_name":"OFI Crète","slug":"ofi-crete","country":"Grèce","domestic_competition":null,"domestic_league":"Super League","identity_keys":["oficrete"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ofi-crete.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Greece%20-%20Super%20League%201/OFI%20Crete.png","logo_blob_sha":"0a7e49ae0529aa01618f309d57665dad85f71c97","logo_repository":"luukhopman/football-logos","logo_path":"logos/Greece - Super League 1/OFI Crete.png"}},{"id":"EL-30","source_key":"16bf796e3427c3bdbc6a0d426df57e50979cc32cabed535cf120ba4523786ddf","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.98,"possession":51,"shots":18,"shots_on_target":9,"big_chances":5,"corners":6,"yellow_cards":1,"red_cards":null,"pass_accuracy":81,"passes_completed":355,"passes_attempted":440},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.33,"possession":49,"shots":8,"shots_on_target":2,"big_chances":4,"corners":1,"yellow_cards":0,"red_cards":null,"pass_accuracy":81,"passes_completed":363,"passes_attempted":450},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"NEC Nijmegen","source_name":"Nijmegen","slug":"nec-nijmegen","country":"Pays-Bas","domestic_competition":null,"domestic_league":"Eredivisie","identity_keys":["nijmegen","necnijmegen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/nijmegen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Netherlands%20-%20Eredivisie/NEC%20Nijmegen.png","logo_blob_sha":"095802d08b20c08447839ff9ad6183205bb152c9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Netherlands - Eredivisie/NEC Nijmegen.png"},"away_club":{"name":"Levski Sofia","source_name":"Levski","slug":"levski-sofia","country":"Bulgarie","domestic_competition":null,"domestic_league":"Première division bulgare","identity_keys":["levski","levskisofia"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/levski.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Bulgaria%20-%20efbet%20Liga/Levski%20Sofia.png","logo_blob_sha":"84ba744ff0e13e50fa635950a7a2c7ab6c7b9ca9","logo_repository":"luukhopman/football-logos","logo_path":"logos/Bulgaria - efbet Liga/Levski Sofia.png"}},{"id":"EL-31","source_key":"8a8a0a82eb3aeb1aecf28bed02950a8c0428d46c6a153be27e8cdce96acb34be","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":3,"home_stats":{"woodwork":null,"team_rating":null,"xg":1.15,"possession":54,"shots":13,"shots_on_target":3,"big_chances":3,"corners":7,"yellow_cards":5,"red_cards":null,"pass_accuracy":79,"passes_completed":383,"passes_attempted":486},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.33,"possession":46,"shots":19,"shots_on_target":5,"big_chances":6,"corners":5,"yellow_cards":1,"red_cards":null,"pass_accuracy":79,"passes_completed":332,"passes_attempted":420},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"TSG 1899 Hoffenheim","source_name":"Hoffenheim","slug":"tsg-1899-hoffenheim","country":"Allemagne","domestic_competition":"bundesliga","domestic_league":"Bundesliga","identity_keys":["hoffenheim","tsg1899hoffenheim","tsghoffenheim"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/hoffenheim.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Germany%20-%20Bundesliga/TSG%201899%20Hoffenheim.png","logo_blob_sha":"dc5fe98029eededad6268a654625eff99a8a364d","logo_repository":"luukhopman/football-logos","logo_path":"logos/Germany - Bundesliga/TSG 1899 Hoffenheim.png"},"away_club":{"name":"Besiktas JK","source_name":"Besiktas","slug":"besiktas-jk","country":"Turquie","domestic_competition":null,"domestic_league":"Süper Lig","identity_keys":["besiktas","besiktasjk"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/besiktas.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/T%C3%BCrkiye%20-%20S%C3%BCper%20Lig/Besiktas%20JK.png","logo_blob_sha":"114a7809a45417c149bc70376014475d677fcca8","logo_repository":"luukhopman/football-logos","logo_path":"logos/Türkiye - Süper Lig/Besiktas JK.png"}},{"id":"EL-32","source_key":"b10be508200936a238878a7d55f697c1bae88606b4fe3e99b97c356d9e48331c","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":3,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.84,"possession":62,"shots":23,"shots_on_target":7,"big_chances":5,"corners":7,"yellow_cards":3,"red_cards":null,"pass_accuracy":82,"passes_completed":380,"passes_attempted":464},"away_stats":{"woodwork":null,"team_rating":null,"xg":0.35,"possession":38,"shots":6,"shots_on_target":1,"big_chances":0,"corners":3,"yellow_cards":3,"red_cards":null,"pass_accuracy":70,"passes_completed":203,"passes_attempted":291},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"AFC Bournemouth","source_name":"Bournemouth","slug":"afc-bournemouth","country":"Angleterre","domestic_competition":"premier-league","domestic_league":"Premier League","identity_keys":["bournemouth","afcbournemouth"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/bournemouth.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/England%20-%20Premier%20League/AFC%20Bournemouth.png","logo_blob_sha":"14810679717c6be956912126c4ab8bd6341971c4","logo_repository":"luukhopman/football-logos","logo_path":"logos/England - Premier League/AFC Bournemouth.png"},"away_club":{"name":"SK Sturm Graz","source_name":"Sturm Graz","slug":"sk-sturm-graz","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["sturmgraz","sksturmgraz"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/sturm-graz.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/SK%20Sturm%20Graz.png","logo_blob_sha":"e1cac8a3d9045d1953df624b247019c4a6080f0f","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/SK Sturm Graz.png"}},{"id":"EL-33","source_key":"cd7dc6d2038300a863c00d7c9263accbd7d3a8a6bf9625c0adb762cb3309b740","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":0,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.07,"possession":45,"shots":13,"shots_on_target":3,"big_chances":3,"corners":6,"yellow_cards":2,"red_cards":null,"pass_accuracy":88,"passes_completed":416,"passes_attempted":473},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.08,"possession":55,"shots":10,"shots_on_target":6,"big_chances":2,"corners":2,"yellow_cards":2,"red_cards":null,"pass_accuracy":90,"passes_completed":516,"passes_attempted":576},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"GNK Dinamo Zagreb","source_name":"Din. Zagreb","slug":"gnk-dinamo-zagreb","country":"Croatie","domestic_competition":null,"domestic_league":"Première division croate","identity_keys":["dinzagreb","gnkdinamozagreb","dinamozagreb"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/din-zagreb.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Croatia%20-%20SuperSport%20HNL/GNK%20Dinamo%20Zagreb.png","logo_blob_sha":"00540ee78b21d953553d06d16e5adc1f8003e494","logo_repository":"luukhopman/football-logos","logo_path":"logos/Croatia - SuperSport HNL/GNK Dinamo Zagreb.png"},"away_club":{"name":"RSC Anderlecht","source_name":"Anderlecht","slug":"rsc-anderlecht","country":"Belgique","domestic_competition":null,"domestic_league":"Pro League","identity_keys":["anderlecht","rscanderlecht"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/anderlecht.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Belgium%20-%20Jupiler%20Pro%20League/RSC%20Anderlecht.png","logo_blob_sha":"ab618379b511cd81ce1058716c8ac95b404d3422","logo_repository":"luukhopman/football-logos","logo_path":"logos/Belgium - Jupiler Pro League/RSC Anderlecht.png"}},{"id":"EL-34","source_key":"277d7d383a6374738419f9a9a9eed51995f14466f8a2107e78b30ab86ec0dc8e","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":2,"goals_away":1,"home_stats":{"woodwork":null,"team_rating":null,"xg":2.3,"possession":53,"shots":12,"shots_on_target":6,"big_chances":3,"corners":7,"yellow_cards":3,"red_cards":null,"pass_accuracy":81,"passes_completed":352,"passes_attempted":432},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.93,"possession":47,"shots":18,"shots_on_target":7,"big_chances":3,"corners":3,"yellow_cards":1,"red_cards":null,"pass_accuracy":78,"passes_completed":305,"passes_attempted":389},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Ferencvárosi TC","source_name":"Ferencvaros","slug":"ferencvarosi-tc","country":"Hongrie","domestic_competition":null,"domestic_league":"Première division hongroise","identity_keys":["ferencvaros","ferencvarositc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ferencvaros.png","logo_source_url":"https://github.com/sariyuce/sariyuce.github.io/blob/0175b7cbd20b57f0ed8a71d95c4570752913e899/assets/uefa-draws/logos/960px-Ferencvarosi_TC.svg.png","logo_blob_sha":"fa04410797b88f88d5c2651644de76c1eed13cd2","logo_repository":"sariyuce/sariyuce.github.io","logo_path":"assets/uefa-draws/logos/960px-Ferencvarosi_TC.svg.png"},"away_club":{"name":"FC Viktoria Plzen","source_name":"Plzen","slug":"fc-viktoria-plzen","country":"Tchéquie","domestic_competition":null,"domestic_league":"Première division tchèque","identity_keys":["plzen","fcviktoriaplzen","viktoriaplzen"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/plzen.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Czech%20Republic%20-%20Chance%20Liga/FC%20Viktoria%20Plzen.png","logo_blob_sha":"e5da09b87feac80e5da28e73d59b795361991d62","logo_repository":"luukhopman/football-logos","logo_path":"logos/Czech Republic - Chance Liga/FC Viktoria Plzen.png"}},{"id":"EL-35","source_key":"12a045a62de48a72728052fab463afc552f3e1a3f18b4ee3b7b5b5d68d9aea46","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T19:00:00.000Z","displayed_date":"2026-10-15T21:00","timezone_proposal":"Europe/Paris","goals_home":1,"goals_away":2,"home_stats":{"woodwork":null,"team_rating":null,"xg":1,"possession":47,"shots":9,"shots_on_target":2,"big_chances":2,"corners":2,"yellow_cards":2,"red_cards":null,"pass_accuracy":85,"passes_completed":428,"passes_attempted":501},"away_stats":{"woodwork":null,"team_rating":null,"xg":1.89,"possession":53,"shots":22,"shots_on_target":6,"big_chances":4,"corners":7,"yellow_cards":2,"red_cards":null,"pass_accuracy":88,"passes_completed":482,"passes_attempted":550},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"RC Celta de Vigo","source_name":"Celta Vigo","slug":"rc-celta-de-vigo","country":"Espagne","domestic_competition":"laliga","domestic_league":"LaLiga","identity_keys":["celtavigo","rcceltadevigo","celtadevigo"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/celta-vigo.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Spain%20-%20LaLiga/Celta%20de%20Vigo.png","logo_blob_sha":"323bf79463695cde7b996fa4dd3cefa6c0ba1dd0","logo_repository":"luukhopman/football-logos","logo_path":"logos/Spain - LaLiga/Celta de Vigo.png"},"away_club":{"name":"Juventus FC","source_name":"Juventus","slug":"juventus-fc","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["juventus","juventusfc"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/juventus.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/Juventus%20FC.png","logo_blob_sha":"89d23971e016e5ffc61c6bf86d0b2c1bce887b4a","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/Juventus FC.png"}},{"id":"EL-36","source_key":"7603c294fae5dec119c293a765da4317d4878d580c2e0105ae0cca69d7dbd0d6","competition":"europa-league","season":"2026-2027","round":"2","kickoff":"2026-10-15T16:45:00.000Z","displayed_date":"2026-10-15T18:45","timezone_proposal":"Europe/Paris","goals_home":0,"goals_away":4,"home_stats":{"woodwork":null,"team_rating":null,"xg":0.81,"possession":52,"shots":14,"shots_on_target":2,"big_chances":2,"corners":3,"yellow_cards":1,"red_cards":null,"pass_accuracy":88,"passes_completed":461,"passes_attempted":524},"away_stats":{"woodwork":null,"team_rating":null,"xg":3.39,"possession":48,"shots":15,"shots_on_target":10,"big_chances":7,"corners":2,"yellow_cards":1,"red_cards":null,"pass_accuracy":90,"passes_completed":429,"passes_attempted":478},"review_note":"Fuseau horaire non affiché : Europe/Paris proposé, à confirmer.","home_club":{"name":"Red Bull Salzburg","source_name":"Red Bull Salzbourg","slug":"red-bull-salzburg","country":"Autriche","domestic_competition":null,"domestic_league":"Bundesliga autrichienne","identity_keys":["redbullsalzbourg","redbullsalzburg","rbsalzburg"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/red-bull-salzbourg.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Austria%20-%20Bundesliga/Red%20Bull%20Salzburg.png","logo_blob_sha":"31e95f49ed5da7a789c454a9c3aaef3928ef9b06","logo_repository":"luukhopman/football-logos","logo_path":"logos/Austria - Bundesliga/Red Bull Salzburg.png"},"away_club":{"name":"AC Milan","source_name":"AC Milan","slug":"ac-milan","country":"Italie","domestic_competition":"serie-a","domestic_league":"Serie A","identity_keys":["acmilan"],"logo_url":"https://victorcorreiaensea.github.io/calcito/images/clubs/europe-2026/ac-milan.png","logo_source_url":"https://github.com/luukhopman/football-logos/blob/2a3978f0b4730645c205d855a4bda54c161183e9/logos/Italy%20-%20Serie%20A/AC%20Milan.png","logo_blob_sha":"e6209230efa5637278c47ba989f57c60e7fc0b66","logo_repository":"luukhopman/football-logos","logo_path":"logos/Italy - Serie A/AC Milan.png"}}]}$records$::jsonb,'europe-2026-captures-72-v1') AS bilan_importation;
COMMIT;
