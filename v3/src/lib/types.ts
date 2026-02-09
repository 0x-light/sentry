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
  id?: string;          // server-side scan ID (for cross-device sync + deletion)
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
// V3 NEW TYPES - User accounts, credits, payments
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  credits_balance: number;
  has_credits: boolean;          // credits_balance > 0
  free_scan_available: boolean;  // for BYOK users: can they scan today?
  subscription_status: string | null;  // 'active' if recurring credit pack
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  price: number;               // cents
  perCredit: number;           // price per credit in dollars
  savings?: string;            // e.g. "13% off"
  recommended?: boolean;
  estimates: {
    label: string;
    count: number;
  }[];
}

// Range multipliers for credit calculation (must match backend)
export const CREDIT_MULTIPLIERS: Record<number, number> = {
  1: 1,
  3: 2,
  7: 3,
  14: 5,
  30: 8,
};

// Model credit multipliers (relative to Sonnet = 1.0)
const MODEL_CREDIT_MULTIPLIER: Record<string, number> = { haiku: 0.25, sonnet: 1, opus: 5 };

function getModelCreditMultiplier(model?: string): number {
  const id = (model || '').toLowerCase();
  for (const [tier, mult] of Object.entries(MODEL_CREDIT_MULTIPLIER)) {
    if (id.includes(tier)) return mult;
  }
  return 1;
}

export function calculateScanCredits(accounts: number, rangeDays: number, model?: string): number {
  let rangeMultiplier = 1;
  if (rangeDays <= 1) rangeMultiplier = 1;
  else if (rangeDays <= 3) rangeMultiplier = 2;
  else if (rangeDays <= 7) rangeMultiplier = 3;
  else if (rangeDays <= 14) rangeMultiplier = 5;
  else if (rangeDays <= 30) rangeMultiplier = 8;
  else rangeMultiplier = 10;
  return Math.ceil(accounts * rangeMultiplier * getModelCreditMultiplier(model));
}

// ============================================================================
// SCHEDULED SCANS
// ============================================================================

export interface ScheduledScan {
  id: string;
  user_id?: string;
  enabled: boolean;
  time: string;           // "HH:MM" 24-hour format
  timezone: string;       // IANA timezone (e.g. "America/New_York")
  label: string;          // "Morning", "Midday", "Evening", or custom
  days: number[];         // 0-6 (Sun-Sat), empty = every day
  range_days: number;     // 1, 7, or 30
  preset_id?: string | null;   // reference to a preset for accounts
  accounts: string[];     // explicit account list (fallback if no preset)
  last_run_at?: string | null;
  last_run_status?: 'success' | 'error' | 'running' | null;
  last_run_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type AuthState = {
  user: import('@supabase/supabase-js').User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
}
