-- ============================================================================
-- SENTRY v3 — Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up the database
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- PLANS & LIMITS
-- ============================================================================

create type plan_type as enum ('free', 'pro', 'ultra');

-- Plan configuration (reference table)
create table plans (
  id plan_type primary key,
  name text not null,
  scans_per_month int not null,        -- 0 = unlimited
  max_accounts_per_scan int not null,   -- 0 = unlimited
  live_feed boolean not null default false,
  scheduled_scans boolean not null default false,
  all_models boolean not null default false,
  api_access boolean not null default false,
  price_monthly int not null default 0  -- cents
);

insert into plans (id, name, scans_per_month, max_accounts_per_scan, live_feed, scheduled_scans, all_models, api_access, price_monthly) values
  ('free',  'Free',  3,   10,  false, false, false, false, 0),
  ('pro',   'Pro',   100, 0,   true,  false, true,  false, 1900),
  ('ultra', 'Ultra', 0,   0,   true,  true,  true,  true,  4900);

-- ============================================================================
-- USER PROFILES
-- ============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  plan plan_type not null default 'free',
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text,                    -- 'active', 'past_due', 'canceled', etc.
  current_period_end timestamptz,
  scans_this_month int not null default 0,
  month_reset_at timestamptz not null default date_trunc('month', now()) + interval '1 month',
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
  cost_twitter numeric(10,6) not null default 0,
  cost_anthropic numeric(10,6) not null default 0,
  cost_total numeric(10,6) not null default 0,
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
alter table presets enable row level security;
alter table analysts enable row level security;
alter table scans enable row level security;
alter table usage_log enable row level security;

-- Users can only see/edit their own data
create policy "Users can view own profile"   on profiles   for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles   for update using (auth.uid() = id);

create policy "Users can view own settings"   on user_settings for select using (auth.uid() = user_id);
create policy "Users can update own settings" on user_settings for update using (auth.uid() = user_id);
create policy "Users can insert own settings" on user_settings for insert with check (auth.uid() = user_id);

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

-- Reset monthly scan count
create or replace function reset_monthly_scans()
returns void as $$
begin
  update profiles
  set scans_this_month = 0,
      month_reset_at = date_trunc('month', now()) + interval '1 month'
  where month_reset_at <= now();
end;
$$ language plpgsql security definer;

-- Check if user can scan (returns remaining scans or -1 for unlimited)
create or replace function check_scan_allowance(p_user_id uuid)
returns int as $$
declare
  v_plan plan_type;
  v_scans_used int;
  v_limit int;
begin
  -- Reset if needed
  update profiles
  set scans_this_month = 0,
      month_reset_at = date_trunc('month', now()) + interval '1 month'
  where id = p_user_id and month_reset_at <= now();

  select plan, scans_this_month into v_plan, v_scans_used
  from profiles where id = p_user_id;

  select scans_per_month into v_limit from plans where id = v_plan;

  if v_limit = 0 then return -1; end if;  -- unlimited
  return greatest(v_limit - v_scans_used, 0);
end;
$$ language plpgsql security definer;

-- Increment scan counter
create or replace function increment_scan_count(p_user_id uuid)
returns void as $$
begin
  update profiles
  set scans_this_month = scans_this_month + 1,
      updated_at = now()
  where id = p_user_id;
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
