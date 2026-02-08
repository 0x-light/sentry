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

export function calculateScanCredits(accounts: number, rangeDays: number): number {
  let multiplier = 1;
  if (rangeDays <= 1) multiplier = 1;
  else if (rangeDays <= 3) multiplier = 2;
  else if (rangeDays <= 7) multiplier = 3;
  else if (rangeDays <= 14) multiplier = 5;
  else if (rangeDays <= 30) multiplier = 8;
  else multiplier = 10;
  return accounts * multiplier;
}

export type AuthState = {
  user: import('@supabase/supabase-js').User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
}
