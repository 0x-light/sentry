-- ============================================================================
-- SENTRY — Scheduled notice cross-device sync
-- Safe for existing databases (idempotent).
-- ============================================================================

begin;

alter table if exists public.user_settings
  add column if not exists scheduled_last_viewed_scan_key text;

update public.user_settings
set scheduled_last_viewed_scan_key = ''
where scheduled_last_viewed_scan_key is null;

alter table if exists public.user_settings
  alter column scheduled_last_viewed_scan_key set default '';

alter table if exists public.user_settings
  alter column scheduled_last_viewed_scan_key set not null;

commit;
