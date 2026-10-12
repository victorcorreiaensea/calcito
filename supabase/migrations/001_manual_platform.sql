-- CALCITO V3. Apply in a new Supabase project from the SQL editor.
-- No service-role key, administrator identity, password or fabricated match is included.
begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  singleton boolean not null default true unique check(singleton),
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;
create policy admin_self_read on public.admin_users for select to authenticated using (user_id = auth.uid());

create function public.is_calcito_admin() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists(select 1 from public.admin_users where user_id = auth.uid()) $$;
revoke all on function public.is_calcito_admin() from public;
grant execute on function public.is_calcito_admin() to anon, authenticated;

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (length(trim(name)) > 0),
  country text not null,
  type text not null check (type in ('league','european-cup')),
  form_coefficient numeric check (form_coefficient > 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id),
  label text not null check (length(trim(label)) > 0),
  start_year integer not null check (start_year between 1900 and 2200),
  end_year integer not null check (end_year between start_year and start_year+1),
  win_points integer not null default 3, draw_points integer not null default 1, loss_points integer not null default 0,
  tie_breakers jsonb not null default '["points","goalDifference","goalsFor"]'::jsonb,
  rules_confirmed boolean not null default false,
  expected_matches integer check (expected_matches > 0),
  verified_complete boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(competition_id, start_year),
  check (jsonb_typeof(tie_breakers) = 'array' and jsonb_array_length(tie_breakers) > 0)
);
create table public.teams (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (length(trim(name)) > 0), short text not null check (length(short) between 1 and 8),
  country text not null, logo_url text check (logo_url is null or logo_url ~ '^https://'),
  is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.season_teams (
  season_id uuid not null references public.seasons(id), team_id uuid not null references public.teams(id),
  group_name text, point_adjustment integer not null default 0, adjustment_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(season_id, team_id),
  check (point_adjustment = 0 or (adjustment_reason is not null and length(trim(adjustment_reason)) > 0))
);
create table public.matches (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.seasons(id),
  round text not null check (length(trim(round)) > 0), kickoff timestamptz not null,
  home_team_id uuid not null, away_team_id uuid not null,
  status text not null default 'finished' check (status in ('scheduled','live','finished','postponed','cancelled')),
  goals_home smallint check (goals_home >= 0), goals_away smallint check (goals_away >= 0),
  halftime_home smallint check (halftime_home >= 0), halftime_away smallint check (halftime_away >= 0),
  extra_home smallint check (extra_home >= 0), extra_away smallint check (extra_away >= 0),
  penalties_home smallint check (penalties_home >= 0), penalties_away smallint check (penalties_away >= 0),
  source text, verified_at timestamptz, comment text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(season_id, home_team_id) references public.season_teams(season_id, team_id),
  foreign key(season_id, away_team_id) references public.season_teams(season_id, team_id),
  check(home_team_id <> away_team_id),
  check(not is_published or (source is not null and length(trim(source)) > 0 and verified_at is not null)),
  check(not is_published or status <> 'finished' or (goals_home is not null and goals_away is not null))
);
create unique index match_duplicate_guard on public.matches(season_id, home_team_id, away_team_id, ((kickoff at time zone 'UTC')::date));
create index matches_public_calendar on public.matches(is_published, kickoff desc);
create index matches_home_history on public.matches(home_team_id, kickoff desc);
create index matches_away_history on public.matches(away_team_id, kickoff desc);
create table public.match_team_stats (
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  shots smallint check (shots >= 0), shots_on_target smallint check (shots_on_target >= 0),
  woodwork smallint check (woodwork >= 0), big_chances smallint check (big_chances >= 0),
  team_rating numeric(4,2) check (team_rating between 0 and 10),
  possession numeric(5,2) check (possession between 0 and 100), xg numeric(6,3) check (xg >= 0),
  bonuses jsonb check (bonuses is null or jsonb_typeof(bonuses) = 'array'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(match_id, team_id),
  check(shots is null or shots_on_target is null or shots_on_target <= shots)
);
create table public.form_snapshots (
  id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id),
  season_start_year integer not null, score numeric not null check(score between 0 and 100),
  model_version text not null, calculated_at timestamptz not null default now(),
  trace jsonb not null, is_valid boolean not null default true, is_published boolean not null default false
);
create index form_lookup on public.form_snapshots(team_id, season_start_year, calculated_at desc);
create table public.prediction_history (
  id uuid primary key default gen_random_uuid(), match_id uuid not null references public.matches(id),
  predicted_at timestamptz not null default now(), model_version text not null,
  home_probability numeric not null check(home_probability between 0 and 1),
  draw_probability numeric not null check(draw_probability between 0 and 1),
  away_probability numeric not null check(away_probability between 0 and 1),
  factors jsonb not null, data_quality jsonb not null,
  final_result text check(final_result in ('home','draw','away')), evaluation jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(abs(home_probability+draw_probability+away_probability-1) < 0.000000001)
);
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid, entity text not null, operation text not null,
  record_key jsonb not null, old_data jsonb, new_data jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_recent on public.admin_audit_log(occurred_at desc);

create function public.touch_updated_at() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at=now(); return new; end $$;
create function public.check_stats_team() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if not exists(select 1 from public.matches m where m.id=new.match_id and new.team_id in(m.home_team_id,m.away_team_id)) then
    raise exception 'Les statistiques doivent appartenir à une des deux équipes du match.';
  end if; return new;
end $$;
create function public.check_match_domain() returns trigger language plpgsql set search_path=pg_catalog as $$
declare season_start integer; season_end integer;
begin
  select start_year,end_year into season_start,season_end from public.seasons where id=new.season_id;
  if extract(year from new.kickoff at time zone 'UTC') not between season_start and season_end then
    raise exception 'La date ne correspond pas à la saison sélectionnée.';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.match_team_stats s where s.match_id=old.id and s.team_id not in(new.home_team_id,new.away_team_id)) then
    raise exception 'Les statistiques existantes ne correspondent pas aux nouvelles équipes.';
  end if;
  return new;
end $$;
create trigger match_domain_guard before insert or update on public.matches for each row execute function public.check_match_domain();
create trigger stats_team_guard before insert or update on public.match_team_stats for each row execute function public.check_stats_team();

create function public.audit_change() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into public.admin_audit_log(actor_id,entity,operation,record_key,old_data,new_data)
  values(auth.uid(),tg_table_name,tg_op,case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,case when tg_op <> 'DELETE' then to_jsonb(new) end);
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create function public.invalidate_derived() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare item public.matches; sid uuid;
begin
  if tg_table_name='matches' then
    if tg_op='DELETE' then item=old; else item=new; end if;
  else
    select * into item from public.matches where id=coalesce(new.match_id,old.match_id);
  end if;
  update public.form_snapshots set is_valid=false where team_id in(item.home_team_id,item.away_team_id);
  update public.seasons set verified_complete=false where id=item.season_id and verified_complete;
  if tg_table_name='matches' and tg_op='UPDATE' then
    update public.form_snapshots set is_valid=false where team_id in(old.home_team_id,old.away_team_id);
    update public.seasons set verified_complete=false where id=old.season_id and verified_complete;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger invalidate_matches after insert or update or delete on public.matches for each row execute function public.invalidate_derived();
create trigger invalidate_stats after insert or update or delete on public.match_team_stats for each row execute function public.invalidate_derived();

-- Owners can manage all records. Visitors can only read intentionally published data.
do $$ declare name text; begin
  foreach name in array array['competitions','seasons','teams','season_teams','matches','match_team_stats','form_snapshots','prediction_history'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from anon,authenticated',name);
    execute format('grant select on public.%I to anon,authenticated',name);
    execute format('grant insert,update,delete on public.%I to authenticated',name);
    execute format('create policy owner_manage on public.%I for all to authenticated using(public.is_calcito_admin()) with check(public.is_calcito_admin())',name);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_change()',name);
    if name not in('form_snapshots') then
      execute format('create trigger touch_row before update on public.%I for each row execute function public.touch_updated_at()',name);
    end if;
  end loop;
end $$;
create policy public_competitions on public.competitions for select to anon,authenticated using(is_published);
create policy public_seasons on public.seasons for select to anon,authenticated using(is_published and exists(select 1 from public.competitions c where c.id=competition_id and c.is_published));
create policy public_teams on public.teams for select to anon,authenticated using(is_published);
create policy public_members on public.season_teams for select to anon,authenticated using(exists(select 1 from public.seasons s where s.id=season_id) and exists(select 1 from public.teams t where t.id=team_id));
create policy public_matches on public.matches for select to anon,authenticated using(is_published and exists(select 1 from public.seasons s where s.id=season_id) and exists(select 1 from public.teams t where t.id=home_team_id) and exists(select 1 from public.teams t where t.id=away_team_id));
create policy public_stats on public.match_team_stats for select to anon,authenticated using(exists(select 1 from public.matches m where m.id=match_id and m.is_published));
create policy public_forms on public.form_snapshots for select to anon,authenticated using(is_published and is_valid and exists(select 1 from public.teams t where t.id=team_id) and exists(select 1 from public.season_teams st join public.seasons s on s.id=st.season_id where st.team_id=form_snapshots.team_id and s.start_year=form_snapshots.season_start_year));
create policy public_predictions on public.prediction_history for select to anon,authenticated using(is_published and exists(select 1 from public.matches m where m.id=match_id and predicted_at < m.kickoff));
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon,authenticated;
grant select on public.admin_audit_log to authenticated;
create policy owner_audit_read on public.admin_audit_log for select to authenticated using(public.is_calcito_admin());

-- Parameter/roster changes also invalidate persisted form outputs.
create function public.invalidate_catalogue_forms() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid; sid uuid; tid uuid;
begin
  if tg_table_name='competitions' then
    cid=coalesce(new.id,old.id);
    update public.form_snapshots f set is_valid=false where f.team_id in(select st.team_id from public.season_teams st join public.seasons s on s.id=st.season_id where s.competition_id=cid);
  elsif tg_table_name='seasons' then
    sid=coalesce(new.id,old.id);
    update public.form_snapshots f set is_valid=false where f.team_id in(select team_id from public.season_teams where season_id=sid);
  else
    tid=coalesce(new.team_id,old.team_id);
    update public.form_snapshots set is_valid=false where team_id=tid;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger invalidate_competition_parameters after update on public.competitions for each row execute function public.invalidate_catalogue_forms();
create trigger invalidate_season_parameters after update on public.seasons for each row execute function public.invalidate_catalogue_forms();
create trigger invalidate_roster after insert or update or delete on public.season_teams for each row execute function public.invalidate_catalogue_forms();

-- Future probabilities must be recorded before kickoff and cannot be retrospectively rewritten.
create function public.guard_prediction_history() returns trigger language plpgsql set search_path=pg_catalog as $$
declare kickoff_time timestamptz;
begin
  if tg_op='INSERT' then
    select kickoff into kickoff_time from public.matches where id=new.match_id;
    new.predicted_at=clock_timestamp();
    if kickoff_time is null or new.predicted_at >= kickoff_time then raise exception 'Une prévision doit être enregistrée avant le coup d’envoi.'; end if;
  elsif (new.match_id,new.predicted_at,new.model_version,new.home_probability,new.draw_probability,new.away_probability,new.factors,new.data_quality)
    is distinct from (old.match_id,old.predicted_at,old.model_version,old.home_probability,old.draw_probability,old.away_probability,old.factors,old.data_quality) then
    raise exception 'Les probabilités et paramètres originaux d’un pronostic sont immuables.';
  end if;
  return new;
end $$;
create trigger prediction_history_guard before insert or update on public.prediction_history for each row execute function public.guard_prediction_history();

-- Atomic save: one match, two statistics records, all-or-nothing and concurrency checked.
create function public.save_match(payload jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare mid uuid; sid uuid; homeid uuid; awayid uuid; existing public.matches; stats jsonb; teamid uuid; side text;
begin
  if not public.is_calcito_admin() then raise exception 'Administration non autorisée.' using errcode='42501'; end if;
  mid=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  select * into existing from public.matches where id=mid for update;
  if found and (payload->>'expected_updated_at' is null or existing.updated_at <> (payload->>'expected_updated_at')::timestamptz) then
    raise exception 'Ce match a changé. Rechargez-le avant de modifier.' using errcode='40001';
  end if;
  sid=(payload->>'season_id')::uuid; homeid=(payload->>'home_team_id')::uuid; awayid=(payload->>'away_team_id')::uuid;
  if existing.id is not null then delete from public.match_team_stats where match_id=mid; end if;
  insert into public.matches(id,season_id,round,kickoff,home_team_id,away_team_id,status,goals_home,goals_away,halftime_home,halftime_away,extra_home,extra_away,penalties_home,penalties_away,source,verified_at,comment,is_published)
  values(mid,sid,payload->>'round',(payload->>'kickoff')::timestamptz,homeid,awayid,payload->>'status',
    nullif(payload->>'goals_home','')::smallint,nullif(payload->>'goals_away','')::smallint,
    nullif(payload->>'halftime_home','')::smallint,nullif(payload->>'halftime_away','')::smallint,
    nullif(payload->>'extra_home','')::smallint,nullif(payload->>'extra_away','')::smallint,
    nullif(payload->>'penalties_home','')::smallint,nullif(payload->>'penalties_away','')::smallint,
    nullif(trim(payload->>'source'),''),nullif(payload->>'verified_at','')::timestamptz,nullif(payload->>'comment',''),coalesce((payload->>'is_published')::boolean,false))
  on conflict(id) do update set season_id=excluded.season_id,round=excluded.round,kickoff=excluded.kickoff,
    home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,status=excluded.status,
    goals_home=excluded.goals_home,goals_away=excluded.goals_away,halftime_home=excluded.halftime_home,halftime_away=excluded.halftime_away,
    extra_home=excluded.extra_home,extra_away=excluded.extra_away,penalties_home=excluded.penalties_home,penalties_away=excluded.penalties_away,
    source=excluded.source,verified_at=excluded.verified_at,comment=excluded.comment,is_published=excluded.is_published;
  foreach side in array array['home','away'] loop
    teamid=case when side='home' then homeid else awayid end; stats=payload->(side||'_stats');
    insert into public.match_team_stats(match_id,team_id,shots,shots_on_target,woodwork,big_chances,team_rating,possession,xg,bonuses)
    values(mid,teamid,nullif(stats->>'shots','')::smallint,nullif(stats->>'shots_on_target','')::smallint,
      nullif(stats->>'woodwork','')::smallint,nullif(stats->>'big_chances','')::smallint,
      nullif(stats->>'team_rating','')::numeric,nullif(stats->>'possession','')::numeric,nullif(stats->>'xg','')::numeric,stats->'bonuses');
  end loop;
  return mid;
end $$;
revoke all on function public.save_match(jsonb) from public;
grant execute on function public.save_match(jsonb) to authenticated;

-- Participant replacement is atomic; a referenced club cannot be removed by accident.
create function public.replace_season_teams(target_season uuid, participants jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare participant jsonb;
begin
  if not public.is_calcito_admin() then raise exception 'Administration non autorisée.' using errcode='42501'; end if;
  if jsonb_typeof(participants)<>'array' then raise exception 'Participants invalides.'; end if;
  delete from public.season_teams st where st.season_id=target_season
    and not exists(select 1 from jsonb_array_elements(participants) p where (p->>'team_id')::uuid=st.team_id);
  for participant in select * from jsonb_array_elements(participants) loop
    insert into public.season_teams(season_id,team_id,group_name,point_adjustment,adjustment_reason)
    values(target_season,(participant->>'team_id')::uuid,nullif(participant->>'group_name',''),
      coalesce((participant->>'point_adjustment')::integer,0),nullif(participant->>'adjustment_reason',''))
    on conflict(season_id,team_id) do update set group_name=excluded.group_name,point_adjustment=excluded.point_adjustment,adjustment_reason=excluded.adjustment_reason;
  end loop;
end $$;
revoke all on function public.replace_season_teams(uuid,jsonb) from public;
grant execute on function public.replace_season_teams(uuid,jsonb) to authenticated;

-- Reference catalogue only: no teams, seasons, fixtures, scores or fictional statistics.
insert into public.competitions(slug,name,country,type,is_published) values
('ligue-1','Ligue 1','France','league',true),('premier-league','Premier League','Angleterre','league',true),
('laliga','LaLiga','Espagne','league',true),('serie-a','Serie A','Italie','league',true),
('bundesliga','Bundesliga','Allemagne','league',true),('liga-portugal','Liga Portugal','Portugal','league',true),
('champions-league','UEFA Champions League','Europe','european-cup',true),
('europa-league','UEFA Europa League','Europe','european-cup',true),
('conference-league','UEFA Conference League','Europe','european-cup',true);
commit;
