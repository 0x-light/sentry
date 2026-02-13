-- ============================================================================
-- SENTRY — RPC permissions + schedule integrity/index hardening
-- Safe for existing databases (idempotent).
-- ============================================================================

set lock_timeout = '10s';
set statement_timeout = '5min';

begin;

-- ---------------------------------------------------------------------------
-- Scheduled scan integrity and stale-running query index
-- ---------------------------------------------------------------------------

alter table if exists public.scheduled_scans
  drop constraint if exists scheduled_scans_days_valid;

alter table if exists public.scheduled_scans
  add constraint scheduled_scans_days_valid
  check (days <@ array[0,1,2,3,4,5,6]) not valid;

create index if not exists idx_scheduled_scans_running
  on public.scheduled_scans(last_run_at)
  where last_run_status = 'running';

-- ---------------------------------------------------------------------------
-- Security definer functions: pin search_path to public
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    alter function public.handle_new_user() set search_path = public;
  end if;

  if to_regprocedure('public.handle_new_profile()') is not null then
    alter function public.handle_new_profile() set search_path = public;
  end if;

  if to_regprocedure('public.deduct_credits(uuid,int,text,jsonb)') is not null then
    alter function public.deduct_credits(uuid,int,text,jsonb) set search_path = public;
  end if;

  if to_regprocedure('public.add_credits(uuid,int,text,text,jsonb)') is not null then
    alter function public.add_credits(uuid,int,text,text,jsonb) set search_path = public;
  end if;

  if to_regprocedure('public.check_free_scan_this_week(uuid)') is not null then
    alter function public.check_free_scan_this_week(uuid) set search_path = public;
  end if;

  if to_regprocedure('public.cleanup_caches()') is not null then
    alter function public.cleanup_caches() set search_path = public;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Restrict privileged RPC execution to service_role only
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.deduct_credits(uuid,int,text,jsonb)') is not null then
    revoke all on function public.deduct_credits(uuid,int,text,jsonb) from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on function public.deduct_credits(uuid,int,text,jsonb) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on function public.deduct_credits(uuid,int,text,jsonb) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.deduct_credits(uuid,int,text,jsonb) to service_role;
    end if;
  end if;

  if to_regprocedure('public.add_credits(uuid,int,text,text,jsonb)') is not null then
    revoke all on function public.add_credits(uuid,int,text,text,jsonb) from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on function public.add_credits(uuid,int,text,text,jsonb) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on function public.add_credits(uuid,int,text,text,jsonb) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.add_credits(uuid,int,text,text,jsonb) to service_role;
    end if;
  end if;

  if to_regprocedure('public.check_free_scan_this_week(uuid)') is not null then
    revoke all on function public.check_free_scan_this_week(uuid) from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on function public.check_free_scan_this_week(uuid) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on function public.check_free_scan_this_week(uuid) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.check_free_scan_this_week(uuid) to service_role;
    end if;
  end if;

  if to_regprocedure('public.cleanup_caches()') is not null then
    revoke all on function public.cleanup_caches() from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke all on function public.cleanup_caches() from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke all on function public.cleanup_caches() from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.cleanup_caches() to service_role;
    end if;
  end if;
end
$$;

commit;
