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
