-- CALCITO V3.1: apply AFTER 001, once. Existing matches and IDs are preserved.
begin;
-- Monotonic revision stamps also distinguish rapid writes in the same transaction.
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond'); return new; end $$;
alter table public.teams add column domestic_league text;
alter table public.form_snapshots add column index_variant text not null default 'complete' check(index_variant in('complete','provisional'));
alter table public.form_snapshots add column compatibility_group text;
create table public.simplified_results (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id),
 opponent_name text not null check(length(trim(opponent_name)) between 1 and 160),
 opponent_team_id uuid references public.teams(id), kickoff timestamptz not null,
 season_start_year integer not null check(season_start_year between 1900 and 2200),
 season_end_year integer not null check(season_end_year between season_start_year and season_start_year+1),
 competition_name text not null check(length(trim(competition_name)) between 1 and 160),
 venue text not null check(venue in('home','away')),
 goals_for smallint not null check(goals_for>=0), goals_against smallint not null check(goals_against>=0),
 entry_type text not null default 'simplified' check(entry_type='simplified'),
 is_published boolean not null default false,
 converted_match_id uuid references public.matches(id) on delete set null, converted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(opponent_team_id is null or opponent_team_id<>team_id),
 check(extract(year from kickoff at time zone 'UTC') between season_start_year and season_end_year),
 check((kickoff at time zone 'UTC')::date <= (now() at time zone 'UTC')::date), check(converted_match_id is null or converted_at is not null)
);
create index simplified_history on public.simplified_results(team_id,kickoff desc);
alter table public.simplified_results enable row level security;
revoke all on public.simplified_results from anon,authenticated;
grant select on public.simplified_results to anon,authenticated;
grant insert,update,delete on public.simplified_results to authenticated;
create policy owner_manage on public.simplified_results for all to authenticated using(public.is_calcito_admin()) with check(public.is_calcito_admin());
create policy public_simplified on public.simplified_results for select to anon,authenticated using(
 is_published and converted_at is null and exists(select 1 from public.teams t where t.id=team_id and t.is_published)
);
create function public.normalized_club(value text) returns text language sql immutable set search_path=pg_catalog as $$
 select regexp_replace(normalize(lower(trim(value)),NFD),'[^a-z0-9]','','g')
$$;
-- One transaction lock serializes writes across both entry types, including direct API writes.
-- Security-definer checks see drafts too; callers only receive a generic duplicate error.
create function public.guard_result_duplicates() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare tracked uuid; opponent uuid; opponent_text text; day date; source_row public.simplified_results; gf integer; ga integer;
begin
 perform pg_advisory_xact_lock(731031);
 day=(new.kickoff at time zone 'UTC')::date;
 if tg_table_name='simplified_results' then
   if tg_op='UPDATE' and old.converted_at is not null then
     if (to_jsonb(new)-'updated_at'-'converted_match_id') is distinct from (to_jsonb(old)-'updated_at'-'converted_match_id') then
       raise exception 'Ce résultat a été converti. Modifiez le match complet.';
     end if;
     if new.converted_match_id is not null and new.converted_match_id is distinct from old.converted_match_id then raise exception 'Conversion immuable.'; end if;
     return new;
   end if;
   if new.converted_at is not null then
     if new.converted_match_id is null or not exists(select 1 from public.matches m where m.id=new.id and m.id=new.converted_match_id and new.team_id in(m.home_team_id,m.away_team_id)) then
       raise exception 'Conversion invalide.';
     end if;
     return new;
   end if;
   if exists(select 1 from public.matches where id=new.id) then raise exception 'Identifiant déjà utilisé par un match complet.' using errcode='23505'; end if;
   tracked=new.team_id; opponent=new.opponent_team_id; opponent_text=public.normalized_club(new.opponent_name);
   if opponent_text=public.normalized_club((select name from public.teams where id=tracked)) then raise exception 'Choisissez un adversaire différent.'; end if;
   if exists(select 1 from public.matches m join public.teams t on t.id=case when m.home_team_id=tracked then m.away_team_id else m.home_team_id end
      where tracked in(m.home_team_id,m.away_team_id) and (m.kickoff at time zone 'UTC')::date=day
      and (t.id=opponent or public.normalized_club(t.name)=opponent_text)) then
     raise exception 'Ce résultat existe déjà.' using errcode='23505';
   end if;
   if exists(select 1 from public.simplified_results r where r.id<>new.id and r.converted_at is null and (r.kickoff at time zone 'UTC')::date=day and
     ((r.team_id=tracked and (public.normalized_club(r.opponent_name)=opponent_text or (opponent is not null and r.opponent_team_id=opponent))) or
      ((r.team_id=opponent or public.normalized_club((select name from public.teams where id=r.team_id))=opponent_text) and (r.opponent_team_id=tracked or public.normalized_club(r.opponent_name)=public.normalized_club((select name from public.teams where id=tracked)))))) then raise exception 'Ce résultat existe déjà.' using errcode='23505'; end if;
 else
   select * into source_row from public.simplified_results where id=new.id and converted_at is null;
   if found then
     tracked=source_row.team_id;
     opponent=case when new.home_team_id=tracked then new.away_team_id else new.home_team_id end;
     gf=case when new.home_team_id=tracked then new.goals_home else new.goals_away end;
     ga=case when new.home_team_id=tracked then new.goals_away else new.goals_home end;
     if tracked not in(new.home_team_id,new.away_team_id) or new.status<>'finished' or
       (source_row.kickoff at time zone 'UTC')::date<>day or gf is distinct from source_row.goals_for or ga is distinct from source_row.goals_against or
       (source_row.venue='home')<>(new.home_team_id=tracked) or
       (source_row.opponent_team_id is not null and source_row.opponent_team_id<>opponent) or
       (source_row.opponent_team_id is null and public.normalized_club(source_row.opponent_name)<>public.normalized_club((select name from public.teams where id=opponent))) then
       raise exception 'La conversion doit conserver les équipes, la date, le terrain et le score du résultat original.';
     end if;
   end if;
   if exists(select 1 from public.simplified_results r join public.teams t on t.id=case when r.team_id=new.home_team_id then new.away_team_id else new.home_team_id end
     where r.id<>new.id and r.converted_at is null and r.team_id in(new.home_team_id,new.away_team_id) and (r.kickoff at time zone 'UTC')::date=day
     and (r.opponent_team_id=t.id or public.normalized_club(r.opponent_name)=public.normalized_club(t.name))) then
     raise exception 'Un résultat rapide existe déjà. Utilisez sa conversion.' using errcode='23505';
   end if;
   if exists(select 1 from public.matches m where m.id<>new.id and (m.kickoff at time zone 'UTC')::date=day and m.home_team_id=new.home_team_id and m.away_team_id=new.away_team_id) then
     raise exception 'Ce résultat existe déjà.' using errcode='23505';
   end if;
 end if;
 return new;
end $$;
create trigger simplified_duplicate_guard before insert or update on public.simplified_results for each row execute function public.guard_result_duplicates();
create trigger match_cross_duplicate_guard before insert or update on public.matches for each row execute function public.guard_result_duplicates();
create function public.archive_converted_result() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update public.simplified_results set converted_at=now(),converted_match_id=new.id where id=new.id and converted_at is null;
 return new;
end $$;
create trigger archive_conversion after insert on public.matches for each row execute function public.archive_converted_result();
create function public.invalidate_simplified_forms() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then update public.form_snapshots set is_valid=false where team_id=old.team_id; end if;
 if tg_op<>'DELETE' then update public.form_snapshots set is_valid=false where team_id=new.team_id; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger simplified_invalidation after insert or update or delete on public.simplified_results for each row execute function public.invalidate_simplified_forms();
create trigger touch_row before update on public.simplified_results for each row execute function public.touch_updated_at();
create trigger audit_row after insert or update or delete on public.simplified_results for each row execute function public.audit_change();
create function public.save_simplified_result(payload jsonb) returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare rid uuid; existing public.simplified_results;
begin
 if not public.is_calcito_admin() then raise exception 'Administration non autorisée.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(731031);
 rid=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 select * into existing from public.simplified_results where id=rid for update;
 if found and (payload->>'expected_updated_at' is null or existing.updated_at<>(payload->>'expected_updated_at')::timestamptz) then raise exception 'Ce résultat a changé.' using errcode='40001'; end if;
 if existing.converted_at is not null then raise exception 'Ce résultat a été converti. Modifiez le match complet.'; end if;
 insert into public.simplified_results(id,team_id,opponent_name,opponent_team_id,kickoff,season_start_year,season_end_year,competition_name,venue,goals_for,goals_against,is_published)
 values(rid,(payload->>'team_id')::uuid,trim(payload->>'opponent_name'),nullif(payload->>'opponent_team_id','')::uuid,(payload->>'kickoff')::timestamptz,
 (payload->>'season_start_year')::integer,(payload->>'season_end_year')::integer,trim(payload->>'competition_name'),payload->>'venue',
 (payload->>'goals_for')::smallint,(payload->>'goals_against')::smallint,coalesce((payload->>'is_published')::boolean,false))
 on conflict(id) do update set team_id=excluded.team_id,opponent_name=excluded.opponent_name,opponent_team_id=excluded.opponent_team_id,kickoff=excluded.kickoff,
 season_start_year=excluded.season_start_year,season_end_year=excluded.season_end_year,competition_name=excluded.competition_name,venue=excluded.venue,
 goals_for=excluded.goals_for,goals_against=excluded.goals_against,is_published=excluded.is_published;
 return rid;
end $$;
revoke all on function public.save_simplified_result(jsonb) from public;
grant execute on function public.save_simplified_result(jsonb) to authenticated;
-- Trigger functions are not callable as browser RPCs.
revoke all on function public.guard_result_duplicates(),public.archive_converted_result(),public.invalidate_simplified_forms() from public;
notify pgrst,'reload schema';
commit;
