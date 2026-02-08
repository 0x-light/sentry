export interface Preset {
  name: string;
  accounts: string[];
  hidden?: boolean;
}

export interface Ticker {
  symbol: string;
  action: string;
}

export interface Signal {
  title: string;
  summary: string;
  category: string;
  source: string;
  tickers: Ticker[];
  tweet_url: string;
  links: string[];
  tweet_time?: string;
}

export interface TweetMeta {
  text: string;
  author: string;
  time: string;
}

export interface AccountTweets {
  account: string;
  tweets: Tweet[];
  error?: string | null;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  likeCount?: number;
  retweetCount?: number;
  viewCount?: number;
  url?: string;
  isReply?: boolean;
  inReplyToUsername?: string;
  quoted_tweet?: { text: string; author?: { userName: string } };
  entities?: { urls?: Array<{ url: string; expanded_url: string }>; media?: MediaItem[] };
  extendedEntities?: { media?: MediaItem[] };
  media?: MediaItem[];
  author?: { userName: string };
}

export interface MediaItem {
  type: string;
  media_url_https?: string;
  url?: string;
}

export interface ScanResult {
  date: string;
  range: string;
  days: number;
  accounts: string[];
  totalTweets: number;
  signals: Signal[];
  rawTweets?: { account: string; tweets: Tweet[] }[];
  tweetMeta?: Record<string, TweetMeta>;
}

export interface ScanHistoryEntry {
  date: string;
  range: string;
  accounts: number;
  totalTweets: number;
  signalCount: number;
  signals: Signal[];
}

export interface Analyst {
  id: string;
  name: string;
  prompt: string;
  isDefault?: boolean;
  is_default?: boolean;
}

export interface PriceData {
  price: number;
  change: number;
  ts: number;
}

export interface AnalysisCache {
  v: number;
  entries: Record<string, { signals: Signal[]; ts: number }>;
}

export interface ScanCallbacks {
  onStatus: (text: string, animate?: boolean, showDownload?: boolean) => void;
  onNotice: (type: 'error' | 'warning', message: string) => void;
}

// ============================================================================
// V3 NEW TYPES - User accounts, payments, subscriptions
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan: 'free' | 'pro' | 'ultra';
  plan_details: {
    scans_per_month: number;
    max_accounts_per_scan: number;
    live_feed: boolean;
    all_models: boolean;
    api_access: boolean;
  } | null;
  scans_this_month: number;
  scans_remaining: number;         // -1 = unlimited
  subscription_status: string | null;
  current_period_end: string | null;
  // Legacy compat: computed credits for display
  credits?: number;
}

export interface ApiKeyInfo {
  id: string;
  provider: string;          // 'twitter' | 'anthropic'
  created_at: string;
  last_used_at: string | null;
  masked_key?: string;       // e.g. "sk-ant-...xxxx"
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  priceId: string;
  amount: number;            // cents
  currency: string;
  interval: string;          // 'month' | 'year'
  features: string[];
  scansPerMonth: number | 'unlimited';
  recommended?: boolean;
}

export interface CreditPack {
  id: string;
  name: string;
  priceId: string;
  amount: number;            // cents
  credits: number;
  currency: string;
}

export type AuthState = {
  user: import('@supabase/supabase-js').User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
}
