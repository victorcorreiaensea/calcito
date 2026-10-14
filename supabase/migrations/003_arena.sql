-- CALCITO V5: all money is fictitious, represented by integer centimes.
-- Requires migrations 001 and 002. Run once in the Supabase SQL Editor.
BEGIN;
CREATE TABLE public.arena_wallets (
    user_id uuid PRIMARY KEY REFERENCES auth.users (id),
    available bigint NOT NULL DEFAULT 20000 CHECK (available >= 0),
    reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    debt bigint NOT NULL DEFAULT 0 CHECK (debt >= 0),
    xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.arena_bank (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    available bigint NOT NULL CHECK (available >= 0),
    reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    debt bigint NOT NULL DEFAULT 0 CHECK (debt >= 0)
);
INSERT INTO public.arena_bank (available)
    VALUES (200000);
CREATE TABLE public.arena_model (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version text NOT NULL DEFAULT 'poisson-goals-v1',
    enabled boolean NOT NULL DEFAULT FALSE,
    mix numeric NOT NULL DEFAULT.5,
    trained_at timestamptz,
    report jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO public.arena_model (singleton)
    VALUES (TRUE);
CREATE TABLE public.arena_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    creator uuid NOT NULL REFERENCES auth.users (id),
    match_id uuid NOT NULL REFERENCES public.matches (id),
    market text NOT NULL,
    forecast jsonb NOT NULL,
    probability numeric NOT NULL CHECK (probability > 0 AND probability < 1),
    odds numeric NOT NULL CHECK (odds >= 1 AND odds <= 1000),
    model_version text NOT NULL,
    model_at timestamptz NOT NULL,
    match_revision timestamptz NOT NULL,
    kickoff timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE TABLE public.arena_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES public.arena_wallets (user_id),
    nonce uuid NOT NULL,
    request_hash text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('challenge', 'bookmaker')),
    stake bigint NOT NULL CHECK (stake > 0),
    user_risk bigint NOT NULL CHECK (user_risk > 0),
    bot_risk bigint NOT NULL CHECK (bot_risk > 0),
    odds numeric NOT NULL CHECK (odds >= 1 AND odds <= 1000000),
    probability numeric NOT NULL CHECK (probability > 0 AND probability < 1),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'void')),
    user_credit bigint NOT NULL DEFAULT 0,
    bot_credit bigint NOT NULL DEFAULT 0,
    earned_xp bigint NOT NULL DEFAULT 0,
    result_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    UNIQUE (user_id, nonce)
);
CREATE TABLE public.arena_legs (
    ticket_id uuid NOT NULL REFERENCES public.arena_tickets (id),
    quote_id uuid NOT NULL REFERENCES public.arena_quotes (id),
    match_id uuid NOT NULL REFERENCES public.matches (id),
    market text NOT NULL,
    odds numeric NOT NULL,
    probability numeric NOT NULL,
    voided boolean NOT NULL DEFAULT FALSE,
    PRIMARY KEY (ticket_id, match_id)
);
CREATE TABLE public.arena_ledger (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.arena_wallets (user_id),
    ticket_id uuid REFERENCES public.arena_tickets (id),
    kind text NOT NULL,
    amount bigint NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.arena_missions (
    user_id uuid NOT NULL REFERENCES public.arena_wallets (user_id),
    mission text NOT NULL,
    period text NOT NULL,
    reward bigint NOT NULL,
    xp bigint NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, mission, period)
);
CREATE TABLE public.arena_corrections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_id uuid NOT NULL REFERENCES public.matches (id),
    actor uuid NOT NULL REFERENCES auth.users (id),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.arena_corrections FROM public, anon, authenticated;
ALTER TABLE public.arena_corrections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.arena_rejections (
    user_id uuid NOT NULL REFERENCES auth.users (id),
    nonce uuid NOT NULL,
    request_hash text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, nonce)
);
CREATE INDEX arena_legs_match ON public.arena_legs (match_id);
CREATE INDEX arena_tickets_user ON public.arena_tickets (user_id, created_at);
CREATE INDEX arena_ledger_user ON public.arena_ledger (user_id, created_at);
DO $$
DECLARE
    n text;
BEGIN
    foreach n IN ARRAY ARRAY['arena_wallets', 'arena_bank', 'arena_model', 'arena_quotes', 'arena_tickets', 'arena_legs', 'arena_ledger', 'arena_missions', 'arena_rejections'] LOOP
        EXECUTE format('alter table public.%I enable row level security', n);
        EXECUTE format('revoke all on public.%I from anon,authenticated', n);
    END LOOP;
END
$$;
GRANT SELECT ON public.arena_wallets, public.arena_tickets, public.arena_legs, public.arena_ledger, public.arena_missions, public.arena_rejections TO authenticated;
CREATE POLICY own_wallet ON public.arena_wallets
    FOR SELECT TO authenticated
    USING (user_id = auth.uid ());
CREATE POLICY own_tickets ON public.arena_tickets
    FOR SELECT TO authenticated
    USING (user_id = auth.uid ());
CREATE POLICY own_legs ON public.arena_legs
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT
            1
        FROM
            public.arena_tickets t
        WHERE
            t.id = ticket_id
            AND t.user_id = auth.uid ()));
CREATE POLICY own_ledger ON public.arena_ledger
    FOR SELECT TO authenticated
    USING (user_id = auth.uid ());
CREATE POLICY own_missions ON public.arena_missions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid ());
CREATE POLICY own_rejections ON public.arena_rejections
    FOR SELECT TO authenticated
    USING (user_id = auth.uid ());
CREATE FUNCTION public._arena_lock ()
    RETURNS void
    LANGUAGE sql
    AS $$
    SELECT
        pg_advisory_xact_lock(593817452)
$$;
CREATE FUNCTION public._arena_limit (bankroll bigint)
    RETURNS bigint
    LANGUAGE sql
    IMMUTABLE
    AS $$
    SELECT
        least (1000, greatest (0, bankroll / 20))
$$;
CREATE FUNCTION public._arena_account ()
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid := auth.uid ();
BEGIN
    IF u IS NULL THEN
        RAISE EXCEPTION 'Connexion requise'
            USING errcode = '42501';
    END IF;
    INSERT INTO arena_wallets (user_id)
        VALUES (u)
    ON CONFLICT
        DO NOTHING;
    IF found THEN
        INSERT INTO arena_ledger (user_id, kind, amount)
            VALUES (u, 'welcome', 20000);
    END IF;
    RETURN u;
END
$$;
-- All helpers are private; clients can never select amounts to credit.
CREATE FUNCTION public._arena_adjust (u uuid, delta bigint, xp_delta bigint DEFAULT 0)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    w arena_wallets;
    pay bigint;
BEGIN
    SELECT
        *
    INTO
        STRICT w
    FROM
        arena_wallets
    WHERE
        user_id = u
    FOR UPDATE;
    IF delta >= 0 THEN
        pay := least (delta, w.debt);
        UPDATE
            arena_wallets
        SET
            debt = debt - pay,
            available = available + delta - pay,
            xp = greatest (0, xp + xp_delta)
        WHERE
            user_id = u;
    ELSE
        pay := least (w.available, - delta);
        UPDATE
            arena_wallets
        SET
            available = available - pay,
            debt = debt + (- delta - pay),
            xp = greatest (0, xp + xp_delta)
        WHERE
            user_id = u;
    END IF;
END
$$;
CREATE FUNCTION public._arena_adjust_bank (delta bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    b arena_bank;
    pay bigint;
BEGIN
    SELECT
        *
    INTO
        STRICT b
    FROM
        arena_bank
    FOR UPDATE;
    IF delta >= 0 THEN
        pay := least (delta, b.debt);
        UPDATE
            arena_bank
        SET
            debt = debt - pay,
            available = available + delta - pay;
    ELSE
        pay := least (b.available, - delta);
        UPDATE
            arena_bank
        SET
            available = available - pay,
            debt = debt + (- delta - pay);
    END IF;
END
$$;
CREATE VIEW public.arena_verified_results AS
SELECT
    m.*
FROM
    public.matches m
    JOIN public.seasons s ON s.id = m.season_id
    JOIN public.competitions c ON c.id = s.competition_id
    JOIN public.teams h ON h.id = m.home_team_id
    JOIN public.teams a ON a.id = m.away_team_id
WHERE
    m.is_published
    AND s.is_published
    AND c.is_published
    AND h.is_published
    AND a.is_published
    AND m.status = 'finished'
    AND m.verified_at IS NOT NULL
    AND m.goals_home IS NOT NULL
    AND m.goals_away IS NOT NULL
    AND m.kickoff <= now();
REVOKE ALL ON public.arena_verified_results FROM public, anon, authenticated;
-- Expected goals from strictly earlier, verified, published results; no form-to-probability shortcut.
CREATE FUNCTION public._arena_probs (mid uuid, weight numeric, cutoff timestamptz)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    m matches;
    lh numeric;
    la numeric;
    hf numeric;
    ha numeric;
    af numeric;
    aa numeric;
    n integer;
    ph numeric[] := ARRAY[]::numeric[];
    pa numeric[] := ARRAY[]::numeric[];
    p numeric;
    home numeric := 0;
    draw numeric := 0;
    away numeric := 0;
    norm numeric;
    outp jsonb := '{}';
    i integer;
    j integer;
    v numeric;
    total integer;
BEGIN
    SELECT
        *
    INTO
        m
    FROM
        matches
    WHERE
        id = mid;
    IF NOT found THEN
        RETURN NULL;
    END IF;
    SELECT
        count(*),
        avg(goals_home),
        avg(goals_away)
    INTO
        n,
        lh,
        la
    FROM
        arena_verified_results
    WHERE
        season_id = m.season_id
        AND is_published
        AND verified_at IS NOT NULL
        AND status = 'finished'
        AND goals_home IS NOT NULL
        AND goals_away IS NOT NULL
        AND (kickoff at time zone 'UTC')::date < (cutoff at time zone 'UTC')::date;
    IF n < 30 THEN
        RETURN NULL;
    END IF;
    SELECT
        count(*),
        avg(gf),
        avg(ga)
    INTO
        n,
        hf,
        ha
    FROM (
        SELECT
            CASE WHEN home_team_id = m.home_team_id THEN
                goals_home
            ELSE
                goals_away
            END gf,
            CASE WHEN home_team_id = m.home_team_id THEN
                goals_away
            ELSE
                goals_home
            END ga
        FROM
            arena_verified_results x
            JOIN seasons s ON s.id = x.season_id
        WHERE
            s.start_year = (
                SELECT
                    start_year
                FROM
                    seasons
                WHERE
                    id = m.season_id)
                AND x.is_published
                AND x.verified_at IS NOT NULL
                AND x.status = 'finished'
                AND x.goals_home IS NOT NULL
                AND x.goals_away IS NOT NULL
                AND m.home_team_id IN (x.home_team_id, x.away_team_id)
                AND (x.kickoff at time zone 'UTC')::date < (cutoff at time zone 'UTC')::date
            ORDER BY
                x.kickoff DESC,
                x.id
            LIMIT 5) r;
    IF n < 5 THEN
        RETURN NULL;
    END IF;
    SELECT
        count(*),
        avg(gf),
        avg(ga)
    INTO
        n,
        af,
        aa
    FROM (
        SELECT
            CASE WHEN home_team_id = m.away_team_id THEN
                goals_home
            ELSE
                goals_away
            END gf,
            CASE WHEN home_team_id = m.away_team_id THEN
                goals_away
            ELSE
                goals_home
            END ga
        FROM
            arena_verified_results x
            JOIN seasons s ON s.id = x.season_id
        WHERE
            s.start_year = (
                SELECT
                    start_year
                FROM
                    seasons
                WHERE
                    id = m.season_id)
                AND x.is_published
                AND x.verified_at IS NOT NULL
                AND x.status = 'finished'
                AND x.goals_home IS NOT NULL
                AND x.goals_away IS NOT NULL
                AND m.away_team_id IN (x.home_team_id, x.away_team_id)
                AND (x.kickoff at time zone 'UTC')::date < (cutoff at time zone 'UTC')::date
            ORDER BY
                x.kickoff DESC,
                x.id
            LIMIT 5) r;
    IF n < 5 THEN
        RETURN NULL;
    END IF;
    lh := greatest (.2, least (4.5, (1 - weight) * lh + weight * (hf + aa) / 2));
    la := greatest (.2, least (4.5, (1 - weight) * la + weight * (af + ha) / 2));
    ph := ARRAY[exp(- lh)];
    pa := ARRAY[exp(- la)];
    FOR i IN 1..20 LOOP
        ph := array_append(ph, ph[i] * lh / i);
        pa := array_append(pa, pa[i] * la / i);
    END LOOP;
    norm := 0;
    FOR i IN 0..20 LOOP
        FOR j IN 0..20 LOOP
            p := ph[i + 1] * pa[j + 1];
            norm := norm + p;
            IF i > j THEN
                home := home + p;
            ELSIF i = j THEN
                draw := draw + p;
            ELSE
                away := away + p;
            END IF;
        END LOOP;
    END LOOP;
    outp := jsonb_build_object('home', home / norm, 'draw', draw / norm, 'away', away / norm, '1x', (home + draw) / norm, '12', (home + away) / norm, 'x2', (draw + away) / norm);
    foreach total IN ARRAY ARRAY[1, 2, 3] LOOP
        v := 0;
        FOR i IN 0..20 LOOP
            FOR j IN 0..20 LOOP
                IF i + j > total THEN
                    v := v + ph[i + 1] * pa[j + 1] / norm;
                END IF;
            END LOOP;
        END LOOP;
        outp := outp || jsonb_build_object('over_' || total || '_5', v, 'under_' || total || '_5', 1 - v);
    END LOOP;
    v := 0;
    FOR i IN 1..20 LOOP
        FOR j IN 1..20 LOOP
            v := v + ph[i + 1] * pa[j + 1] / norm;
        END LOOP;
    END LOOP;
    outp := outp || jsonb_build_object('btts_yes', v, 'btts_no', 1 - v, 'home_cs', pa[1] / (
            SELECT
                sum(x)
            FROM unnest(pa) x), 'away_cs', ph[1] / (
            SELECT
                sum(x)
            FROM unnest(ph) x));
    FOR i IN 0..5 LOOP
        outp := outp || jsonb_build_object('home_goals_' || i, ph[i + 1] / (
                SELECT
                    sum(x)
                FROM unnest(ph) x), 'away_goals_' || i, pa[i + 1] / (
                SELECT
                    sum(x)
                FROM unnest(pa) x));
    END LOOP;
    RETURN outp;
END
$$;
CREATE FUNCTION public._arena_outcome (mid uuid, key text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    m matches;
    v boolean;
BEGIN
    SELECT
        *
    INTO
        m
    FROM
        matches
    WHERE
        id = mid;
    IF m.status IN ('cancelled', 'postponed') THEN
        RETURN -1;
    END IF;
    IF m.kickoff > clock_timestamp() OR NOT m.is_published OR m.status <> 'finished' OR m.verified_at IS NULL OR m.goals_home IS NULL OR m.goals_away IS NULL THEN
        RETURN NULL;
    END IF;
    CASE key
    WHEN 'home' THEN
        v := m.goals_home > m.goals_away;
    WHEN 'draw' THEN
        v := m.goals_home = m.goals_away;
    WHEN 'away' THEN
        v := m.goals_home < m.goals_away;
    WHEN '1x' THEN
        v := m.goals_home >= m.goals_away;
    WHEN '12' THEN
        v := m.goals_home <> m.goals_away;
    WHEN 'x2' THEN
        v := m.goals_home <= m.goals_away;
    WHEN 'btts_yes' THEN
        v := m.goals_home > 0
        AND m.goals_away > 0;
    WHEN 'btts_no' THEN
        v := m.goals_home = 0
        OR m.goals_away = 0;
    WHEN 'home_cs' THEN
        v := m.goals_away = 0;
    WHEN 'away_cs' THEN
        v := m.goals_home = 0;
    ELSE
        IF key ~ '^over_[123]_5$' THEN
                v := m.goals_home + m.goals_away > split_part(key, '_', 2)::int;
    ELSIF key ~ '^under_[123]_5$' THEN
                v := m.goals_home + m.goals_away <= split_part(key, '_', 2)::int;
    ELSIF key ~ '^home_goals_[0-5]$' THEN
                v := m.goals_home = split_part(key, '_', 3)::int;
    ELSIF key ~ '^away_goals_[0-5]$' THEN
                v := m.goals_away = split_part(key, '_', 3)::int;
    ELSE
        RAISE EXCEPTION 'Marché non pris en charge';
            END IF;
    END CASE;
    RETURN CASE WHEN v THEN
        1
    ELSE
        0
    END;
END
$$;
CREATE FUNCTION public.arena_calibrate ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    weights numeric[] := ARRAY[.25,.5,.75];
    w numeric;
    m matches;
    probs jsonb;
    k text;
    p numeric;
    count_train integer;
    count_val integer;
    loss numeric;
    best_loss numeric := 100;
    best numeric :=.5;
    split timestamptz;
    val_loss numeric := 0;
    base_loss numeric := 0;
    val_brier numeric := 0;
    base_brier numeric := 0;
    eligible integer := 0;
    result_report jsonb;
    hits jsonb := '{}';
    train_n integer := 0;
    market_key text;
    market_p numeric;
    baseline numeric;
    truth integer;
    score_model jsonb := '{}';
    score_base jsonb := '{}';
    supported jsonb := '["home","draw","away"]';
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    PERFORM
        _arena_lock ();
    -- A strict date split prevents fixtures of the same day leaking into training.
    SELECT
        kickoff
    INTO
        split
    FROM (
        SELECT
            kickoff
        FROM
            arena_verified_results
        WHERE
            is_published
            AND verified_at IS NOT NULL
            AND status = 'finished'
            AND goals_home IS NOT NULL
            AND goals_away IS NOT NULL
            AND kickoff < now()
        ORDER BY
            kickoff DESC OFFSET 79
        LIMIT 1) r;
    IF split IS NULL THEN
        result_report := jsonb_build_object('enabled', FALSE, 'reason', 'Au moins 80 résultats récents et un historique antérieur sont nécessaires.');
        UPDATE
            arena_model
        SET
            enabled = FALSE,
            report = result_report,
            trained_at = now();
        RETURN result_report;
    END IF;
    foreach w IN ARRAY weights LOOP
        count_train := 0;
        loss := 0;
        FOR m IN
        SELECT
            *
        FROM
            arena_verified_results
        WHERE
            is_published
            AND verified_at IS NOT NULL
            AND status = 'finished'
            AND (kickoff at time zone 'UTC')::date < (split at time zone 'UTC')::date
            AND goals_home IS NOT NULL
            AND goals_away IS NOT NULL
        ORDER BY
            kickoff,
            id LOOP
                probs := _arena_probs (m.id, w, m.kickoff);
                IF probs IS NULL THEN
                    CONTINUE;
                END IF;
                k := CASE WHEN m.goals_home > m.goals_away THEN
                    'home'
                WHEN m.goals_home = m.goals_away THEN
                    'draw'
                ELSE
                    'away'
                END;
                p := (probs ->> k)::numeric;
                loss := loss - ln(greatest (.000001, p));
                count_train := count_train + 1;
            END LOOP;
        IF count_train >= 100 AND loss / count_train < best_loss THEN
            best_loss := loss / count_train;
            best := w;
        END IF;
    END LOOP;
    train_n := 0;
    FOR m IN
    SELECT
        *
    FROM
        arena_verified_results
    WHERE (kickoff at time zone 'UTC')::date < (split at time zone 'UTC')::date
ORDER BY
    kickoff,
    id LOOP
        probs := _arena_probs (m.id, best, m.kickoff);
        IF probs IS NULL THEN
            CONTINUE;
        END IF;
        train_n := train_n + 1;
        FOR market_key,
        market_p IN
        SELECT
            key,
            value::numeric
        FROM
            jsonb_each_text(probs)
            LOOP
                truth := _arena_outcome (m.id, market_key);
                hits := jsonb_set(hits, ARRAY[market_key], to_jsonb (coalesce((hits ->> market_key)::numeric, 0) + truth));
            END LOOP;
    END LOOP;
    count_val := 0;
    FOR m IN
    SELECT
        *
    FROM
        arena_verified_results
    WHERE
        is_published
        AND verified_at IS NOT NULL
        AND status = 'finished'
        AND (kickoff at time zone 'UTC')::date >= (split at time zone 'UTC')::date
        AND kickoff < now()
        AND goals_home IS NOT NULL
        AND goals_away IS NOT NULL
    ORDER BY
        kickoff,
        id LOOP
            probs := _arena_probs (m.id, best, m.kickoff);
            IF probs IS NULL THEN
                CONTINUE;
            END IF;
            k := CASE WHEN m.goals_home > m.goals_away THEN
                'home'
            WHEN m.goals_home = m.goals_away THEN
                'draw'
            ELSE
                'away'
            END;
            val_loss := val_loss - ln(greatest (.000001, (probs ->> k)::numeric));
            base_loss := base_loss - ln(
                CASE k
                WHEN 'home' THEN
.45
                WHEN 'draw' THEN
.27
                ELSE
.28
                END);
            val_brier := val_brier + ((probs ->> 'home')::numeric - CASE WHEN k = 'home' THEN
                1
            ELSE
                0
            END) ^ 2 + ((probs ->> 'draw')::numeric - CASE WHEN k = 'draw' THEN
                1
            ELSE
                0
            END) ^ 2 + ((probs ->> 'away')::numeric - CASE WHEN k = 'away' THEN
                1
            ELSE
                0
            END) ^ 2;
            base_brier := base_brier + (.45 - CASE WHEN k = 'home' THEN
                    1
                ELSE
                    0
                END) ^ 2 + (.27 - CASE WHEN k = 'draw' THEN
                    1
                ELSE
                    0
                END) ^ 2 + (.28 - CASE WHEN k = 'away' THEN
                    1
                ELSE
                    0
                END) ^ 2;
            FOR market_key,
            market_p IN
            SELECT
                key,
                value::numeric
            FROM
                jsonb_each_text(probs)
                LOOP
                    truth := _arena_outcome (m.id, market_key);
                    baseline := (coalesce((hits ->> market_key)::numeric, 0) + 1) / (train_n + 2);
                    score_model := jsonb_set(score_model, ARRAY[market_key], to_jsonb (coalesce((score_model ->> market_key)::numeric, 0) - ln(greatest (.000001, CASE WHEN truth = 1 THEN
                                    market_p
                                ELSE
                                    1 - market_p
                                END))));
                    score_base := jsonb_set(score_base, ARRAY[market_key], to_jsonb (coalesce((score_base ->> market_key)::numeric, 0) - ln(greatest (.000001, CASE WHEN truth = 1 THEN
                                    baseline
                                ELSE
                                    1 - baseline
                                END))));
                END LOOP;
            count_val := count_val + 1;
        END LOOP;
    FOR market_key,
    market_p IN
    SELECT
        key,
        value::numeric
    FROM
        jsonb_each_text(score_model)
        LOOP
            IF market_key NOT IN ('home', 'draw', 'away') AND market_p <= (score_base ->> market_key)::numeric THEN
                supported := supported || jsonb_build_array(market_key);
            END IF;
        END LOOP;
    result_report := jsonb_build_object('markets', supported, 'marketLogLoss', score_model, 'marketBaselineLogLoss', score_base, 'version', 'poisson-goals-v1', 'training', count_train, 'validation', count_val, 'mix', best, 'logLoss', CASE WHEN count_val > 0 THEN
            val_loss / count_val
        END, 'baselineLogLoss', CASE WHEN count_val > 0 THEN
            base_loss / count_val
        END, 'brier', CASE WHEN count_val > 0 THEN
            val_brier / count_val
        END, 'baselineBrier', CASE WHEN count_val > 0 THEN
            base_brier / count_val
        END, 'enabled', best_loss < 100
        AND count_val >= 60
        AND val_loss <= base_loss
        AND val_brier <= base_brier, 'reason', 'Validation chronologique : minimum 100 apprentissage / 60 contrôle ; LogLoss et Brier au moins aussi bons que la référence fixe 45/27/28.');
    UPDATE
        arena_model
    SET
        enabled = (result_report ->> 'enabled')::boolean,
        mix = best,
        trained_at = now(),
        report = result_report;
    RETURN result_report;
END
$$;
CREATE FUNCTION public.arena_status ()
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT
        jsonb_build_object('installed', TRUE, 'model', report, 'enabled', enabled, 'version', version, 'trainedAt', trained_at, 'botLimit', CASE WHEN b.debt = 0 THEN
                _arena_limit (b.available)
            ELSE
                0
            END)
    FROM
        arena_model
    CROSS JOIN arena_bank b
$$;
CREATE FUNCTION public._arena_performance (u uuid)
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    SELECT
        coalesce(jsonb_agg(jsonb_build_object('date', kickoff, 'match', match_id, 'player', _arena_outcome (match_id, market), 'calcito', _arena_outcome (match_id, CASE WHEN (forecast ->> 'home')::numeric >= (forecast ->> 'draw')::numeric
                            AND (forecast ->> 'home')::numeric >= (forecast ->> 'away')::numeric THEN
                            'home'
                        WHEN (forecast ->> 'draw')::numeric >= (forecast ->> 'away')::numeric THEN
                            'draw'
                        ELSE
                            'away'
                        END))
            ORDER BY kickoff), '[]')
    FROM ( SELECT DISTINCT ON (l.match_id)
            l.match_id,
            l.market,
            q.forecast,
            m.kickoff
        FROM
            arena_legs l
            JOIN arena_tickets t ON t.id = l.ticket_id
            JOIN arena_quotes q ON q.id = l.quote_id
            JOIN matches m ON m.id = l.match_id
        WHERE
            t.user_id = u
            AND t.mode = 'challenge'
            AND l.market IN ('home', 'draw', 'away')
            AND NOT l.voided
            AND _arena_outcome (l.match_id, l.market) IN (0, 1)
        ORDER BY
            l.match_id,
            t.created_at,
            t.id) x
$$;
CREATE FUNCTION public.arena_account ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid;
    w arena_wallets;
BEGIN
    PERFORM
        _arena_lock ();
    u := _arena_account ();
    SELECT
        *
    INTO
        w
    FROM
        arena_wallets
    WHERE
        user_id = u;
    RETURN jsonb_build_object('wallet', to_jsonb (w), 'performance', _arena_performance (u), 'limit', CASE WHEN w.debt = 0 THEN
            _arena_limit (w.available)
        ELSE
            0
        END, 'tickets', (
            SELECT
                coalesce(jsonb_agg(to_jsonb (t) || jsonb_build_object('legs', (
                            SELECT
                                jsonb_agg(to_jsonb (l) || jsonb_build_object('home_name', h.name, 'away_name', a.name))
                            FROM arena_legs l
                            JOIN matches m ON m.id = l.match_id
                            JOIN teams h ON h.id = m.home_team_id
                            JOIN teams a ON a.id = m.away_team_id
                            WHERE
                                l.ticket_id = t.id))
                    ORDER BY t.created_at DESC), '[]')
                FROM (
                    SELECT
                        *
                    FROM arena_tickets
                WHERE
                    user_id = u ORDER BY created_at DESC LIMIT 100) t), 'transactions', (
        SELECT
            coalesce(jsonb_agg(l ORDER BY l.created_at DESC), '[]')
        FROM (
            SELECT
                *
            FROM arena_ledger
        WHERE
            user_id = u ORDER BY created_at DESC, id DESC LIMIT 100) l), 'missions', (
    SELECT
        coalesce(jsonb_agg(r), '[]')
    FROM arena_missions r
WHERE
    user_id = u), 'stats', (
    SELECT
        jsonb_build_object('accepted', count(*), 'won', count(*) FILTER (WHERE status = 'won'), 'lost', count(*) FILTER (WHERE status = 'lost'), 'pending', count(*) FILTER (WHERE status = 'open'), 'returns', coalesce(sum(user_credit) FILTER (WHERE status IN ('won', 'lost')), 0), 'riskSettled', coalesce(sum(user_risk) FILTER (WHERE status IN ('won', 'lost')), 0))
FROM arena_tickets
WHERE
    user_id = u));
END
$$;
CREATE FUNCTION public.arena_quote (mid uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    m matches;
    cfg arena_model;
    probs jsonb;
    k text;
    p numeric;
    q arena_quotes;
    outq jsonb := '[]';
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION 'Connexion requise'
            USING errcode = '42501';
    END IF;
    PERFORM
        _arena_lock ();
    IF (
        SELECT
            count(*)
        FROM
            arena_quotes
        WHERE
            creator = auth.uid ()
            AND created_at > now() - interval '1 hour') > 500 THEN
        RAISE EXCEPTION 'Trop de demandes de cotes : réessayez plus tard';
    END IF;
    SELECT
        *
    INTO
        m
    FROM
        matches
    WHERE
        id = mid
        AND is_published
        AND status = 'scheduled'
        AND kickoff > now()
        AND coalesce(comment, '')
        NOT LIKE '%Heure non renseignée%';
    IF NOT found THEN
        RETURN jsonb_build_object('quotes', outq, 'reason', 'Rencontre publiée, horaire précis et statut à venir requis.');
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
        RETURN jsonb_build_object('quotes', outq, 'reason', 'Participants ou compétition non publiés');
    END IF;
    SELECT
        *
    INTO
        cfg
    FROM
        arena_model;
    IF NOT cfg.enabled THEN
        RETURN jsonb_build_object('quotes', outq, 'reason', 'Modèle non validé : aucune cote de jeu n’est proposée.');
    END IF;
    probs := _arena_probs (mid, cfg.mix, least (now(), m.kickoff));
    IF probs IS NULL THEN
        RETURN jsonb_build_object('quotes', outq, 'reason', 'Données insuffisantes : cinq résultats par équipe et trente résultats de championnat requis.');
    END IF;
    FOR k,
    p IN
    SELECT
        key,
        value::numeric
    FROM
        jsonb_each_text(probs)
        LOOP
            IF p >=.02 AND p <=.98 AND cfg.report -> 'markets' ? k THEN
                INSERT INTO arena_quotes (creator, match_id, market, forecast, probability, odds, model_version, model_at, match_revision, kickoff, expires_at)
                    VALUES (auth.uid (), mid, k, jsonb_build_object('home', probs -> 'home', 'draw', probs -> 'draw', 'away', probs -> 'away'), p, floor(1000000 / p) / 1000000, cfg.version, cfg.trained_at, m.updated_at, m.kickoff, least (now() + interval '15 minutes', m.kickoff))
                RETURNING
                    *
                INTO
                    q;
                outq := outq || jsonb_build_array(to_jsonb (q));
            END IF;
        END LOOP;
    RETURN jsonb_build_object('quotes', outq, 'forecast', jsonb_build_object('home', probs -> 'home', 'draw', probs -> 'draw', 'away', probs -> 'away'), 'model', cfg.version, 'approximation', 'Combinés : approximation sous indépendance, équipes distinctes obligatoires.');
END
$$;
CREATE FUNCTION public.arena_place_ticket (selection uuid[], amount bigint, mode text, offered_odds numeric, client_nonce uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid;
    w arena_wallets;
    b arena_bank;
    cfg arena_model;
    q arena_quotes;
    m matches;
    total numeric := 1;
    prob numeric := 1;
    user_risk bigint;
    bot_risk bigint;
    gross bigint;
    t arena_tickets;
    hash text;
    used uuid[] := ARRAY[]::uuid[];
    games uuid[] := ARRAY[]::uuid[];
    qid uuid;
    reject_reason text;
    previous_hash text;
BEGIN
    PERFORM
        _arena_lock ();
    u := _arena_account ();
    hash := md5(jsonb_build_object('selection', selection, 'amount', amount, 'mode', mode, 'odds', offered_odds)::text);
    IF client_nonce IS NULL THEN
        RAISE EXCEPTION 'Identifiant de requête requis';
    END IF;
    SELECT
        *
    INTO
        t
    FROM
        arena_tickets
    WHERE
        user_id = u
        AND nonce = client_nonce;
    IF found THEN
        IF t.request_hash <> hash THEN
            RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre requête';
        END IF;
        RETURN jsonb_build_object('accepted', TRUE, 'ticket', to_jsonb (t), 'replayed', TRUE);
    END IF;
    SELECT
        reason,
        request_hash
    INTO
        reject_reason,
        previous_hash
    FROM
        arena_rejections
    WHERE
        user_id = u
        AND nonce = client_nonce;
    IF found THEN
        IF previous_hash <> hash THEN
            RAISE EXCEPTION 'Identifiant déjà utilisé';
        END IF;
        RETURN jsonb_build_object('accepted', FALSE, 'reason', reject_reason);
    END IF;
    IF mode NOT IN ('challenge', 'bookmaker') OR mode IS NULL OR amount IS NULL OR amount < 1 OR amount > 1000 OR coalesce(cardinality(selection), 0) < 1 OR cardinality(selection) > 10 OR (mode = 'bookmaker' AND cardinality(selection) <> 1) THEN
        RAISE EXCEPTION 'Ticket ou mise invalide';
    END IF;
    SELECT
        *
    INTO
        w
    FROM
        arena_wallets
    WHERE
        user_id = u
    FOR UPDATE;
    SELECT
        *
    INTO
        b
    FROM
        arena_bank
    FOR UPDATE;
    SELECT
        *
    INTO
        cfg
    FROM
        arena_model;
    IF NOT cfg.enabled THEN
        RAISE EXCEPTION 'Modèle non validé';
    END IF;
    foreach qid IN ARRAY selection LOOP
        SELECT
            *
        INTO
            q
        FROM
            arena_quotes
        WHERE
            id = qid;
        IF NOT found OR q.creator <> u OR q.expires_at <= clock_timestamp() OR q.model_at <> cfg.trained_at OR q.model_version <> cfg.version THEN
            RAISE EXCEPTION 'Cote expirée : recharger les rencontres';
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
            RAISE EXCEPTION 'Rencontre verrouillée ou modifiée';
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
            RAISE EXCEPTION 'Participants ou compétition non publiés';
        END IF;
        IF m.id = ANY (games) OR m.home_team_id = ANY (used) OR m.away_team_id = ANY (used) THEN
            RAISE EXCEPTION 'Sélections corrélées : une rencontre et des équipes distinctes sont requises';
        END IF;
        games := array_append(games, m.id);
        used := used || ARRAY[m.home_team_id, m.away_team_id];
        total := total * q.odds;
        prob := prob * q.probability;
    END LOOP;
    IF total > 1000000 THEN
        RAISE EXCEPTION 'Cote totale hors limite';
    END IF;
    IF mode = 'bookmaker' THEN
        IF offered_odds IS NULL OR offered_odds < 1.01 OR offered_odds > 1000 THEN
            RAISE EXCEPTION 'Cote proposée invalide';
        END IF;
        total := offered_odds;
        IF prob * total <= 1.05 THEN
            reject_reason := 'Calcito refuse : rendement théorique insuffisant (seuil +5 %). Aucun engagement.';
            INSERT INTO arena_rejections
                VALUES (u, client_nonce, hash, reject_reason, now());
            RETURN jsonb_build_object('accepted', FALSE, 'reason', reject_reason);
        END IF;
    END IF;
    gross := floor(amount * total);
    IF mode = 'challenge' THEN
        user_risk := amount;
        bot_risk := gross - amount;
    ELSE
        user_risk := gross - amount;
        bot_risk := amount;
    END IF;
    IF user_risk < 1 OR bot_risk < 1 OR w.debt > 0 OR b.debt > 0 OR user_risk > _arena_limit (w.available) OR bot_risk > _arena_limit (b.available) THEN
        RAISE EXCEPTION 'Limite de 5 %% / 10 Calcithunes ou budget de responsabilité dépassé';
    END IF;
    INSERT INTO arena_tickets (user_id, nonce, request_hash, mode, stake, user_risk, bot_risk, odds, probability)
        VALUES (u, client_nonce, hash, mode, amount, user_risk, bot_risk, total, prob)
    RETURNING
        *
    INTO
        t;
    foreach qid IN ARRAY selection LOOP
        SELECT
            *
        INTO
            q
        FROM
            arena_quotes
        WHERE
            id = qid;
        INSERT INTO arena_legs (ticket_id, quote_id, match_id, market, odds, probability)
            VALUES (t.id, q.id, q.match_id, q.market, CASE WHEN mode = 'bookmaker' THEN
                    total
                ELSE
                    q.odds
                END, q.probability);
    END LOOP;
    UPDATE
        arena_wallets
    SET
        available = available - user_risk,
        reserved = reserved + user_risk
    WHERE
        user_id = u;
    UPDATE
        arena_bank
    SET
        available = available - bot_risk,
        reserved = reserved + bot_risk;
    INSERT INTO arena_ledger (user_id, ticket_id, kind, amount, detail)
        VALUES (u, t.id, 'reserve', - user_risk, jsonb_build_object('mode', mode, 'odds', total));
    RETURN jsonb_build_object('accepted', TRUE, 'ticket', to_jsonb (t));
END
$$;
CREATE FUNCTION public._arena_settle (tid uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    t arena_tickets;
    l arena_legs;
    r integer;
    pending boolean := FALSE;
    losing boolean := FALSE;
    all_void boolean := TRUE;
    effective numeric := 1;
    finger text := '';
    state text;
    uc bigint;
    bc bigint;
    xp bigint;
BEGIN
    SELECT
        *
    INTO
        STRICT t
    FROM
        arena_tickets
    WHERE
        id = tid
    FOR UPDATE;
    FOR l IN
    SELECT
        *
    FROM
        arena_legs
    WHERE
        ticket_id = tid
    ORDER BY
        match_id LOOP
            r := CASE WHEN l.voided
                OR t.created_at >= (
                    SELECT
                        kickoff
                    FROM
                        matches
                    WHERE
                        id = l.match_id) THEN
                -1
            ELSE
                _arena_outcome (l.match_id, l.market)
            END;
            IF r = -1 THEN
                UPDATE
                    arena_legs
                SET
                    voided = TRUE
                WHERE
                    ticket_id = l.ticket_id
                    AND match_id = l.match_id;
            END IF;
            finger := finger || l.match_id || ':' || coalesce(r::text, 'pending') || ';';
            IF r IS NULL THEN
                pending := TRUE;
            ELSIF r = 0 THEN
                losing := TRUE;
            END IF;
            IF r IS DISTINCT FROM -1 THEN
                all_void := FALSE;
                effective := effective * l.odds;
            END IF;
        END LOOP;
    IF losing THEN
        state := 'lost';
    ELSIF pending THEN
        state := 'open';
    ELSIF all_void THEN
        state := 'void';
    ELSE
        state := 'won';
    END IF;
    IF t.mode = 'bookmaker' AND state IN ('won', 'lost') THEN
        state := CASE WHEN state = 'won' THEN
            'lost'
        ELSE
            'won'
        END;
    END IF;
    IF state = 'open' AND t.status = 'open' THEN
        RETURN;
    END IF;
    IF t.status = state AND t.result_hash = finger THEN
        RETURN;
    END IF;
    -- Restore the original frozen reserves on correction, without permitting a negative wallet.
    IF t.status <> 'open' THEN
        PERFORM
            _arena_adjust (t.user_id, - t.user_credit, - t.earned_xp);
        PERFORM
            _arena_adjust_bank (- t.bot_credit);
        UPDATE
            arena_wallets
        SET
            reserved = reserved + t.user_risk
        WHERE
            user_id = t.user_id;
        UPDATE
            arena_bank
        SET
            reserved = reserved + t.bot_risk;
        INSERT INTO arena_ledger (user_id, ticket_id, kind, amount, detail)
            VALUES (t.user_id, t.id, 'correction', - t.user_credit, jsonb_build_object('previous', t.status));
    END IF;
    IF state = 'open' THEN
        UPDATE
            arena_tickets
        SET
            status = 'open',
            user_credit = 0,
            bot_credit = 0,
            earned_xp = 0,
            result_hash = finger,
            settled_at = NULL
        WHERE
            id = tid;
        RETURN;
    END IF;
    IF state = 'void' THEN
        uc := t.user_risk;
        bc := t.bot_risk;
    ELSIF t.mode = 'challenge'
            AND state = 'won' THEN
            uc := floor(t.stake * effective);
        bc := t.user_risk + t.bot_risk - uc;
    ELSIF t.mode = 'challenge' THEN
        uc := 0;
        bc := t.user_risk + t.bot_risk;
    ELSIF state = 'lost' THEN
        uc := 0;
        bc := t.user_risk + t.bot_risk;
    ELSE
        uc := t.user_risk + t.bot_risk;
        bc := 0;
    END IF;
    xp := CASE WHEN state = 'won' THEN
        greatest (0, uc - t.user_risk)
    ELSE
        0
    END;
    UPDATE
        arena_wallets
    SET
        reserved = reserved - t.user_risk
    WHERE
        user_id = t.user_id;
    UPDATE
        arena_bank
    SET
        reserved = reserved - t.bot_risk;
    PERFORM
        _arena_adjust (t.user_id, uc, xp);
    PERFORM
        _arena_adjust_bank (bc);
    UPDATE
        arena_tickets
    SET
        status = state,
        user_credit = uc,
        bot_credit = bc,
        earned_xp = xp,
        result_hash = finger,
        settled_at = now()
    WHERE
        id = tid;
    INSERT INTO arena_ledger (user_id, ticket_id, kind, amount, detail)
        VALUES (t.user_id, t.id, 'settlement', uc, jsonb_build_object('status', state, 'xp', xp));
END
$$;
CREATE FUNCTION public._arena_validate_result ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NEW.is_published AND NEW.status = 'finished' AND (NEW.goals_home,
        NEW.goals_away) IS NOT NULL THEN
        IF NEW.kickoff > clock_timestamp() THEN
            RAISE EXCEPTION 'Un résultat officiel ne peut pas précéder le coup d’envoi';
        END IF;
        IF tg_op = 'INSERT' OR (NEW.goals_home,
            NEW.goals_away,
            NEW.status) IS DISTINCT FROM (OLD.goals_home,
        OLD.goals_away,
        OLD.status) THEN
            NEW.verified_at := clock_timestamp();
        END IF;
    END IF;
    RETURN new;
END
$$;
CREATE TRIGGER arena_official_result
    BEFORE INSERT OR UPDATE OF goals_home,
    goals_away,
    status,
    is_published ON public.matches FOR EACH ROW
    EXECUTE FUNCTION public._arena_validate_result ();
CREATE FUNCTION public._arena_result_trigger ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    tid uuid;
BEGIN
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
CREATE TRIGGER arena_result
    AFTER INSERT OR UPDATE OF goals_home,
    goals_away,
    status,
    is_published,
    verified_at,
    kickoff,
    home_team_id,
    away_team_id,
    season_id ON public.matches FOR EACH ROW
    EXECUTE FUNCTION public._arena_result_trigger ();
CREATE FUNCTION public.arena_correct_void (mid uuid, reason text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    tid uuid;
    n integer := 0;
BEGIN
    IF NOT is_calcito_admin () OR length(trim(reason)) < 10 OR reason IS NULL THEN
        RAISE EXCEPTION 'Administration et justification requises';
    END IF;
    PERFORM
        _arena_lock ();
    INSERT INTO arena_corrections (match_id, actor, reason)
        VALUES (mid, auth.uid (), reason);
    UPDATE
        arena_legs
    SET
        voided = FALSE
    WHERE
        match_id = mid;
    FOR tid IN SELECT DISTINCT
        ticket_id
    FROM
        arena_legs
    WHERE
        match_id = mid LOOP
            PERFORM
                _arena_settle (tid);
            n := n + 1;
        END LOOP;
    RETURN jsonb_build_object('recomputed', n);
END
$$;
REVOKE ALL ON FUNCTION public.arena_correct_void (uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.arena_correct_void (uuid, text) TO authenticated;
CREATE FUNCTION public.arena_claim_mission (mission text, answers jsonb DEFAULT '{}')
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid;
    period text;
    reward bigint;
BEGIN
    PERFORM
        _arena_lock ();
    u := _arena_account ();
    CASE mission
    WHEN 'daily_coach' THEN
        period := to_char(now() at time zone'Europe/Paris', 'YYYY-MM-DD');
        reward := 200;
    WHEN 'weekly_probability' THEN
        period := to_char(now() at time zone'Europe/Paris', 'IYYY-IW');
        reward := 500;
    WHEN 'form_discovery' THEN
        period := 'once';
        reward := 1000;
    WHEN 'first_ticket' THEN
        IF NOT EXISTS (
            SELECT
                1
            FROM
                arena_tickets
            WHERE
                user_id = u) THEN
            RAISE EXCEPTION 'Mission non accomplie';
            END IF;
    period := 'once';
    reward := 200;
    WHEN 'three_wins' THEN
        IF (
            SELECT
                count(*)
            FROM
                arena_tickets
            WHERE
                user_id = u
                AND status = 'won') < 3 THEN
            RAISE EXCEPTION 'Mission non accomplie';
        END IF;
    period := 'once';
    reward := 500;
    WHEN 'combination' THEN
        IF NOT EXISTS (
            SELECT
                1
            FROM
                arena_tickets t
            WHERE
                user_id = u
                AND status = 'won'
                AND (
                SELECT
                    count(*)
                FROM
                    arena_legs
                WHERE
                    ticket_id = t.id) >= 2) THEN
            RAISE EXCEPTION 'Mission non accomplie';
        END IF;
    period := 'once';
    reward := 500;
ELSE
    RAISE EXCEPTION 'Mission inconnue';
    END CASE;
    IF mission = 'daily_coach' AND (answers ->> 'risk') IS DISTINCT FROM 'limit' OR mission = 'weekly_probability' AND (answers ->> 'certainty') IS DISTINCT FROM 'none' OR mission = 'form_discovery' AND (answers ->> 'form') IS DISTINCT FROM 'not_probability' THEN
        RAISE EXCEPTION 'Réponse pédagogique incorrecte';
    END IF;
    IF mission IN ('daily_coach', 'weekly_probability', 'form_discovery') AND answers = '{}'::jsonb THEN
        RAISE EXCEPTION 'Réponse requise';
    END IF;
    INSERT INTO arena_missions
        VALUES (u, mission, period, reward, reward, now())
    ON CONFLICT
        DO NOTHING;
    IF NOT found THEN
        RETURN jsonb_build_object('claimed', FALSE, 'reason', 'Récompense déjà obtenue pour cette période.');
    END IF;
    PERFORM
        _arena_adjust (u, reward, reward);
    INSERT INTO arena_ledger (user_id, kind, amount, detail)
        VALUES (u, 'mission', reward, jsonb_build_object('mission', mission, 'period', period));
    RETURN jsonb_build_object('claimed', TRUE, 'reward', reward);
END
$$;
-- A consistent lock order avoids deadlocks between match editing and ticket reservation.
CREATE FUNCTION public.arena_match_guard ()
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NOT is_calcito_admin () THEN
        RAISE EXCEPTION 'Administration requise'
            USING errcode = '42501';
    END IF;
    PERFORM
        _arena_lock ();
END
$$;
REVOKE ALL ON FUNCTION public.arena_match_guard () FROM public;
GRANT EXECUTE ON FUNCTION public.arena_match_guard () TO authenticated;
CREATE FUNCTION public._arena_write_guard ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    PERFORM
        _arena_lock ();
    RETURN NULL;
END
$$;
CREATE TRIGGER arena_write_lock
    BEFORE INSERT OR UPDATE OR DELETE ON public.matches FOR EACH statement
    EXECUTE FUNCTION public._arena_write_guard ();
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
        INSERT INTO public.match_team_stats (match_id, team_id, shots, shots_on_target, woodwork, big_chances, team_rating, possession, xg, bonuses)
            VALUES (mid, teamid, nullif (stats ->> 'shots', '')::smallint,nullif(stats->>'shots_on_target','')::smallint, nullif (stats ->> 'woodwork', '')::smallint,nullif(stats->>'big_chances','')::smallint, nullif (stats ->> 'team_rating', '')::numeric,nullif(stats->>'possession','')::numeric, nullif (stats ->> 'xg', '')::numeric, stats -> 'bonuses');
    END LOOP;
    RETURN mid;
END
$$;
CREATE FUNCTION public._arena_catalogue_changed ()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    PERFORM
        _arena_lock ();
    UPDATE
        arena_model
    SET
        enabled = FALSE,
        report = report || jsonb_build_object('enabled', FALSE, 'reason', 'Catalogue modifié : recalibration requise pour les nouvelles cotes.');
    RETURN new;
END
$$;
CREATE TRIGGER arena_competition_change
    AFTER UPDATE OF is_published ON public.competitions FOR EACH ROW
    EXECUTE FUNCTION public._arena_catalogue_changed ();
CREATE TRIGGER arena_season_change
    AFTER UPDATE OF is_published,
    start_year,
    competition_id ON public.seasons FOR EACH ROW
    EXECUTE FUNCTION public._arena_catalogue_changed ();
CREATE TRIGGER arena_team_change
    AFTER UPDATE OF is_published ON public.teams FOR EACH ROW
    EXECUTE FUNCTION public._arena_catalogue_changed ();
-- Deny all helper entrypoints, even though they are security definer.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
    SELECT
        oid::regprocedure name
    FROM
        pg_proc
    WHERE
        pronamespace = 'public'::regnamespace
        AND proname LIKE '\_arena\_%' escape'\'loop execute format('revoke ALL ON FUNCTION %s
    FROM
        public,
        anon,
        authenticated ',
        p.name);
END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.arena_account (), public.arena_place_ticket (uuid[], bigint, text, numeric, uuid), public.arena_claim_mission (text, jsonb), public.arena_calibrate (), public.arena_status (), public.arena_quote (uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.arena_account (), public.arena_place_ticket (uuid[], bigint, text, numeric, uuid), public.arena_claim_mission (text, jsonb), public.arena_calibrate () TO authenticated;
GRANT EXECUTE ON FUNCTION public.arena_status () TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arena_quote (uuid) TO authenticated;
CREATE FUNCTION public.arena_admin_log ()
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
    RETURN (
        SELECT
            coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]')
        FROM (
            SELECT
                *
            FROM
                arena_corrections
            ORDER BY
                created_at DESC
            LIMIT 100) r);
END
$$;
REVOKE ALL ON FUNCTION public.arena_admin_log () FROM public;
GRANT EXECUTE ON FUNCTION public.arena_admin_log () TO authenticated;
CREATE FUNCTION public.arena_export ()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    u uuid := auth.uid ();
BEGIN
    IF u IS NULL THEN
        RAISE EXCEPTION 'Connexion requise'
            USING errcode = '42501';
    END IF;
    RETURN jsonb_build_object('generated_at', now(), 'wallet', (
        SELECT
            to_jsonb (w)
        FROM arena_wallets w
        WHERE
            user_id = u), 'tickets', (
            SELECT
                coalesce(jsonb_agg(t ORDER BY t.created_at), '[]')
            FROM arena_tickets t
            WHERE
                user_id = u), 'selections', (
                SELECT
                    coalesce(jsonb_agg(l), '[]')
                FROM arena_legs l
                JOIN arena_tickets t ON t.id = l.ticket_id
            WHERE
                t.user_id = u), 'transactions', (
                SELECT
                    coalesce(jsonb_agg(l ORDER BY l.id), '[]')
                FROM arena_ledger l
            WHERE
                user_id = u), 'missions', (
                SELECT
                    coalesce(jsonb_agg(m), '[]')
                FROM arena_missions m
            WHERE
                user_id = u));
END
$$;
REVOKE ALL ON FUNCTION public.arena_export () FROM public;
GRANT EXECUTE ON FUNCTION public.arena_export () TO authenticated;
COMMIT;
