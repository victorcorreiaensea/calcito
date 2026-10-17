-- Apply after migrations 001–005. No fixture data or automatic publication.
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
CREATE TABLE IF NOT EXISTS public.photo_import_captures (
    sha256 text PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 250),
    image_data text NOT NULL CHECK (length(image_data) < 500000 AND image_data LIKE 'data:image/jpeg;base64,%'),
    proposed jsonb NOT NULL,
    draft jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'verified', 'published')),
    revision integer NOT NULL DEFAULT 1,
    baseline text,
    match_id uuid REFERENCES public.matches (id),
    verified_by uuid REFERENCES auth.users (id),
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.photo_import_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sha256 text NOT NULL REFERENCES public.photo_import_captures (sha256),
    actor uuid NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    before_value jsonb,
    after_value jsonb NOT NULL
);
ALTER TABLE public.photo_import_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_import_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS photo_owner_read ON public.photo_import_captures;
CREATE POLICY photo_owner_read ON public.photo_import_captures
    FOR SELECT TO authenticated
    USING (public.is_calcito_admin ());
DROP POLICY IF EXISTS photo_audit_owner ON public.photo_import_audit;
CREATE POLICY photo_audit_owner ON public.photo_import_audit
    FOR SELECT TO authenticated
    USING (public.is_calcito_admin ());
REVOKE ALL ON public.photo_import_captures, public.photo_import_audit FROM anon, authenticated;
GRANT SELECT ON public.photo_import_captures, public.photo_import_audit TO authenticated;
CREATE OR REPLACE FUNCTION public._photo_audit ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    INSERT INTO photo_import_audit (sha256, actor, before_value, after_value)
        VALUES (NEW.sha256, auth.uid (), CASE WHEN TG_OP = 'UPDATE' THEN
                to_jsonb (OLD) - 'image_data' - 'proposed'
            END, to_jsonb (NEW) - 'image_data' - 'proposed');
    RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS photo_audit ON public.photo_import_captures;
CREATE TRIGGER photo_audit
    AFTER INSERT OR UPDATE ON public.photo_import_captures
    FOR EACH ROW
    EXECUTE FUNCTION public._photo_audit ();
CREATE OR REPLACE FUNCTION public.photo_import_status ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    RETURN '{"ready":true,"version":1}'::jsonb;
END
$$;
CREATE OR REPLACE FUNCTION public.photo_import_stage (payload jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    h text;
    previous photo_import_captures;
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    h = payload ->> 'sha256';
    IF h IS NULL OR h <> encode(sha256 (decode(split_part(payload ->> 'image_data', ',', 2), 'base64')), 'hex') THEN
        RAISE EXCEPTION 'Empreinte de la photo invalide';
    END IF;
    INSERT INTO photo_import_captures (sha256, filename, image_data, proposed)
        VALUES (h, payload ->> 'filename', payload ->> 'image_data', payload - 'image_data')
    ON CONFLICT
        DO NOTHING;
    SELECT
        *
    INTO
        previous
    FROM
        photo_import_captures
    WHERE
        sha256 = h;
    IF previous.proposed IS DISTINCT FROM payload - 'image_data' THEN
        RAISE EXCEPTION 'Cette photo existe avec une autre extraction. Vérifiez la version enregistrée.';
    END IF;
    RETURN jsonb_build_object('sha256', h, 'status', previous.status);
END
$$;
-- Read-only plan: all non-null existing values are protected, even on a draft.
CREATE OR REPLACE FUNCTION public._photo_plan (d jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    sid uuid;
    cid uuid;
    hid uuid;
    aid uuid;
    c text;
    s text;
    team jsonb;
    tid uuid;
    m matches;
    n integer;
    st jsonb;
    oldst jsonb;
    merged jsonb;
    k text;
    v numeric;
    p jsonb;
    stamp text;
    existing_stats jsonb;
BEGIN
    IF coalesce((d ->> 'identity_confirmed')::boolean, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Confirmez les identités, la compétition, la journée et le fuseau horaire.';
    END IF;
    cid = (d ->> 'competition_id')::uuid;
    SELECT
        slug
    INTO
        c
    FROM
        competitions
    WHERE
        id = cid
        AND slug IN ('champions-league', 'europa-league')
        AND is_published;
    IF c IS NULL THEN
        RAISE EXCEPTION 'Choisissez une compétition européenne publiée.';
    END IF;
    IF d ->> 'round' NOT IN ('1', '2') OR d ->> 'round' IS NULL OR d ->> 'kickoff' IS NULL OR (d ->> 'kickoff')::timestamptz > now() OR (d ->> 'kickoff')::timestamptz < '2026-07-01' OR (d ->> 'kickoff')::timestamptz >= '2027-07-01' THEN
        RAISE EXCEPTION 'Journée ou date terminée invalide (saison 2026–2027).';
    END IF;
    IF d ->> 'goals_home' IS NULL OR d ->> 'goals_away' IS NULL OR (d ->> 'goals_home')::integer NOT BETWEEN 0 AND 100 OR (d ->> 'goals_away')::integer NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'Score final requis.';
    END IF;
    SELECT
        count(*),
        min(id::text)::uuid
    INTO
        n,
        sid
    FROM
        seasons
    WHERE
        competition_id = cid
        AND start_year = 2026
        AND end_year = 2027;
    IF n > 1 THEN
        RAISE EXCEPTION 'Plusieurs saisons possibles : corrigez le catalogue.';
    END IF;
    IF sid IS NOT NULL AND NOT (
        SELECT
            is_published
        FROM
            seasons
        WHERE
            id = sid) THEN
        RAISE EXCEPTION 'Publiez la saison européenne dans Saisons & participants.';
    END IF;
    FOREACH s IN ARRAY ARRAY['home', 'away'] LOOP
        tid = nullif (d ->> (s || '_team_id'), '')::uuid;
        IF tid IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT
                    1
                FROM
                    teams
                WHERE
                    id = tid
                    AND is_published) THEN
                RAISE EXCEPTION 'Club interne introuvable ou privé.';
            END IF;
        ELSE
            team = d -> ('new_' || s);
            IF coalesce(length(trim(team ->> 'name')), 0) < 2 OR coalesce(length(trim(team ->> 'country')), 0) < 2 OR coalesce(length(trim(team ->> 'domestic_league')), 0) < 2 OR coalesce(team ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
                RAISE EXCEPTION 'Nouveau club : nom, pays, championnat et identifiant lisible requis.';
            END IF;
            SELECT
                id
            INTO
                tid
            FROM
                teams
            WHERE
                slug = team ->> 'slug'
                AND lower(name) = lower(trim(team ->> 'name'))
                AND lower(country) = lower(trim(team ->> 'country'))
                AND is_published;
            IF tid IS NULL AND EXISTS (
                SELECT
                    1
                FROM
                    teams
                WHERE
                    slug = team ->> 'slug'
                    OR lower(name) = lower(trim(team ->> 'name'))) THEN
                RAISE EXCEPTION 'Club possiblement existant : sélectionnez son identifiant interne.';
            END IF;
        END IF;
        IF s = 'home' THEN
            hid = tid;
        ELSE
            aid = tid;
        END IF;
    END LOOP;
    IF hid = aid OR (hid IS NULL AND aid IS NULL AND d -> 'new_home' ->> 'slug' = d -> 'new_away' ->> 'slug') THEN
        RAISE EXCEPTION 'Deux clubs différents requis.';
    END IF;
    SELECT
        count(*)
    INTO
        n
    FROM
        matches
    WHERE
        season_id = sid
        AND home_team_id = hid
        AND away_team_id = aid;
    IF n > 1 THEN
        RAISE EXCEPTION 'Plusieurs rencontres possibles. Corrigez les doublons avant import.';
    END IF;
    SELECT
        *
    INTO
        m
    FROM
        matches
    WHERE
        season_id = sid
        AND home_team_id = hid
        AND away_team_id = aid
    FOR UPDATE;
    IF m.id IS NOT NULL AND ((m.kickoff IS DISTINCT FROM (d ->> 'kickoff')::timestamptz) OR regexp_replace(lower(m.round), '[^0-9]', '', 'g') <> d ->> 'round' OR (m.goals_home IS NOT NULL AND m.goals_home <> (d ->> 'goals_home')::smallint) OR (m.goals_away IS NOT NULL AND m.goals_away <> (d ->> 'goals_away')::smallint) OR m.status NOT IN ('scheduled', 'finished')) THEN
        RAISE EXCEPTION 'Conflit de date, journée, statut ou score avec le match existant. Corrigez la capture ou le match explicitement.';
    END IF;
    SELECT
        coalesce(jsonb_agg(to_jsonb (t)
            ORDER BY team_id), '[]')
    INTO
        existing_stats
    FROM
        match_team_stats t
    WHERE
        match_id = m.id;
    stamp = md5(jsonb_build_object('match', to_jsonb (m), 'stats', existing_stats)::text);
    p = coalesce(to_jsonb (m), '{}') || jsonb_build_object('season_id', sid, 'competition_id', cid, 'home_team_id', hid, 'away_team_id', aid, 'round', coalesce(m.round, 'J' || (d ->> 'round')), 'kickoff', d ->> 'kickoff', 'goals_home', (d ->> 'goals_home')::integer, 'goals_away', (d ->> 'goals_away')::integer, 'status', 'finished', 'expected_updated_at', m.updated_at);
    FOREACH s IN ARRAY ARRAY['home', 'away'] LOOP
        tid = CASE WHEN s = 'home' THEN
            hid
        ELSE
            aid
        END;
        SELECT
            to_jsonb (t)
        INTO
            oldst
        FROM
            match_team_stats t
        WHERE
            match_id = m.id
            AND team_id = tid;
        merged = coalesce(oldst, '{}');
        st = coalesce(d -> (s || '_stats'), '{}');
        FOREACH k IN ARRAY ARRAY['shots', 'shots_on_target', 'woodwork', 'big_chances', 'team_rating', 'possession', 'xg', 'corners', 'passes_completed', 'passes_attempted', 'pass_accuracy', 'yellow_cards', 'red_cards'] LOOP
            IF st ->> k IS NOT NULL AND st ->> k <> '' THEN
                v = (st ->> k)::numeric;
                IF v < 0 OR v > 32767 OR (k IN ('pass_accuracy', 'possession') AND v > 100) OR (k = 'team_rating' AND v > 10) OR (k NOT IN ('pass_accuracy', 'possession', 'team_rating', 'xg') AND v <> trunc(v)) THEN
                    RAISE EXCEPTION 'Statistique invalide : % %', s, k;
                END IF;
                IF oldst ->> k IS NOT NULL AND (oldst ->> k)::numeric <> v THEN
                    RAISE EXCEPTION 'Conflit statistique % / % : base %, capture %. Effacez la proposition pour conserver la base, ou corrigez le match explicitement.', s, k, oldst ->> k, v;
                END IF;
                merged = jsonb_set(merged, ARRAY[k], to_jsonb (v));
            END IF;
        END LOOP;
        IF (merged ->> 'shots_on_target')::numeric > (merged ->> 'shots')::numeric OR (merged ->> 'passes_completed')::numeric > (merged ->> 'passes_attempted')::numeric THEN
            RAISE EXCEPTION 'Tirs cadrés ou passes incohérents.';
        END IF;
        p = jsonb_set(p, ARRAY[s || '_stats'], merged);
    END LOOP;
    RETURN jsonb_build_object('payload', p, 'baseline', stamp);
END
$$;
CREATE OR REPLACE FUNCTION public.photo_import_review (image_hash text, expected_revision integer, draft_value jsonb, mark_verified boolean DEFAULT FALSE)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    r photo_import_captures;
    plan jsonb;
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    PERFORM
        arena_match_guard ();
    SELECT
        *
    INTO
        r
    FROM
        photo_import_captures
    WHERE
        sha256 = image_hash
    FOR UPDATE;
    IF r.sha256 IS NULL OR r.revision <> expected_revision THEN
        RAISE EXCEPTION 'Cette capture a changé. Rechargez.'
            USING errcode = '40001';
    END IF;
    IF r.status = 'published' THEN
        RAISE EXCEPTION 'Capture publiée : utilisez la correction du match et une nouvelle capture complémentaire.';
    END IF;
    IF mark_verified THEN
        plan = _photo_plan (draft_value);
    END IF;
    UPDATE
        photo_import_captures
    SET
        draft = draft_value,
        status = CASE WHEN mark_verified THEN
            'verified'
        ELSE
            'review'
        END,
        baseline = plan ->> 'baseline',
        verified_at = CASE WHEN mark_verified THEN
            clock_timestamp()
        END,
        verified_by = CASE WHEN mark_verified THEN
            auth.uid ()
        END,
        revision = revision + 1,
        updated_at = clock_timestamp()
    WHERE
        sha256 = image_hash;
    RETURN jsonb_build_object('status', CASE WHEN mark_verified THEN
            'verified'
        ELSE
            'review'
        END);
END
$$;
CREATE OR REPLACE FUNCTION public.photo_import_publish (image_hashes text[])
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    r photo_import_captures;
    plan jsonb;
    p jsonb;
    s text;
    team jsonb;
    tid uuid;
    sid uuid;
    mid uuid;
    d jsonb;
    count_matches integer = 0;
    new_clubs integer = 0;
    was_published boolean;
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    IF cardinality(image_hashes)
        NOT BETWEEN 1 AND 72 THEN
        RAISE EXCEPTION 'Sélectionnez entre 1 et 72 captures vérifiées.';
    END IF;
    PERFORM
        arena_match_guard ();
    PERFORM
        pg_advisory_xact_lock(593817452);
    IF EXISTS (
        SELECT
            1
        FROM
            unnest(image_hashes) h
            LEFT JOIN photo_import_captures c ON c.sha256 = h
        WHERE
            c.sha256 IS NULL
            OR c.status NOT IN ('verified', 'published')) THEN
        RAISE EXCEPTION 'Publication réservée aux captures explicitement vérifiées.';
    END IF;
    FOR r IN
    SELECT
        *
    FROM
        photo_import_captures
    WHERE
        sha256 = ANY (image_hashes)
    ORDER BY
        (draft ->> 'kickoff')::timestamptz,
        sha256
    FOR UPDATE LOOP
        IF r.status = 'published' THEN
            CONTINUE;
        END IF;
        d = r.draft;
        plan = _photo_plan (d);
        IF plan ->> 'baseline' IS DISTINCT FROM r.baseline THEN
            RAISE EXCEPTION 'Le match ou ses statistiques ont changé depuis la vérification. Enregistrez puis vérifiez à nouveau.'
                USING errcode = '40001';
        END IF;
        p = plan -> 'payload';
        FOREACH s IN ARRAY ARRAY['home', 'away'] LOOP
            tid = nullif (p ->> (s || '_team_id'), '')::uuid;
            IF tid IS NULL THEN
                team = d -> ('new_' || s);
                INSERT INTO teams (name, short, slug, country, domestic_league, is_published)
                    VALUES (trim(team ->> 'name'),
                        LEFT (trim(team ->> 'name'), 3), team ->> 'slug', trim(team ->> 'country'), trim(team ->> 'domestic_league'), TRUE)
                RETURNING
                    id
                INTO
                    tid;
                new_clubs = new_clubs + 1;
            END IF;
            p = jsonb_set(p, ARRAY[s || '_team_id'], to_jsonb (tid));
        END LOOP;
        sid = nullif (p ->> 'season_id', '')::uuid;
        IF sid IS NULL THEN
            INSERT INTO seasons (competition_id, label, start_year, end_year, is_published)
                VALUES ((p ->> 'competition_id')::uuid, '2026–2027', 2026, 2027, TRUE)
            RETURNING
                id
            INTO
                sid;
        END IF;
        INSERT INTO season_teams (season_id, team_id)
        VALUES
            (sid, (p ->> 'home_team_id')::uuid),
            (sid, (p ->> 'away_team_id')::uuid)
        ON CONFLICT
            DO NOTHING;
        p = jsonb_set(p, ARRAY['season_id'], to_jsonb (sid));
        was_published = coalesce((p ->> 'is_published')::boolean, FALSE);
        p = p || jsonb_build_object('is_published', TRUE, 'source', CASE WHEN was_published THEN
                p ->> 'source'
            ELSE
                'Capture fournie : SHA-256 ' || r.sha256
            END, 'verified_at', CASE WHEN was_published THEN
                p ->> 'verified_at'
            ELSE
                r.verified_at::text
            END);
        mid = save_match (p);
        UPDATE
            photo_import_captures
        SET
            match_id = mid,
            status = 'published',
            revision = revision + 1,
            updated_at = clock_timestamp()
        WHERE
            sha256 = r.sha256;
        count_matches = count_matches + 1;
    END LOOP;
    RETURN jsonb_build_object('published', count_matches, 'new_clubs', new_clubs, 'already_published', (
            SELECT
                count(*)
            FROM photo_import_captures
            WHERE
                sha256 = ANY (image_hashes)
                AND status = 'published') - count_matches);
END
$$;
REVOKE ALL ON FUNCTION public._photo_audit (), public._photo_plan (jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_import_status (), public.photo_import_stage (jsonb), public.photo_import_review (text, integer, jsonb, boolean), public.photo_import_publish (text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_import_status (), public.photo_import_stage (jsonb), public.photo_import_review (text, integer, jsonb, boolean), public.photo_import_publish (text[]) TO authenticated;
NOTIFY pgrst,
'reload schema';
COMMIT;

