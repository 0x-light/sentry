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
