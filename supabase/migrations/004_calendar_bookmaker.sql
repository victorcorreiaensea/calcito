-- Calcito: real upcoming calendars and autonomous virtual bookmaker.
-- Requires 001, 002 and 003. Run once. No real currency or proprietary form changes.
BEGIN;
CREATE TABLE public.arena_offers (
    user_id uuid NOT NULL REFERENCES auth.users (id),
    nonce uuid NOT NULL,
    request_hash text NOT NULL,
    decision jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, nonce)
);
CREATE TABLE public.arena_calendar_refs (
    external_key text PRIMARY KEY,
    match_id uuid NOT NULL REFERENCES public.matches (id),
    source text NOT NULL,
    timezone text NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.arena_calendar_runs (
    nonce uuid PRIMARY KEY,
    actor uuid REFERENCES auth.users (id),
    report jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arena_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_calendar_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_calendar_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_offers, public.arena_calendar_refs, public.arena_calendar_runs FROM public, anon, authenticated;
ALTER FUNCTION public.arena_place_ticket (uuid[], bigint, text, numeric, uuid) RENAME TO _arena_place_ticket_v5;
REVOKE ALL ON FUNCTION public._arena_place_ticket_v5 (uuid[], bigint, text, numeric, uuid) FROM public, anon, authenticated;
CREATE FUNCTION public.arena_place_ticket (selection uuid[], amount bigint, mode text, offered_odds numeric, client_nonce uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF mode IS DISTINCT FROM 'challenge' THEN
        RAISE EXCEPTION 'La mise bookmaker est choisie par Calcito : utiliser la proposition autonome.';
    END IF;
    RETURN _arena_place_ticket_v5 (selection, amount, mode, offered_odds, client_nonce);
END
$$;
REVOKE ALL ON FUNCTION public.arena_place_ticket (uuid[], bigint, text, numeric, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.arena_place_ticket (uuid[], bigint, text, numeric, uuid) TO authenticated;
CREATE FUNCTION public._arena_bookmaker_decision (selection uuid[], offered_odds numeric, exposure_cap bigint DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid;
    w arena_wallets;
    b arena_bank;
    q arena_quotes;
    m matches;
    cfg arena_model;
    p numeric;
    edge numeric;
    k numeric;
    uncertainty numeric;
    amount bigint;
    risk bigint;
    gross bigint;
    limit_user bigint;
    reason text;
BEGIN
    PERFORM
        _arena_lock ();
    u := _arena_account ();
    IF coalesce(cardinality(selection), 0) <> 1 OR offered_odds IS NULL OR offered_odds < 1.01 OR offered_odds > 1000 OR offered_odds = 'NaN'::numeric THEN
        RAISE EXCEPTION 'Une sélection et une cote décimale entre 1,01 et 1000 sont requises.';
    END IF;
    SELECT
        *
    INTO
        q
    FROM
        arena_quotes
    WHERE
        id = selection[1];
    SELECT
        *
    INTO
        cfg
    FROM
        arena_model;
    IF NOT found OR NOT cfg.enabled THEN
        RAISE EXCEPTION 'Cote indisponible : modèle non validé.';
    END IF;
    IF q.id IS NULL OR q.creator <> u OR q.expires_at <= clock_timestamp() OR q.model_at <> cfg.trained_at OR q.model_version <> cfg.version THEN
        RAISE EXCEPTION 'Cote expirée : actualiser les rencontres.';
    END IF;
    SELECT
        *
    INTO
        m
    FROM
        matches
    WHERE
        id = q.match_id;
    IF m.status <> 'scheduled' OR NOT m.is_published OR m.kickoff <= clock_timestamp() OR m.kickoff <> q.kickoff OR m.updated_at <> q.match_revision THEN
        RAISE EXCEPTION 'Rencontre verrouillée ou modifiée.';
    END IF;
    IF NOT EXISTS (
        SELECT
            1
        FROM
            seasons s
            JOIN competitions c ON c.id = s.competition_id
        WHERE
            s.id = m.season_id
            AND s.is_published
            AND c.is_published) OR NOT EXISTS (
    SELECT
        1
    FROM
        teams
    WHERE
        id = m.home_team_id
            AND is_published) OR NOT EXISTS (
    SELECT
        1
    FROM
        teams
    WHERE
        id = m.away_team_id
            AND is_published) THEN
        RAISE EXCEPTION 'Participants non publiés.';
    END IF;
    SELECT
        *
    INTO
        w
    FROM
        arena_wallets
    WHERE
        user_id = u;
    SELECT
        *
    INTO
        b
    FROM
        arena_bank;
    p := q.probability;
    edge := p * offered_odds - 1;
    k := greatest (0, edge / (offered_odds - 1));
    uncertainty := 1 - 2 * p * (1 - p);
    limit_user := CASE WHEN w.debt = 0 THEN
        _arena_limit (w.available)
    ELSE
        0
    END;
    IF exposure_cap IS NOT NULL THEN
        IF exposure_cap < 0 THEN
            RAISE EXCEPTION 'Limite de responsabilité invalide.';
        END IF;
        limit_user := least (limit_user, exposure_cap);
    END IF;
    amount := least (
        CASE WHEN b.debt = 0 THEN
            _arena_limit (b.available)
        ELSE
            0
        END, floor(least (b.available, 20000) *.25 * k * uncertainty)::bigint, (ceil((limit_user + 1) / (offered_odds - 1)) - 1)::bigint);
    gross := floor(amount * offered_odds);
    risk := gross - amount;
    IF edge <=.05 THEN
        amount := 0;
        reason := 'Je passe mon tour : rendement théorique insuffisant (seuil supérieur à 5 %).';
    ELSIF amount < 1
            OR risk < 1 THEN
            amount := 0;
        reason := 'Je reste prudent : nos budgets ne couvrent pas un engagement au centime.';
    ELSE
        reason := 'Je choisis une mise prudente à partir de la valeur estimée, de l’incertitude et de nos budgets. Le résultat reste incertain.';
    END IF;
    RETURN jsonb_build_object('accepted', amount > 0, 'stake', amount, 'probability', p, 'odds', offered_odds, 'edge', edge, 'kelly', k, 'uncertaintyFactor', uncertainty, 'userRisk', CASE WHEN amount > 0 THEN
            risk
        ELSE
            0
        END, 'gross', CASE WHEN amount > 0 THEN
            gross
        ELSE
            0
        END, 'reason', reason, 'decisionVersion', 'quarter-kelly-budget-v1', 'evaluatedAt', clock_timestamp());
END
$$;
REVOKE ALL ON FUNCTION public._arena_bookmaker_decision (uuid[], numeric, bigint) FROM public, anon, authenticated;
CREATE FUNCTION public.arena_bookmaker_preview (selection uuid[], offered_odds numeric)
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT
        _arena_bookmaker_decision (selection, offered_odds, NULL)
$$;
CREATE FUNCTION public.arena_offer_bookmaker (selection uuid[], offered_odds numeric, client_nonce uuid, exposure_cap bigint DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid;
    finger text;
    old arena_offers;
    decision jsonb;
    result jsonb;
BEGIN
    PERFORM
        _arena_lock ();
    u := _arena_account ();
    IF client_nonce IS NULL THEN
        RAISE EXCEPTION 'Identifiant requis.';
    END IF;
    finger := md5(jsonb_build_object('selection', selection, 'odds', offered_odds, 'cap', exposure_cap)::text);
    SELECT
        *
    INTO
        old
    FROM
        arena_offers
    WHERE
        user_id = u
        AND nonce = client_nonce;
    IF found THEN
        IF OLD.request_hash <> finger THEN
            RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre proposition.';
        END IF;
        RETURN OLD.decision || jsonb_build_object('replayed', TRUE);
    END IF;
    IF EXISTS (
        SELECT
            1
        FROM
            arena_tickets
        WHERE
            user_id = u
            AND nonce = client_nonce) OR EXISTS (
    SELECT
        1
    FROM
        arena_rejections
    WHERE
        user_id = u
            AND nonce = client_nonce) THEN
        RAISE EXCEPTION 'Identifiant déjà utilisé.';
    END IF;
    decision := _arena_bookmaker_decision (selection, offered_odds, exposure_cap);
    IF (decision ->> 'accepted')::boolean THEN
        result := _arena_place_ticket_v5 (selection, (decision ->> 'stake')::bigint, 'bookmaker', offered_odds, client_nonce);
        decision := decision || result;
    END IF;
    INSERT INTO arena_offers
        VALUES (u, client_nonce, finger, decision, now());
    RETURN decision;
END
$$;
REVOKE ALL ON FUNCTION public.arena_bookmaker_preview (uuid[], numeric), public.arena_offer_bookmaker (uuid[], numeric, uuid, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.arena_bookmaker_preview (uuid[], numeric), public.arena_offer_bookmaker (uuid[], numeric, uuid, bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.arena_status ()
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT
        jsonb_build_object('installed', TRUE, 'autonomousBookmaker', TRUE, 'model', report, 'enabled', enabled, 'version', version, 'trainedAt', trained_at, 'botLimit', CASE WHEN b.debt = 0 THEN
                _arena_limit (b.available)
            ELSE
                0
            END)
    FROM
        arena_model
    CROSS JOIN arena_bank b
$$;
CREATE FUNCTION public.arena_calendar_apply (entries jsonb, client_nonce uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    e jsonb;
    m matches;
    sid uuid;
    hid uuid;
    aid uuid;
    mid uuid;
    linked uuid;
    n integer := 0;
    changed integer := 0;
    skipped integer := 0;
    outcome jsonb;
    old arena_calendar_runs;
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise.'
            USING errcode = '42501';
    END IF;
    PERFORM
        _arena_lock ();
    IF client_nonce IS NULL OR jsonb_typeof(entries) <> 'array' OR jsonb_array_length(entries) > 250 THEN
        RAISE EXCEPTION 'Prévisualisation invalide.';
    END IF;
    SELECT
        *
    INTO
        old
    FROM
        arena_calendar_runs
    WHERE
        nonce = client_nonce;
    IF found THEN
        IF OLD.actor IS DISTINCT FROM auth.uid () OR OLD.report ->> 'requestHash' <> md5(entries::text) THEN
            RAISE EXCEPTION 'Identifiant de synchronisation déjà utilisé.';
        END IF;
        RETURN OLD.report || jsonb_build_object('replayed', TRUE);
    END IF;
    FOR e IN
    SELECT
        *
    FROM
        jsonb_array_elements(entries)
        LOOP
            sid := (e ->> 'season_id')::uuid;
            hid := (e ->> 'home_team_id')::uuid;
            aid := (e ->> 'away_team_id')::uuid;
            IF NOT EXISTS (
                SELECT
                    1
                FROM
                    seasons s
                    JOIN competitions c ON c.id = s.competition_id
                WHERE
                    s.id = sid
                    AND s.start_year = 2026
                    AND s.is_published
                    AND c.is_published
                    AND c.type = 'league'
                    AND c.slug IN ('ligue-1', 'premier-league', 'laliga', 'serie-a', 'bundesliga', 'liga-portugal')) OR hid = aid OR NOT EXISTS (
            SELECT
                1
            FROM
                teams
            WHERE
                id = hid
                    AND is_published) OR NOT EXISTS (
            SELECT
                1
            FROM
                teams
            WHERE
                id = aid
                    AND is_published) THEN
                RAISE EXCEPTION 'Compétition, saison ou participants invalides.';
            END IF;
            IF (e ->> 'source') IS NULL OR (e ->> 'source') !~ '^https://raw[.]githubusercontent[.]com/openfootball/football[.]json/[a-f0-9]{40}/2026-27/(fr|en|es|it|de|pt)[.]1[.]json$' OR length(coalesce(e ->> 'external_key', ''))
        NOT BETWEEN 10 AND 400 OR e ->> 'timezone' NOT IN ('Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome', 'Europe/Berlin', 'Europe/Lisbon') OR e ->> 'status' NOT IN ('scheduled', 'postponed', 'cancelled') THEN
                RAISE EXCEPTION 'Source ou statut non autorisé.';
            END IF;
            IF (e ->> 'kickoff')::timestamptz < '2026-07-01T00:00:00Z' OR (e ->> 'kickoff')::timestamptz >= '2027-07-01T00:00:00Z' THEN
                RAISE EXCEPTION 'Date hors saison 2026–2027.';
            END IF;
            linked := NULL;
            SELECT
                match_id
            INTO
                linked
            FROM
                arena_calendar_refs
            WHERE
                external_key = e ->> 'external_key';
            IF linked IS NOT NULL THEN
                SELECT
                    *
                INTO
                    m
                FROM
                    matches
                WHERE
                    id = linked;
            ELSE
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
                ORDER BY
                    kickoff
                LIMIT 1;
                IF (
                    SELECT
                        count(*)
                    FROM
                        matches
                    WHERE
                        season_id = sid
                        AND home_team_id = hid
                        AND away_team_id = aid) > 1 THEN
                    RAISE EXCEPTION 'Rencontre ambiguë.';
                END IF;
            END IF;
            IF m.id IS NOT NULL AND (m.season_id <> sid OR m.home_team_id <> hid OR m.away_team_id <> aid) THEN
                RAISE EXCEPTION 'Association de rencontre incohérente.';
            END IF;
            IF m.id IS NOT NULL AND m.status IN ('finished', 'live') THEN
                skipped := skipped + 1;
                CONTINUE;
            END IF;
            IF e ->> 'status' = 'scheduled' AND (e ->> 'kickoff')::timestamptz <= clock_timestamp() THEN
                skipped := skipped + 1;
                CONTINUE;
            END IF;
            IF m.id IS NOT NULL AND m.updated_at IS DISTINCT FROM (e ->> 'expected_updated_at')::timestamptz THEN
                RAISE EXCEPTION 'Calendrier modifié : recharger la prévisualisation.'
                    USING errcode = '40001';
            END IF;
            IF m.id IS NULL THEN
                IF e ->> 'status' <> 'scheduled' THEN
                    skipped := skipped + 1;
                    CONTINUE;
                END IF;
                INSERT INTO matches (season_id, round, kickoff, home_team_id, away_team_id, status, source, verified_at, comment, is_published)
                    VALUES (sid, e ->> 'round', (e ->> 'kickoff')::timestamptz, hid, aid, 'scheduled', e ->> 'source', now(), 'Calendrier OpenFootball CC0 ; heure locale ' || (e ->> 'timezone') || '.', TRUE)
                RETURNING
                    id
                INTO
                    mid;
                n := n + 1;
            ELSE
                mid := m.id;
                IF (m.kickoff,
                    m.status,
                    m.is_published) IS DISTINCT FROM ((e ->> 'kickoff')::timestamptz,
            e ->> 'status',
            TRUE) OR coalesce(m.comment, '') like'%Heure non renseignée%'then UPDATE
            matches
        SET
            kickoff = (e ->> 'kickoff')::timestamptz,
        status = e ->> 'status',
        source = e ->> 'source',
        verified_at = now(),
        comment = 'Calendrier OpenFootball CC0 ; heure locale ' || (e ->> 'timezone') || '.',
    is_published = TRUE
WHERE
    id = mid;
                    changed := changed + 1;
                ELSE
                    skipped := skipped + 1;
                END IF;
            END IF;
            INSERT INTO arena_calendar_refs
                VALUES (e ->> 'external_key', mid, e ->> 'source', e ->> 'timezone', now())
            ON CONFLICT (external_key)
                DO UPDATE SET
                    source = excluded.source,
                    synced_at = now();
        END LOOP;
    outcome := jsonb_build_object('added', n, 'updated', changed, 'unchanged', skipped, 'requestHash', md5(entries::text));
    INSERT INTO arena_calendar_runs
        VALUES (client_nonce, auth.uid (), outcome, now());
    RETURN outcome;
END
$$;
CREATE FUNCTION public.arena_calendar_status ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    cfg arena_model;
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise.'
            USING errcode = '42501';
    END IF;
    SELECT
        *
    INTO
        cfg
    FROM
        arena_model;
    RETURN jsonb_build_object('installed', TRUE, 'lastSync', (
            SELECT
                max(created_at)
            FROM arena_calendar_runs), 'fixtures', (
            SELECT
                coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'available', m.status = 'scheduled'
                            AND m.kickoff > clock_timestamp()
                    AND coalesce(m.comment, '')
                    NOT like'%Heure non renseignée%'
                    AND cfg.enabled
                    AND _arena_probs (m.id, cfg.mix, least (now(), m.kickoff)) IS NOT NULL
                AND jsonb_array_length(coalesce(cfg.report -> 'markets', '[]')) > 0)), '[]')
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions c ON c.id = s.competition_id
    WHERE
        m.is_published
        AND s.start_year = 2026
        AND c.type = 'league'
        AND (m.kickoff > now()
        OR m.status IN ('postponed', 'cancelled'))));
END
$$;
REVOKE ALL ON FUNCTION public.arena_calendar_apply (jsonb, uuid), public.arena_calendar_status () FROM public;
GRANT EXECUTE ON FUNCTION public.arena_calendar_apply (jsonb, uuid), public.arena_calendar_status () TO authenticated;
NOTIFY pgrst,
'reload schema';
COMMIT;

