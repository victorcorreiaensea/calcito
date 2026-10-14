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

-- Initial calendar collected 2026-10-14T11:31:40.936Z, OpenFootball CC0, commit e6744429ee395bc86f247348c6184bb08d4eb361.
-- Only real published club IDs. No guessed hours, no scores, no new clubs.
-- Existing pairings are compared at execution; official results and manual corrections are retained.
DO $seed$
DECLARE e jsonb;mid uuid;n integer:=0;skipped integer:=0;seed_nonce uuid:='1514e7a0-15a4-4b05-a785-e21c97783d92';
BEGIN
 PERFORM public._arena_lock();
 IF EXISTS(SELECT 1 FROM public.arena_calendar_runs WHERE nonce=seed_nonce)THEN RETURN;END IF;
 FOR e IN SELECT *FROM jsonb_array_elements($data$[{"external_key":"fr:2026:Matchday 7:Angers SCO:Olympique de Marseille","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"64320fd4-cee8-4195-a97f-f57117d16ebc","away_team_id":"ba63bd30-7b2e-477e-bfda-fa2de66a2567","home":"Angers","away":"Olympique de Marseille","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-18T13:00:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Olympique de Marseille:Le Havre AC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"ba63bd30-7b2e-477e-bfda-fa2de66a2567","away_team_id":"a2f84e34-2459-4531-975e-ab2cebdb9b3a","home":"Olympique de Marseille","away":"Le Havre","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T16:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:RC Strasbourg Alsace:Paris Saint-Germain FC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"ae186c1c-0e27-4d08-83d0-98e08ea0ffc7","away_team_id":"d26d8510-e95a-4bbe-aae0-0949ac41de5e","home":"Strasbourg","away":"Paris Saint Germain","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-17T15:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Paris Saint-Germain FC:Olympique Lyonnais","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"d26d8510-e95a-4bbe-aae0-0949ac41de5e","away_team_id":"9728073c-9fdf-46bb-a306-2325c4e9e5cf","home":"Paris Saint Germain","away":"Lyon","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T19:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:FC Lorient:AS Monaco FC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"6ee1e3c5-c87c-4b34-b491-edd1d7dd5688","away_team_id":"da2136d9-747b-4ccd-a9e5-daa1896f332f","home":"Lorient","away":"Monaco","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-18T15:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:AS Monaco FC:Lille OSC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"da2136d9-747b-4ccd-a9e5-daa1896f332f","away_team_id":"7c5cc4e6-c6fb-49a1-bc6d-47b3f732ff33","home":"Monaco","away":"Lille","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:Lille OSC:Stade Brestois 29","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"7c5cc4e6-c6fb-49a1-bc6d-47b3f732ff33","away_team_id":"780e51a9-228b-4061-9fc4-36abcdb92b34","home":"Lille","away":"Stade Brestois 29","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-17T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:Paris FC:Stade Rennais FC 1901","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"38c78507-8535-440a-b37c-ffe5f0191a18","away_team_id":"20aa6487-1e1c-43e3-9eaf-458cd125c95d","home":"Paris FC","away":"Rennes","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-18T15:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Stade Rennais FC 1901:RC Strasbourg Alsace","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"20aa6487-1e1c-43e3-9eaf-458cd125c95d","away_team_id":"ae186c1c-0e27-4d08-83d0-98e08ea0ffc7","home":"Rennes","away":"Strasbourg","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T16:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:Olympique Lyonnais:OGC Nice","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"9728073c-9fdf-46bb-a306-2325c4e9e5cf","away_team_id":"1ed4fc8f-66ff-40e5-988e-f6063622e435","home":"Lyon","away":"Nice","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-18T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Racing Club de Lens:Paris FC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"ba9419f3-6335-4398-96a3-2fc19b8543fa","away_team_id":"38c78507-8535-440a-b37c-ffe5f0191a18","home":"Lens","away":"Paris FC","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-24T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Stade Brestois 29:OGC Nice","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"780e51a9-228b-4061-9fc4-36abcdb92b34","away_team_id":"1ed4fc8f-66ff-40e5-988e-f6063622e435","home":"Stade Brestois 29","away":"Nice","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-23T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Angers SCO:FC Lorient","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"64320fd4-cee8-4195-a97f-f57117d16ebc","away_team_id":"6ee1e3c5-c87c-4b34-b491-edd1d7dd5688","home":"Angers","away":"Lorient","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T16:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:ES Troyes AC:Racing Club de Lens","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"dae61168-7c0b-4fb2-a938-7571d6027496","away_team_id":"ba9419f3-6335-4398-96a3-2fc19b8543fa","home":"ESTAC Troyes","away":"Lens","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-17T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:Le Mans FC:Toulouse FC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"d269152d-0a43-41e4-9259-35f8f43644be","away_team_id":"d575a45e-c0c4-41d0-8bce-c2a6945e353d","home":"Le Mans","away":"Toulouse","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-16T18:45:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:AJ Auxerre:Le Mans FC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"28919eed-f30b-4f89-90c1-dd3f16790c6f","away_team_id":"d269152d-0a43-41e4-9259-35f8f43644be","home":"Auxerre","away":"Le Mans","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-25T16:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 8:Toulouse FC:ES Troyes AC","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"d575a45e-c0c4-41d0-8bce-c2a6945e353d","away_team_id":"dae61168-7c0b-4fb2-a938-7571d6027496","home":"Toulouse","away":"ESTAC Troyes","league":"Ligue 1","round":"Matchday 8","kickoff":"2026-10-24T15:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"fr:2026:Matchday 7:Le Havre AC:AJ Auxerre","season_id":"71935f73-8ef5-4f46-aab2-e23340446651","home_team_id":"a2f84e34-2459-4531-975e-ab2cebdb9b3a","away_team_id":"28919eed-f30b-4f89-90c1-dd3f16790c6f","home":"Le Havre","away":"Auxerre","league":"Ligue 1","round":"Matchday 7","kickoff":"2026-10-18T15:15:00.000Z","timezone":"Europe/Paris","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/fr.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:AFC Bournemouth:Sunderland AFC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"799b97b7-1355-48c1-bf8c-73fa5e44a7fb","away_team_id":"8dc89a20-1422-4c63-90fd-ad3ea9c623b6","home":"AFC Bournemouth","away":"Sunderland AFC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-18T13:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Manchester United FC:AFC Bournemouth","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"03fb612a-e198-481f-a061-4c543d934ee7","away_team_id":"799b97b7-1355-48c1-bf8c-73fa5e44a7fb","home":"Manchester United FC","away":"AFC Bournemouth","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Nottingham Forest FC:Arsenal FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"50884bab-a2cb-4e37-bbbc-1884dc3811b6","away_team_id":"ac27d6f7-c87f-49a8-84b0-fdc3614bd933","home":"Nottingham Forest FC","away":"Arsenal FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-18T15:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Arsenal FC:Everton FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"ac27d6f7-c87f-49a8-84b0-fdc3614bd933","away_team_id":"bb427cb1-342d-43ce-9a5f-a9e3500087af","home":"Arsenal FC","away":"Everton FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-24T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Newcastle United FC:Aston Villa FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"c91e91c3-18dd-4792-9699-f6d1247408f8","away_team_id":"a5866278-1d60-484e-9c12-8ed82f673c9a","home":"Newcastle United FC","away":"Aston Villa FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-17T16:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Aston Villa FC:Manchester City FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"a5866278-1d60-484e-9c12-8ed82f673c9a","away_team_id":"82729818-ce2b-481c-83ed-d8d591f7e4a9","home":"Aston Villa FC","away":"Manchester City FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-24T11:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Brentford FC:Liverpool FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"c59a3fbf-c73b-4952-bee3-3a8c1de8e999","away_team_id":"eae73d2e-215a-4824-84db-bd59a9dfaac4","home":"Brentford FC","away":"Liverpool FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-17T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Hull City AFC:Brentford FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"633a5ddd-d66f-446e-a617-2eaff469c909","away_team_id":"c59a3fbf-c73b-4952-bee3-3a8c1de8e999","home":"Hull City AFC","away":"Brentford FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Brighton & Hove Albion FC:Crystal Palace FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"2e20812f-70c6-44f8-8510-f0ec1f5234df","away_team_id":"4208d9ce-1bf0-4656-8de8-4f2d1413867c","home":"Brighton & Hove Albion FC","away":"Crystal Palace FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-18T13:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Liverpool FC:Brighton & Hove Albion FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"eae73d2e-215a-4824-84db-bd59a9dfaac4","away_team_id":"2e20812f-70c6-44f8-8510-f0ec1f5234df","home":"Liverpool FC","away":"Brighton & Hove Albion FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Everton FC:Chelsea FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"bb427cb1-342d-43ce-9a5f-a9e3500087af","away_team_id":"d4a2c450-2237-4485-b181-bf203ecf57d7","home":"Everton FC","away":"Chelsea FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-17T11:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Chelsea FC:Tottenham Hotspur FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"d4a2c450-2237-4485-b181-bf203ecf57d7","away_team_id":"d02354b7-3ca9-4ffe-9a76-d7aa846b5f72","home":"Chelsea FC","away":"Tottenham Hotspur FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-24T16:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Tottenham Hotspur FC:Coventry City FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"d02354b7-3ca9-4ffe-9a76-d7aa846b5f72","away_team_id":"d1528700-e6b5-44cb-a1fc-add97baa33cd","home":"Tottenham Hotspur FC","away":"Coventry City FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-19T19:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Coventry City FC:Fulham FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"d1528700-e6b5-44cb-a1fc-add97baa33cd","away_team_id":"f6e6a84a-a319-42d5-8070-4cfc0511c621","home":"Coventry City FC","away":"Fulham FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-24T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Crystal Palace FC:Newcastle United FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"4208d9ce-1bf0-4656-8de8-4f2d1413867c","away_team_id":"c91e91c3-18dd-4792-9699-f6d1247408f8","home":"Crystal Palace FC","away":"Newcastle United FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Fulham FC:Hull City AFC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"f6e6a84a-a319-42d5-8070-4cfc0511c621","away_team_id":"633a5ddd-d66f-446e-a617-2eaff469c909","home":"Fulham FC","away":"Hull City AFC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-17T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Manchester City FC:Ipswich Town FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"82729818-ce2b-481c-83ed-d8d591f7e4a9","away_team_id":"afa0e2f1-4b92-4fc9-acc6-e40ebaa13a9b","home":"Manchester City FC","away":"Ipswich Town FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-17T14:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Ipswich Town FC:Nottingham Forest FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"afa0e2f1-4b92-4fc9-acc6-e40ebaa13a9b","away_team_id":"50884bab-a2cb-4e37-bbbc-1884dc3811b6","home":"Ipswich Town FC","away":"Nottingham Forest FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-23T19:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 7:Leeds United FC:Manchester United FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"c1b19367-18e7-41c6-9e9f-488473dc3afc","away_team_id":"03fb612a-e198-481f-a061-4c543d934ee7","home":"Leeds United FC","away":"Manchester United FC","league":"Premier League","round":"Matchday 7","kickoff":"2026-10-18T13:00:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"en:2026:Matchday 8:Sunderland AFC:Leeds United FC","season_id":"c2780f7d-4514-425b-8055-a626956c0ef7","home_team_id":"8dc89a20-1422-4c63-90fd-ad3ea9c623b6","away_team_id":"c1b19367-18e7-41c6-9e9f-488473dc3afc","home":"Sunderland AFC","away":"Leeds United FC","league":"Premier League","round":"Matchday 8","kickoff":"2026-10-25T16:30:00.000Z","timezone":"Europe/London","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/en.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Valencia CF:Athletic Club","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"ff45606a-b2de-4b54-97e3-1c2afd80c250","away_team_id":"32bd8b68-9f31-4046-b9f7-87213bdaa4b6","home":"Valencia CF","away":"Athletic Club","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-17T19:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 6:Levante UD:Athletic Club","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"77e2ec4d-8b27-4b92-a2f8-b0a82dd9fdc1","away_team_id":"32bd8b68-9f31-4046-b9f7-87213bdaa4b6","home":"Levante UD","away":"Athletic Club","league":"LaLiga","round":"Matchday 6","kickoff":"2026-10-21T18:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:CA Osasuna:Real Racing Club de Santander","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"3da727ff-b1c8-4299-a4a8-880b17b531ac","away_team_id":"e5a9e838-70a1-40ea-8ea2-b8ba5bb6a1d2","home":"CA Osasuna","away":"Real Racing Club de Santander","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-18T12:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:RCD Espanyol de Barcelona:Club Atlético de Madrid","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"7dfe0e93-ce63-4f9f-8b58-59737c0cf443","away_team_id":"38b2f38c-7bcd-442b-b6a9-c4e4f64e630c","home":"RCD Espanyol de Barcelona","away":"Club Atlético de Madrid","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-17T12:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:RC Celta de Vigo:Deportivo Alavés","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"be94eeb3-9ebf-4454-a37d-484e547fa8e1","away_team_id":"3a9c3fda-a312-4ea9-94ba-b33bfe39efa1","home":"RC Celta de Vigo","away":"Deportivo Alavés","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-18T14:15:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Villarreal CF:Elche CF","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"61667cbb-c04d-4a87-bda7-c883cca341a8","away_team_id":"7b446af4-5f53-4956-9a38-15b110bcc335","home":"Villarreal CF","away":"Elche CF","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-17T14:15:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Real Betis Balompié:FC Barcelona","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"444ad816-ccb5-4177-b4ba-dc77b7efe51c","away_team_id":"f83f772d-36ac-45dd-abf5-bb3d21ea4503","home":"Real Betis Balompié","away":"FC Barcelona","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-17T16:30:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Getafe CF:Rayo Vallecano de Madrid","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"fcf2b731-4959-4329-9686-999c9f572abd","away_team_id":"254166ec-de4e-4c6f-baac-aaaacdf48ea6","home":"Getafe CF","away":"Rayo Vallecano de Madrid","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-19T19:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:RC Deportivo La Coruña:Levante UD","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"69ef616b-be6a-41d9-9775-af4e89b97829","away_team_id":"77e2ec4d-8b27-4b92-a2f8-b0a82dd9fdc1","home":"RC Deportivo La Coruña","away":"Levante UD","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-16T19:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Málaga CF:Real Sociedad de Fútbol","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"8a8c0646-5df9-4145-96ad-19f1e7f5976a","away_team_id":"f87a2f93-3acd-4e28-aefa-e9a3f29a8f22","home":"Málaga CF","away":"Real Sociedad de Fútbol","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-18T16:30:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"es:2026:Matchday 9:Real Madrid CF:Sevilla FC","season_id":"d5cbd0ee-5827-47be-af0e-19b331251bd2","home_team_id":"874992cb-3ce2-4ceb-b411-e71b1a440377","away_team_id":"46be7fc4-5b10-4569-9744-e32d855822ea","home":"Real Madrid CF","away":"Sevilla FC","league":"LaLiga","round":"Matchday 9","kickoff":"2026-10-18T19:00:00.000Z","timezone":"Europe/Madrid","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/es.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:AC Milan:Atalanta BC","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"98d24abb-a366-4636-a066-e8871d52f512","away_team_id":"505f0c24-173b-494f-9760-353300417f6c","home":"AC Milan","away":"Atalanta BC","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-18T16:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Udinese Calcio:AC Milan","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"7d2202b6-55a0-4839-81b9-38b611308941","away_team_id":"98d24abb-a366-4636-a066-e8871d52f512","home":"Udinese Calcio","away":"AC Milan","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-25T19:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:AC Monza:Cagliari Calcio","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"73a287ba-df64-410a-a4c9-8641cf75d406","away_team_id":"a3da037e-9b9b-4e4f-a752-1820059cccb4","home":"AC Monza","away":"Cagliari Calcio","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-19T16:30:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Torino FC:AC Monza","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"c465be43-06fd-47c5-b9c9-09de1c7ea5de","away_team_id":"73a287ba-df64-410a-a4c9-8641cf75d406","home":"Torino FC","away":"AC Monza","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-23T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Cagliari Calcio:Bologna FC 1909","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"a3da037e-9b9b-4e4f-a752-1820059cccb4","away_team_id":"67bdd969-81f8-4023-aeb6-42ae6d00492c","home":"Cagliari Calcio","away":"Bologna FC 1909","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-24T13:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Juventus FC:SS Lazio","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"0a032b68-cab4-4459-a2d4-3e814fc9d592","away_team_id":"9ad5b5ff-9b2b-43e6-8012-3a5fed009c31","home":"Juventus FC","away":"SS Lazio","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-18T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:US Lecce:Juventus FC","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"6f480e43-b300-4fdf-87d6-d4634226f8b9","away_team_id":"0a032b68-cab4-4459-a2d4-3e814fc9d592","home":"US Lecce","away":"Juventus FC","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-25T17:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Udinese Calcio:US Lecce","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"7d2202b6-55a0-4839-81b9-38b611308941","away_team_id":"6f480e43-b300-4fdf-87d6-d4634226f8b9","home":"Udinese Calcio","away":"US Lecce","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-18T10:30:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:ACF Fiorentina:Como 1907","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"f9881816-4395-47c3-ac36-1848e1b96118","away_team_id":"ceeb7f47-c954-4c89-98ca-d207ff29ebd5","home":"ACF Fiorentina","away":"Como 1907","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-18T13:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:FC Internazionale Milano:ACF Fiorentina","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"19b8fa21-2df8-48a0-ad3b-7756aebe7c03","away_team_id":"f9881816-4395-47c3-ac36-1848e1b96118","home":"FC Internazionale Milano","away":"ACF Fiorentina","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-25T11:30:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Como 1907:US Sassuolo Calcio","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"ceeb7f47-c954-4c89-98ca-d207ff29ebd5","away_team_id":"c3578351-4872-440f-b581-91ed91c0c917","home":"Como 1907","away":"US Sassuolo Calcio","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-24T13:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Parma Calcio 1913:Torino FC","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"6d94a24a-4162-4715-8dde-e524fbe72d30","away_team_id":"c465be43-06fd-47c5-b9c9-09de1c7ea5de","home":"Parma Calcio 1913","away":"Torino FC","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-19T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:SS Lazio:Parma Calcio 1913","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"9ad5b5ff-9b2b-43e6-8012-3a5fed009c31","away_team_id":"6d94a24a-4162-4715-8dde-e524fbe72d30","home":"SS Lazio","away":"Parma Calcio 1913","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-24T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Frosinone Calcio:US Sassuolo Calcio","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"ee19a608-1668-4f09-a1f1-c6286a5c0dbc","away_team_id":"c3578351-4872-440f-b581-91ed91c0c917","home":"Frosinone Calcio","away":"US Sassuolo Calcio","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-16T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:AS Roma:Genoa CFC","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"45a33e26-c9ed-4e9a-821e-7f3234dfa70b","away_team_id":"9b1b9830-4ab9-4129-b0ba-70447e07440d","home":"AS Roma","away":"Genoa CFC","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-17T18:45:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:SSC Napoli:AS Roma","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"6bfe8ffd-ced0-4ce3-8dac-c52f8c2ea9a0","away_team_id":"45a33e26-c9ed-4e9a-821e-7f3234dfa70b","home":"SSC Napoli","away":"AS Roma","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-24T16:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Bologna FC 1909:FC Internazionale Milano","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"67bdd969-81f8-4023-aeb6-42ae6d00492c","away_team_id":"19b8fa21-2df8-48a0-ad3b-7756aebe7c03","home":"Bologna FC 1909","away":"FC Internazionale Milano","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-17T16:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Atalanta BC:Frosinone Calcio","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"505f0c24-173b-494f-9760-353300417f6c","away_team_id":"ee19a608-1668-4f09-a1f1-c6286a5c0dbc","home":"Atalanta BC","away":"Frosinone Calcio","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 7:Venezia FC:SSC Napoli","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"30ee9a14-6d22-4790-9c1e-7bebfc06f12c","away_team_id":"6bfe8ffd-ced0-4ce3-8dac-c52f8c2ea9a0","home":"Venezia FC","away":"SSC Napoli","league":"Serie A","round":"Matchday 7","kickoff":"2026-10-17T13:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"it:2026:Matchday 8:Genoa CFC:Venezia FC","season_id":"d9319dec-82ab-49ef-afdd-4fabb0bc1373","home_team_id":"9b1b9830-4ab9-4129-b0ba-70447e07440d","away_team_id":"30ee9a14-6d22-4790-9c1e-7bebfc06f12c","home":"Genoa CFC","away":"Venezia FC","league":"Serie A","round":"Matchday 8","kickoff":"2026-10-25T14:00:00.000Z","timezone":"Europe/Rome","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/it.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:Bayer 04 Leverkusen:SC Freiburg","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"d6dc3038-0186-4b50-addb-0b7dc5a4547d","away_team_id":"c710a435-fa7f-4a50-bf39-195399c66d68","home":"Bayer 04 Leverkusen","away":"SC Freiburg","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-18T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:TSG 1899 Hoffenheim:Bayer 04 Leverkusen","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"2904c9a0-c82f-439b-9236-07bdecc75e90","away_team_id":"d6dc3038-0186-4b50-addb-0b7dc5a4547d","home":"TSG 1899 Hoffenheim","away":"Bayer 04 Leverkusen","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-25T14:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:FC Bayern München:RB Leipzig","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"2c324056-fd47-4e58-9907-b055a68e2649","away_team_id":"5f2dc757-af08-4cfe-829b-8bb2980748b3","home":"FC Bayern München","away":"RB Leipzig","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T16:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:SC Freiburg:FC Bayern München","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"c710a435-fa7f-4a50-bf39-195399c66d68","away_team_id":"2c324056-fd47-4e58-9907-b055a68e2649","home":"SC Freiburg","away":"FC Bayern München","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-25T16:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:SV Werder Bremen:SC Paderborn 07","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"6875c107-652e-499c-a7f8-11def74116d2","away_team_id":"4b1496b4-3132-4e54-bcee-aa0a5ee3ae8c","home":"SV Werder Bremen","away":"SC Paderborn 07","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:SC Paderborn 07:Hamburger SV","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"4b1496b4-3132-4e54-bcee-aa0a5ee3ae8c","away_team_id":"15e161e9-39e0-4125-8ca8-b9488d5c530f","home":"SC Paderborn 07","away":"Hamburger SV","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:1. FC Union Berlin:Borussia Dortmund","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"a5d1e5ab-f279-4394-9d92-b9f5fd50a238","away_team_id":"395b5d7d-9cb5-493b-8eb6-d311c88396f2","home":"1. FC Union Berlin","away":"Borussia Dortmund","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:Borussia Dortmund:Eintracht Frankfurt","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"395b5d7d-9cb5-493b-8eb6-d311c88396f2","away_team_id":"a7ed25bf-e454-4000-8bd7-060b092f87d4","home":"Borussia Dortmund","away":"Eintracht Frankfurt","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T16:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:FC Schalke 04:1. FSV Mainz 05","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"8cd7b4ee-9385-40da-a513-fdcd521c142c","away_team_id":"220a32b5-c945-4800-ab8f-f95aafda5faa","home":"FC Schalke 04","away":"1. FSV Mainz 05","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:1. FC Köln:FC Schalke 04","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"b573707c-20ca-4fb9-ae36-45696caf5664","away_team_id":"8cd7b4ee-9385-40da-a513-fdcd521c142c","home":"1. FC Köln","away":"FC Schalke 04","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:SV 07 Elversberg:FC Augsburg","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"f778630e-74b9-4bba-a90f-5eb028405e19","away_team_id":"1ee26940-91f9-4e45-bd5c-4076aa348c08","home":"SV 07 Elversberg","away":"FC Augsburg","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:RB Leipzig:SV 07 Elversberg","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"5f2dc757-af08-4cfe-829b-8bb2980748b3","away_team_id":"f778630e-74b9-4bba-a90f-5eb028405e19","home":"RB Leipzig","away":"SV 07 Elversberg","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:Eintracht Frankfurt:1. FC Köln","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"a7ed25bf-e454-4000-8bd7-060b092f87d4","away_team_id":"b573707c-20ca-4fb9-ae36-45696caf5664","home":"Eintracht Frankfurt","away":"1. FC Köln","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-16T18:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:Borussia Mönchengladbach:TSG 1899 Hoffenheim","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"a0211e04-e59d-48df-8d36-ab1ad59f6368","away_team_id":"2904c9a0-c82f-439b-9236-07bdecc75e90","home":"Borussia Mönchengladbach","away":"TSG 1899 Hoffenheim","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-18T15:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:VfB Stuttgart:Borussia Mönchengladbach","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"fe51aa06-f03a-4cd8-8911-e1e1167b5e8d","away_team_id":"a0211e04-e59d-48df-8d36-ab1ad59f6368","home":"VfB Stuttgart","away":"Borussia Mönchengladbach","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-23T18:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 6:Hamburger SV:VfB Stuttgart","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"15e161e9-39e0-4125-8ca8-b9488d5c530f","away_team_id":"fe51aa06-f03a-4cd8-8911-e1e1167b5e8d","home":"Hamburger SV","away":"VfB Stuttgart","league":"Bundesliga","round":"Matchday 6","kickoff":"2026-10-17T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:1. FSV Mainz 05:SV Werder Bremen","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"220a32b5-c945-4800-ab8f-f95aafda5faa","away_team_id":"6875c107-652e-499c-a7f8-11def74116d2","home":"1. FSV Mainz 05","away":"SV Werder Bremen","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"de:2026:Matchday 7:FC Augsburg:1. FC Union Berlin","season_id":"1239a5db-0a5c-45a3-a229-0087d95689c7","home_team_id":"1ee26940-91f9-4e45-bd5c-4076aa348c08","away_team_id":"a5d1e5ab-f279-4394-9d92-b9f5fd50a238","home":"FC Augsburg","away":"1. FC Union Berlin","league":"Bundesliga","round":"Matchday 7","kickoff":"2026-10-24T13:30:00.000Z","timezone":"Europe/Berlin","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/de.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:Gil Vicente FC:FC Porto","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"ee69b400-f646-4c23-9838-f7bc5fa861ed","away_team_id":"82bd87e9-bedc-409f-a95b-18dcb305c51c","home":"Gil Vicente","away":"FC Porto","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-24T19:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:FC Porto:GD Estoril Praia","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"82bd87e9-bedc-409f-a95b-18dcb305c51c","away_team_id":"7da02c92-39ce-4eb5-b198-323869b6ea4f","home":"FC Porto","away":"Estoril","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-10-31T20:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:CD Santa Clara:Sport Lisboa e Benfica","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"1f37dd1b-9b8a-41cb-835a-0766a8678781","away_team_id":"5b889680-fd84-4254-80c7-cec620281fc2","home":"Santa Clara","away":"SL Benfica","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-26T18:45:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Sport Lisboa e Benfica:FC Alverca","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"5b889680-fd84-4254-80c7-cec620281fc2","away_team_id":"416ee94c-e695-4165-ac3a-afeb727cbdbd","home":"SL Benfica","away":"Alverca","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-02T20:15:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:Sporting Clube de Portugal:Académico de Viseu FC","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"699e0617-da90-47c2-9d71-437bfcf8a779","away_team_id":"d71b34b8-da45-4005-83ae-d6e43d8c72c4","home":"Sporting CP","away":"Academico Viseu","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-25T20:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Casa Pia AC:Sporting Clube de Portugal","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"35a758c6-0841-4f41-8e49-0fc651d85b31","away_team_id":"699e0617-da90-47c2-9d71-437bfcf8a779","home":"Casa Pia","away":"Sporting CP","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-10-30T20:15:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:CS Marítimo:CD Santa Clara","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"e32e3388-413e-4130-8bea-151543f686c8","away_team_id":"1f37dd1b-9b8a-41cb-835a-0766a8678781","home":"Maritimo","away":"Santa Clara","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-01T18:00:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:FC Alverca:FC Arouca","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"416ee94c-e695-4165-ac3a-afeb727cbdbd","away_team_id":"c44a0d3c-2cfb-44a3-8818-fd64357dafe1","home":"Alverca","away":"Arouca","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-24T17:00:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:FC Arouca:CD Nacional","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"c44a0d3c-2cfb-44a3-8818-fd64357dafe1","away_team_id":"445969b8-aa37-470f-9c70-f937910c500c","home":"Arouca","away":"CD National","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-01T15:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Académico de Viseu FC:Rio Ave FC","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"d71b34b8-da45-4005-83ae-d6e43d8c72c4","away_team_id":"88b5fd62-1e39-4a38-9146-0063fbaa3e45","home":"Academico Viseu","away":"Rio Ave","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-01T18:00:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Gil Vicente FC:Vitória Guimarães","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"ee69b400-f646-4c23-9838-f7bc5fa861ed","away_team_id":"d6c800aa-e38c-4e81-ace6-863d8c440c31","home":"Gil Vicente","away":"Vitoria SC","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-02T20:15:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:CD Nacional:Sporting Clube de Braga","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"445969b8-aa37-470f-9c70-f937910c500c","away_team_id":"48788497-ccdd-4b59-9e47-999916d26620","home":"CD National","away":"SC Braga","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-25T18:00:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Sporting Clube de Braga:FC Famalicão","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"48788497-ccdd-4b59-9e47-999916d26620","away_team_id":"3e56b604-8b4c-48ca-859e-bc387b9a3ef8","home":"SC Braga","away":"Famalicao","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-11-01T20:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:CF Estrela da Amadora:Casa Pia AC","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"cfc9e93f-dafa-4c27-96c1-475400acb151","away_team_id":"35a758c6-0841-4f41-8e49-0fc651d85b31","home":"Estrela","away":"Casa Pia","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-24T14:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 10:Moreirense FC:CF Estrela da Amadora","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"c1910dc1-0d85-4dbc-be45-a7d6c117db9e","away_team_id":"cfc9e93f-dafa-4c27-96c1-475400acb151","home":"Moreirense","away":"Estrela","league":"Liga Portugal","round":"Matchday 10","kickoff":"2026-10-31T15:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:GD Estoril Praia:Moreirense FC","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"7da02c92-39ce-4eb5-b198-323869b6ea4f","away_team_id":"c1910dc1-0d85-4dbc-be45-a7d6c117db9e","home":"Estoril","away":"Moreirense","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-25T15:30:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:Vitória Guimarães:CS Marítimo","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"d6c800aa-e38c-4e81-ace6-863d8c440c31","away_team_id":"e32e3388-413e-4130-8bea-151543f686c8","home":"Vitoria SC","away":"Maritimo","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-23T19:45:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"},{"external_key":"pt:2026:Matchday 9:Rio Ave FC:FC Famalicão","season_id":"c784026c-d9e4-4513-a0c3-fcee475a6e14","home_team_id":"88b5fd62-1e39-4a38-9146-0063fbaa3e45","away_team_id":"3e56b604-8b4c-48ca-859e-bc387b9a3ef8","home":"Rio Ave","away":"Famalicao","league":"Liga Portugal","round":"Matchday 9","kickoff":"2026-10-25T18:00:00.000Z","timezone":"Europe/Lisbon","status":"scheduled","source":"https://raw.githubusercontent.com/openfootball/football.json/e6744429ee395bc86f247348c6184bb08d4eb361/2026-27/pt.1.json","existing_id":null,"expected_updated_at":null,"action":"insert"}]$data$::jsonb)LOOP
  IF(e->>'kickoff')::timestamptz<=clock_timestamp()OR NOT EXISTS(SELECT 1 FROM public.seasons s JOIN public.competitions c ON c.id=s.competition_id WHERE s.id=(e->>'season_id')::uuid AND s.start_year=2026 AND s.is_published AND c.is_published)OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(e->>'home_team_id')::uuid AND is_published)OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(e->>'away_team_id')::uuid AND is_published)OR NOT EXISTS(SELECT 1 FROM public.season_teams WHERE season_id=(e->>'season_id')::uuid AND team_id=(e->>'home_team_id')::uuid)OR NOT EXISTS(SELECT 1 FROM public.season_teams WHERE season_id=(e->>'season_id')::uuid AND team_id=(e->>'away_team_id')::uuid)THEN skipped:=skipped+1;CONTINUE;END IF;
  -- Never overwrite an existing pairing, even if the owner has corrected its date manually.
  IF EXISTS(SELECT 1 FROM public.arena_calendar_refs WHERE external_key=e->>'external_key')OR EXISTS(SELECT 1 FROM public.matches WHERE season_id=(e->>'season_id')::uuid AND home_team_id=(e->>'home_team_id')::uuid AND away_team_id=(e->>'away_team_id')::uuid)THEN skipped:=skipped+1;CONTINUE;END IF;
  INSERT INTO public.matches(season_id,round,kickoff,home_team_id,away_team_id,status,source,verified_at,comment,is_published)
  VALUES((e->>'season_id')::uuid,e->>'round',(e->>'kickoff')::timestamptz,(e->>'home_team_id')::uuid,(e->>'away_team_id')::uuid,'scheduled',e->>'source',now(),'Calendrier OpenFootball CC0 ; heure locale '||(e->>'timezone')||'.',true)RETURNING id INTO mid;
  INSERT INTO public.arena_calendar_refs VALUES(e->>'external_key',mid,e->>'source',e->>'timezone',now());n:=n+1;
 END LOOP;
 INSERT INTO public.arena_calendar_runs VALUES(seed_nonce,null,jsonb_build_object('added',n,'conservedOrExpired',skipped,'sourceCommit','e6744429ee395bc86f247348c6184bb08d4eb361','method','owner-sql-initial-calendar'),now());
END $seed$;

NOTIFY pgrst,'reload schema';
COMMIT;
