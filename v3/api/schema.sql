-- ============================================================================
-- SENTRY v3 — Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up the database
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- USER PROFILES
-- ============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  credits_balance int not null default 0,        -- current credit balance
  stripe_customer_id text unique,
  stripe_subscription_id text,                   -- for recurring credit packs
  subscription_status text,                      -- 'active', 'canceled', etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- USER SETTINGS
-- ============================================================================

create table user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  theme text not null default 'dark',
  font text not null default 'mono',
  font_size text not null default 'medium',
  text_case text not null default 'lower',
  finance_provider text not null default 'tradingview',
  model text not null default 'claude-sonnet-4-20250514',
  live_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Auto-create settings on profile creation
create or replace function handle_new_profile()
returns trigger as $$
begin
  insert into user_settings (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_profile_created
  after insert on profiles
  for each row execute function handle_new_profile();

-- ============================================================================
-- CREDIT TRANSACTIONS (audit trail for all credit changes)
-- ============================================================================

create table credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,                            -- 'purchase', 'recurring', 'scan', 'refund', 'bonus'
  amount int not null,                           -- positive = add, negative = deduct
  balance_after int not null,                    -- balance after this transaction
  description text,                              -- e.g. "Standard pack (5,000 credits)", "Scan: 200 accounts × 1d"
  metadata jsonb default '{}',                   -- stripe_session_id, scan details, etc.
  created_at timestamptz not null default now()
);

create index idx_credit_tx_user on credit_transactions(user_id, created_at desc);

-- ============================================================================
-- PRESETS
-- ============================================================================

create table presets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  accounts text[] not null default '{}',
  is_public boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create index idx_presets_user on presets(user_id);

-- ============================================================================
-- ANALYSTS (Custom AI Prompts)
-- ============================================================================

create table analysts (
  id text not null,                            -- 'default' or generated ID
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  prompt text not null,
  is_default boolean not null default false,
  is_active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index idx_analysts_user on analysts(user_id);

-- ============================================================================
-- SCAN HISTORY
-- ============================================================================

create table scans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  accounts text[] not null,
  range_label text not null,
  range_days int not null,
  total_tweets int not null default 0,
  signal_count int not null default 0,
  signals jsonb not null default '[]',
  tweet_meta jsonb default '{}',
  credits_used int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_scans_user on scans(user_id, created_at desc);

-- ============================================================================
-- SHARED TWEET CACHE (server-side, shared across users)
-- ============================================================================

create table tweet_cache (
  account text not null,
  range_days int not null,
  hour_bucket int not null,                    -- floor(epoch_ms / 3600000)
  tweets jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (account, range_days, hour_bucket)
);

-- Auto-expire old cache entries
create index idx_tweet_cache_expiry on tweet_cache(fetched_at);

-- ============================================================================
-- SHARED ANALYSIS CACHE (server-side, shared across users with same prompt)
-- ============================================================================

create table analysis_cache (
  prompt_hash text not null,
  tweet_url text not null,
  signals jsonb not null default '[]',
  model text not null,
  created_at timestamptz not null default now(),
  primary key (prompt_hash, tweet_url)
);

create index idx_analysis_cache_created on analysis_cache(created_at);

-- ============================================================================
-- USAGE TRACKING
-- ============================================================================

create table usage_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  action text not null,                        -- 'scan', 'live_poll', 'analyze'
  accounts_count int default 0,
  tweets_count int default 0,
  signals_count int default 0,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_twitter numeric(10,6) default 0,
  cost_anthropic numeric(10,6) default 0,
  cost_total numeric(10,6) default 0,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_usage_user on usage_log(user_id, created_at desc);

-- ============================================================================
-- BILLING EVENTS (Stripe webhook log)
-- ============================================================================

create table billing_events (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text unique not null,
  type text not null,
  data jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table user_settings enable row level security;
alter table credit_transactions enable row level security;
alter table presets enable row level security;
alter table analysts enable row level security;
alter table scans enable row level security;
alter table usage_log enable row level security;
alter table billing_events enable row level security;
alter table tweet_cache enable row level security;
alter table analysis_cache enable row level security;
-- Note: billing_events, tweet_cache, and analysis_cache have NO user-facing
-- policies. They are only accessed by the worker via SUPABASE_SERVICE_KEY
-- (which bypasses RLS). This prevents anyone with the public anon key from
-- reading Stripe billing data or manipulating caches.

-- Users can only see/edit their own data
create policy "Users can view own profile"   on profiles   for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles   for update using (auth.uid() = id);

create policy "Users can view own settings"   on user_settings for select using (auth.uid() = user_id);
create policy "Users can update own settings" on user_settings for update using (auth.uid() = user_id);
create policy "Users can insert own settings" on user_settings for insert with check (auth.uid() = user_id);

create policy "Users can view own credits"   on credit_transactions for select using (auth.uid() = user_id);

create policy "Users can view own presets"    on presets for select using (auth.uid() = user_id);
create policy "Users can insert own presets"  on presets for insert with check (auth.uid() = user_id);
create policy "Users can update own presets"  on presets for update using (auth.uid() = user_id);
create policy "Users can delete own presets"  on presets for delete using (auth.uid() = user_id);
-- Public presets are visible to all authenticated users
create policy "Users can view public presets" on presets for select using (is_public = true);

create policy "Users can view own analysts"   on analysts for select using (auth.uid() = user_id);
create policy "Users can insert own analysts" on analysts for insert with check (auth.uid() = user_id);
create policy "Users can update own analysts" on analysts for update using (auth.uid() = user_id);
create policy "Users can delete own analysts" on analysts for delete using (auth.uid() = user_id);

create policy "Users can view own scans"      on scans for select using (auth.uid() = user_id);
create policy "Users can insert own scans"    on scans for insert with check (auth.uid() = user_id);
create policy "Users can delete own scans"    on scans for delete using (auth.uid() = user_id);

create policy "Users can view own usage"      on usage_log for select using (auth.uid() = user_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Calculate credits for a scan: accounts × range multiplier
-- Range multipliers: 1d=1, 7d=3, 30d=8
create or replace function calculate_scan_credits(p_accounts_count int, p_range_days int)
returns int as $$
begin
  return p_accounts_count * (
    case
      when p_range_days <= 1  then 1
      when p_range_days <= 3  then 2
      when p_range_days <= 7  then 3
      when p_range_days <= 14 then 5
      when p_range_days <= 30 then 8
      else 10
    end
  );
end;
$$ language plpgsql immutable;

-- Deduct credits for a scan (returns new balance, or -1 if insufficient)
create or replace function deduct_credits(p_user_id uuid, p_amount int, p_description text, p_metadata jsonb default '{}')
returns int as $$
declare
  v_balance int;
begin
  -- Lock the row to prevent race conditions
  select credits_balance into v_balance
  from profiles where id = p_user_id for update;

  if v_balance < p_amount then
    return -1;  -- insufficient credits
  end if;

  v_balance := v_balance - p_amount;

  update profiles
  set credits_balance = v_balance, updated_at = now()
  where id = p_user_id;

  insert into credit_transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, 'scan', -p_amount, v_balance, p_description, p_metadata);

  return v_balance;
end;
$$ language plpgsql security definer;

-- Add credits (purchase, recurring, bonus)
create or replace function add_credits(p_user_id uuid, p_amount int, p_type text, p_description text, p_metadata jsonb default '{}')
returns int as $$
declare
  v_balance int;
begin
  update profiles
  set credits_balance = credits_balance + p_amount, updated_at = now()
  where id = p_user_id
  returning credits_balance into v_balance;

  insert into credit_transactions (user_id, type, amount, balance_after, description, metadata)
  values (p_user_id, p_type, p_amount, v_balance, p_description, p_metadata);

  return v_balance;
end;
$$ language plpgsql security definer;

-- Check if free user can scan today (1 scan/day, 10 accounts max)
create or replace function check_free_scan_today(p_user_id uuid)
returns boolean as $$
declare
  v_scans_today int;
begin
  select count(*) into v_scans_today
  from scans
  where user_id = p_user_id
    and created_at >= date_trunc('day', now() at time zone 'UTC');
  return v_scans_today < 1;
end;
$$ language plpgsql security definer;

-- Clean up old caches (run periodically via pg_cron or external cron)
create or replace function cleanup_caches()
returns void as $$
begin
  delete from tweet_cache where fetched_at < now() - interval '2 hours';
  delete from analysis_cache where created_at < now() - interval '7 days';
end;
$$ language plpgsql security definer;
