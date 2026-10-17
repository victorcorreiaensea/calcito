-- European preparation: owner-only imports, NEVER publishes a match.
BEGIN;
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
            report = report || jsonb_build_object('enabled', FALSE, 'reason', 'Résultats modifiés : recalibration requise pour les nouvelles cotes.');
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
COMMIT;

