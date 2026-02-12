-- ============================================================================
-- SENTRY — Production hardening delta migration
-- Safe for existing databases (idempotent + data-safe updates)
-- Run in Supabase SQL Editor.
-- ============================================================================

set lock_timeout = '10s';
set statement_timeout = '5min';

begin;

-- --------------------------------------------------------------------------
-- Backfill missing columns for older installs
-- --------------------------------------------------------------------------

alter table if exists public.profiles
  add column if not exists credits_balance int not null default 0;

alter table if exists public.credit_transactions
  add column if not exists type text;
alter table if exists public.credit_transactions
  add column if not exists amount int;
alter table if exists public.credit_transactions
  add column if not exists balance_after int;
alter table if exists public.credit_transactions
  add column if not exists metadata jsonb default '{}'::jsonb;

alter table if exists public.user_settings
  add column if not exists updated_at timestamptz not null default now();
alter table if exists public.presets
  add column if not exists updated_at timestamptz not null default now();
alter table if exists public.analysts
  add column if not exists updated_at timestamptz not null default now();
alter table if exists public.scheduled_scans
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.scans
  add column if not exists accounts text[] not null default '{}'::text[];
alter table if exists public.scans
  add column if not exists range_label text not null default '';
alter table if exists public.scans
  add column if not exists range_days int not null default 1;
alter table if exists public.scans
  add column if not exists total_tweets int not null default 0;
alter table if exists public.scans
  add column if not exists signal_count int not null default 0;
alter table if exists public.scans
  add column if not exists signals jsonb not null default '[]'::jsonb;
alter table if exists public.scans
  add column if not exists tweet_meta jsonb default '{}'::jsonb;
alter table if exists public.scans
  add column if not exists credits_used int not null default 0;

alter table if exists public.scheduled_scans
  add column if not exists label text not null default 'Morning';
alter table if exists public.scheduled_scans
  add column if not exists time text not null default '07:00';
alter table if exists public.scheduled_scans
  add column if not exists timezone text not null default 'UTC';
alter table if exists public.scheduled_scans
  add column if not exists days int[] not null default '{}'::int[];
alter table if exists public.scheduled_scans
  add column if not exists preset_names text[] not null default '{}'::text[];
alter table if exists public.scheduled_scans
  add column if not exists accounts text[] not null default '{}'::text[];
alter table if exists public.scheduled_scans
  add column if not exists range_days int not null default 1;

alter table if exists public.shared_scans
  add column if not exists range_days int not null default 1;
alter table if exists public.shared_scans
  add column if not exists accounts_count int not null default 0;
alter table if exists public.shared_scans
  add column if not exists total_tweets int not null default 0;
alter table if exists public.shared_scans
  add column if not exists signal_count int not null default 0;
alter table if exists public.shared_scans
  add column if not exists signals jsonb not null default '[]'::jsonb;
alter table if exists public.shared_scans
  add column if not exists tweet_meta jsonb default '{}'::jsonb;

-- --------------------------------------------------------------------------
-- Data hygiene (pre-constraint normalization)
-- --------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles
    set credits_balance = 0
    where credits_balance is null or credits_balance < 0;
  end if;

  if to_regclass('public.credit_transactions') is not null then
    update public.credit_transactions
    set type = 'adjustment'
    where type is null
       or btrim(type) = ''
       or type not in ('purchase', 'recurring', 'scan', 'refund', 'bonus', 'adjustment');

    update public.credit_transactions
    set amount = 1
    where amount is null or amount = 0;

    update public.credit_transactions
    set metadata = '{}'::jsonb
    where metadata is null;

    update public.credit_transactions
    set balance_after = 0
    where balance_after is null;
  end if;

  if to_regclass('public.scans') is not null then
    update public.scans
    set accounts = '{}'::text[]
    where accounts is null;

    update public.scans
    set range_label = ''
    where range_label is null;

    update public.scans
    set range_days = 1
    where range_days is null or range_days < 1 or range_days > 30;

    update public.scans
    set total_tweets = 0
    where total_tweets is null or total_tweets < 0;

    update public.scans
    set signal_count = 0
    where signal_count is null or signal_count < 0;

    update public.scans
    set credits_used = 0
    where credits_used is null or credits_used < 0;

    update public.scans
    set signals = '[]'::jsonb
    where signals is null;

    update public.scans
    set tweet_meta = '{}'::jsonb
    where tweet_meta is null;
  end if;

  if to_regclass('public.scheduled_scans') is not null then
    update public.scheduled_scans
    set label = 'Morning'
    where label is null or btrim(label) = '';

    update public.scheduled_scans
    set time = '07:00'
    where time is null or time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

    update public.scheduled_scans
    set timezone = 'UTC'
    where timezone is null or btrim(timezone) = '';

    update public.scheduled_scans
    set days = '{}'::int[]
    where days is null;

    update public.scheduled_scans
    set preset_names = '{}'::text[]
    where preset_names is null;

    update public.scheduled_scans
    set accounts = '{}'::text[]
    where accounts is null;

    update public.scheduled_scans
    set range_days = 1
    where range_days is null or range_days not in (1, 7, 30);
  end if;

  if to_regclass('public.shared_scans') is not null then
    update public.shared_scans
    set range_days = 1
    where range_days is null or range_days < 1 or range_days > 30;

    update public.shared_scans
    set accounts_count = 0
    where accounts_count is null or accounts_count < 0;

    update public.shared_scans
    set total_tweets = 0
    where total_tweets is null or total_tweets < 0;

    update public.shared_scans
    set signal_count = 0
    where signal_count is null or signal_count < 0;

    update public.shared_scans
    set signals = '[]'::jsonb
    where signals is null;

    update public.shared_scans
    set tweet_meta = '{}'::jsonb
    where tweet_meta is null;
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Generic updated_at trigger
-- --------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if to_regclass('public.profiles') is not null then
    drop trigger if exists trg_profiles_updated_at on public.profiles;
    create trigger trg_profiles_updated_at
      before update on public.profiles
      for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.user_settings') is not null then
    drop trigger if exists trg_user_settings_updated_at on public.user_settings;
    create trigger trg_user_settings_updated_at
      before update on public.user_settings
      for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.presets') is not null then
    drop trigger if exists trg_presets_updated_at on public.presets;
    create trigger trg_presets_updated_at
      before update on public.presets
      for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.analysts') is not null then
    drop trigger if exists trg_analysts_updated_at on public.analysts;
    create trigger trg_analysts_updated_at
      before update on public.analysts
      for each row execute function public.set_updated_at();
  end if;

  if to_regclass('public.scheduled_scans') is not null then
    drop trigger if exists trg_scheduled_scans_updated_at on public.scheduled_scans;
    create trigger trg_scheduled_scans_updated_at
      before update on public.scheduled_scans
      for each row execute function public.set_updated_at();
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Constraints (NOT VALID = safe on existing data, enforced for new writes)
-- --------------------------------------------------------------------------

alter table if exists public.profiles
  drop constraint if exists profiles_credits_balance_nonnegative;
alter table if exists public.profiles
  add constraint profiles_credits_balance_nonnegative
  check (credits_balance >= 0) not valid;

alter table if exists public.credit_transactions
  alter column metadata set default '{}'::jsonb;
alter table if exists public.credit_transactions
  alter column metadata set not null;

alter table if exists public.credit_transactions
  drop constraint if exists credit_transactions_type_allowed;
alter table if exists public.credit_transactions
  add constraint credit_transactions_type_allowed
  check (type in ('purchase', 'recurring', 'scan', 'refund', 'bonus', 'adjustment')) not valid;

alter table if exists public.credit_transactions
  drop constraint if exists credit_transactions_amount_nonzero;
alter table if exists public.credit_transactions
  add constraint credit_transactions_amount_nonzero
  check (amount <> 0) not valid;

alter table if exists public.scans
  drop constraint if exists scans_range_days_bounds;
alter table if exists public.scans
  add constraint scans_range_days_bounds
  check (range_days >= 1 and range_days <= 30) not valid;

alter table if exists public.scans
  drop constraint if exists scans_total_tweets_nonnegative;
alter table if exists public.scans
  add constraint scans_total_tweets_nonnegative
  check (total_tweets >= 0) not valid;

alter table if exists public.scans
  drop constraint if exists scans_signal_count_nonnegative;
alter table if exists public.scans
  add constraint scans_signal_count_nonnegative
  check (signal_count >= 0) not valid;

alter table if exists public.scans
  drop constraint if exists scans_credits_used_nonnegative;
alter table if exists public.scans
  add constraint scans_credits_used_nonnegative
  check (credits_used >= 0) not valid;

alter table if exists public.scheduled_scans
  drop constraint if exists scheduled_scans_time_format;
alter table if exists public.scheduled_scans
  add constraint scheduled_scans_time_format
  check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;

alter table if exists public.scheduled_scans
  drop constraint if exists scheduled_scans_range_days_allowed;
alter table if exists public.scheduled_scans
  add constraint scheduled_scans_range_days_allowed
  check (range_days in (1, 7, 30)) not valid;

alter table if exists public.shared_scans
  drop constraint if exists shared_scans_id_format;
alter table if exists public.shared_scans
  add constraint shared_scans_id_format
  check (id ~ '^[a-z0-9]{8}$') not valid;

alter table if exists public.shared_scans
  drop constraint if exists shared_scans_range_days_bounds;
alter table if exists public.shared_scans
  add constraint shared_scans_range_days_bounds
  check (range_days >= 1 and range_days <= 30) not valid;

alter table if exists public.shared_scans
  drop constraint if exists shared_scans_accounts_count_nonnegative;
alter table if exists public.shared_scans
  add constraint shared_scans_accounts_count_nonnegative
  check (accounts_count >= 0) not valid;

alter table if exists public.shared_scans
  drop constraint if exists shared_scans_total_tweets_nonnegative;
alter table if exists public.shared_scans
  add constraint shared_scans_total_tweets_nonnegative
  check (total_tweets >= 0) not valid;

alter table if exists public.shared_scans
  drop constraint if exists shared_scans_signal_count_nonnegative;
alter table if exists public.shared_scans
  add constraint shared_scans_signal_count_nonnegative
  check (signal_count >= 0) not valid;

-- --------------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.scheduled_scans') is not null then
    create index if not exists idx_scheduled_scans_user_enabled_time
      on public.scheduled_scans(user_id, enabled, time);
  end if;

  if to_regclass('public.shared_scans') is not null then
    create index if not exists idx_shared_scans_created_at
      on public.shared_scans(created_at desc);
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Credit RPC hardening
-- --------------------------------------------------------------------------

create or replace function public.deduct_credits(
  p_user_id uuid,
  p_amount int,
  p_description text,
  p_metadata jsonb default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be greater than 0';
  end if;

  select credits_balance into v_balance
  from profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  if v_balance < p_amount then
    return -1;
  end if;

  v_balance := v_balance - p_amount;

  update profiles
  set credits_balance = v_balance, updated_at = now()
  where id = p_user_id;

  insert into credit_transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, 'scan', -p_amount, v_balance, p_description, coalesce(p_metadata, '{}'::jsonb));

  return v_balance;
end;
$$;

create or replace function public.add_credits(
  p_user_id uuid,
  p_amount int,
  p_type text,
  p_description text,
  p_metadata jsonb default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be greater than 0';
  end if;
  if p_type is null or length(trim(p_type)) = 0 then
    raise exception 'p_type is required';
  end if;

  select credits_balance into v_balance
  from profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found for user %', p_user_id;
  end if;

  v_balance := v_balance + p_amount;

  update profiles
  set credits_balance = v_balance, updated_at = now()
  where id = p_user_id;

  insert into credit_transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, p_type, p_amount, v_balance, p_description, coalesce(p_metadata, '{}'::jsonb));

  return v_balance;
end;
$$;

commit;

-- Optional post-deploy (when convenient): validate constraints online in batches.
-- Example:
-- alter table public.scans validate constraint scans_total_tweets_nonnegative;
