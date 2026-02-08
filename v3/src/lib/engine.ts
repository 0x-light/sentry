// ============================================================================
// SENTRY ENGINE - Core business logic (ported from app.js)
// ============================================================================

import type { Signal, Tweet, AccountTweets, Analyst, AnalysisCache, PriceData, ScanResult, ScanHistoryEntry, Preset } from './types'
import {
  DEFAULT_PRESETS, DEFAULT_PROMPT, DEFAULT_ANALYST_ID, DEFAULT_MODEL,
  CORS_PROXY, CRYPTO_SLUGS, INDEX_MAP, MODEL_PRICING, TV_SYMBOL_OVERRIDES,
  LS_TW, LS_AN, LS_SCANS, LS_CURRENT, LS_ANALYSTS, LS_ACTIVE_ANALYST,
  LS_DEFAULT_PROMPT_HASH, LS_ACCOUNTS, LS_LOADED_PRESETS, LS_PRESETS,
  LS_THEME, LS_FINANCE, LS_FONT, LS_FONT_SIZE, LS_CASE, LS_ICON_SET,
  LS_RECENTS, LS_ANALYSIS_CACHE, LS_PENDING_SCAN,
  LS_LIVE_ENABLED, LS_MODEL, LS_ONBOARDING_DONE, MAX_RECENTS, CAT_MIGRATE,
} from './constants'

// ============================================================================
// SERVER API MODE — when true, use managed keys via the backend worker
// instead of local BYOK keys. Toggled on for paid users with credits.
// ============================================================================
let _useServerApi = false
export function setUseServerApi(v: boolean) { _useServerApi = v }
export function getUseServerApi(): boolean { return _useServerApi }

// ============================================================================
// UTILITIES
// ============================================================================

export function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

export function sanitizeText(str: string): string {
  if (!str) return '';
  if (typeof str !== 'string') return String(str);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x08) || code === 0x0B || code === 0x0C ||
      (code >= 0x0E && code <= 0x1F) || code === 0x7F || code === 0xFFFD) continue;
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { result += str[i] + str[i + 1]; i++; }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      continue;
    } else {
      result += str[i];
    }
  }
  return result;
}

export function normCat(c: string) { return CAT_MIGRATE[c] || c; }

// ============================================================================
// STORAGE HELPERS
// ============================================================================

export function getTwKey(): string { return localStorage.getItem(LS_TW) || ''; }
export function getAnKey(): string { return localStorage.getItem(LS_AN) || ''; }
export function getModel(): string { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; }
export function getTheme(): string { return localStorage.getItem(LS_THEME) || 'light'; }
export function getFinanceProvider(): string { return localStorage.getItem(LS_FINANCE) || 'tradingview'; }
export function getFont(): string { return localStorage.getItem(LS_FONT) || 'system'; }
export function getFontSize(): string { return localStorage.getItem(LS_FONT_SIZE) || 'medium'; }
export function getCase(): string { return localStorage.getItem(LS_CASE) || 'lower'; }
export function getIconSet(): string { return localStorage.getItem(LS_ICON_SET) || 'sf'; }

export function setTheme(t: string) { localStorage.setItem(LS_THEME, t); }
export function setFont(f: string) { localStorage.setItem(LS_FONT, f); }
export function setFontSize(s: string) { localStorage.setItem(LS_FONT_SIZE, s); }
export function setCase(c: string) { localStorage.setItem(LS_CASE, c); }
export function setIconSet(s: string) { localStorage.setItem(LS_ICON_SET, s); }

export function getShowTickerPrice(): boolean { return localStorage.getItem('signal_show_ticker_price') === 'true'; }
export function setShowTickerPrice(v: boolean) { localStorage.setItem('signal_show_ticker_price', v ? 'true' : 'false'); }

export function isOnboardingDone(): boolean {
  if (localStorage.getItem(LS_ONBOARDING_DONE) === 'true') return true;
  // Auto-skip for existing users who already have API keys or scan data
  if (getTwKey() || getAnKey() || localStorage.getItem(LS_CURRENT)) {
    setOnboardingDone();
    return true;
  }
  return false;
}
export function setOnboardingDone(v = true) { localStorage.setItem(LS_ONBOARDING_DONE, v ? 'true' : 'false'); }

export function bothKeys(): boolean {
  const tw = getTwKey();
  const an = getAnKey();
  return tw.length >= 20 && an.length >= 20;
}

export function validateApiKey(key: string, type: string): boolean {
  if (!key || typeof key !== 'string') return false;
  key = key.trim();
  if (key.length < 20) return false;
  if (type === 'anthropic' && !key.startsWith('sk-ant-')) return false;
  return true;
}

// Accounts
export function getStoredAccounts(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS) || '[]'); } catch { return []; }
}
export function saveAccounts(accounts: string[]) { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(accounts)); }

export function getStoredLoadedPresets(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_LOADED_PRESETS) || '[]'); } catch { return []; }
}
export function saveLoadedPresets(presets: string[]) { localStorage.setItem(LS_LOADED_PRESETS, JSON.stringify(presets)); }

// Presets
export function getPresets(): Preset[] {
  const stored = localStorage.getItem(LS_PRESETS);
  if (!stored) {
    localStorage.setItem(LS_PRESETS, JSON.stringify(DEFAULT_PRESETS));
    return DEFAULT_PRESETS;
  }
  try {
    const parsed: Preset[] = JSON.parse(stored);
    // Merge: always include latest DEFAULT_PRESETS, preserving user's hidden state
    const defaultNames = new Set(DEFAULT_PRESETS.map(p => p.name));
    const merged = DEFAULT_PRESETS.map(defaultPreset => {
      const existing = parsed.find(p => p.name === defaultPreset.name);
      return existing ? { ...defaultPreset, hidden: existing.hidden } : defaultPreset;
    });
    const userPresets = parsed.filter(p => !defaultNames.has(p.name));
    const finalMerged = [...merged, ...userPresets];
    localStorage.setItem(LS_PRESETS, JSON.stringify(finalMerged));
    return finalMerged;
  } catch { return DEFAULT_PRESETS; }
}
export function savePresetsData(p: Preset[]) { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); }

// Recents
export function getRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_RECENTS) || '[]'); } catch { return []; }
}
export function addToRecents(accounts: string[]) {
  let recents = getRecents();
  accounts.forEach(a => {
    recents = recents.filter(r => r !== a);
    recents.unshift(a);
  });
  recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem(LS_RECENTS, JSON.stringify(recents));
}
export function clearRecents() { localStorage.removeItem(LS_RECENTS); }

// Model pricing
export function getModelPricing(modelId: string) {
  const id = modelId.toLowerCase();
  for (const [family, pricing] of Object.entries(MODEL_PRICING)) {
    if (id.includes(family)) return pricing;
  }
  return null;
}
export function formatModelCost(modelId: string): string {
  const p = getModelPricing(modelId);
  if (!p) return '';
  return `$${p.input}/$${p.output} per MTok`;
}
export function modelCostLabel(modelId: string): string {
  const p = getModelPricing(modelId);
  if (!p) return '';
  if (p.input <= 1) return '· $';
  if (p.input <= 5) return '· $$';
  return '· $$$';
}

// Models
export async function fetchAvailableModels(apiKey: string) {
  if (!apiKey || apiKey.length < 20) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data) return null;
    const TIER_ORDER: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
    function extractModelVersion(id: string): number {
      const parts = id.replace(/claude-/, '').split('-').filter((p: string) => !/^\d{8,}$/.test(p));
      const nums = parts.filter((p: string) => /^\d+$/.test(p));
      if (nums.length >= 2) return parseFloat(nums[0] + '.' + nums[1]);
      if (nums.length === 1) return parseFloat(nums[0]);
      return 0;
    }
    return data.data
      .filter((m: any) => m.id.startsWith('claude-') && !m.id.includes('embed'))
      .map((m: any) => ({ id: m.id, name: m.display_name || m.id }))
      .sort((a: any, b: any) => {
        const verA = extractModelVersion(a.id), verB = extractModelVersion(b.id);
        if (verA !== verB) return verB - verA;
        const tierA = Object.keys(TIER_ORDER).find(t => a.id.includes(t));
        const tierB = Object.keys(TIER_ORDER).find(t => b.id.includes(t));
        return (TIER_ORDER[tierA ?? ''] ?? 9) - (TIER_ORDER[tierB ?? ''] ?? 9);
      });
  } catch (e: any) {
    console.warn('Failed to fetch models:', e.message);
    return null;
  }
}

// ============================================================================
// ANALYST MANAGEMENT
// ============================================================================

export function generateAnalystId(): string {
  return 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getAnalysts(): Analyst[] {
  try {
    const raw = localStorage.getItem(LS_ANALYSTS);
    if (raw) return JSON.parse(raw);
  } catch { }
  return [];
}

export function saveAnalysts(analysts: Analyst[]) {
  localStorage.setItem(LS_ANALYSTS, JSON.stringify(analysts));
}

export function getActiveAnalystId(): string {
  return localStorage.getItem(LS_ACTIVE_ANALYST) || DEFAULT_ANALYST_ID;
}
export function setActiveAnalystId(id: string) {
  localStorage.setItem(LS_ACTIVE_ANALYST, id);
}

export function initAnalysts(): Analyst[] {
  let analysts = getAnalysts();
  const currentDefaultHash = hashString(DEFAULT_PROMPT);
  const storedDefaultHash = localStorage.getItem(LS_DEFAULT_PROMPT_HASH);

  if (!analysts.length) {
    analysts = [{
      id: DEFAULT_ANALYST_ID,
      name: 'Default',
      prompt: DEFAULT_PROMPT,
      isDefault: true
    }];
    saveAnalysts(analysts);
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, currentDefaultHash);
    return analysts;
  }

  if (storedDefaultHash !== currentDefaultHash) {
    const defaultAnalyst = analysts.find(a => a.id === DEFAULT_ANALYST_ID);
    if (defaultAnalyst) {
      const userEditedDefault = storedDefaultHash && hashString(defaultAnalyst.prompt) !== storedDefaultHash;
      if (!userEditedDefault) {
        defaultAnalyst.prompt = DEFAULT_PROMPT;
        saveAnalysts(analysts);
      }
    }
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, currentDefaultHash);
  }

  return analysts;
}

export function getActiveAnalyst(analysts: Analyst[]): Analyst {
  const activeId = getActiveAnalystId();
  return analysts.find(a => a.id === activeId)
    || analysts.find(a => a.id === DEFAULT_ANALYST_ID)
    || { id: DEFAULT_ANALYST_ID, name: 'Default', prompt: DEFAULT_PROMPT, isDefault: true };
}

export function getPrompt(analysts: Analyst[]): string {
  return getActiveAnalyst(analysts).prompt;
}

export function getPromptHash(analysts: Analyst[]): string {
  return hashString(`${getModel()}\n${getPrompt(analysts)}`);
}

// Live feed
export function isLiveEnabled(): boolean { return localStorage.getItem(LS_LIVE_ENABLED) === 'true'; }
export function setLiveEnabled(v: boolean) {
  if (v) localStorage.setItem(LS_LIVE_ENABLED, 'true');
  else localStorage.removeItem(LS_LIVE_ENABLED);
}

// ============================================================================
// ANALYSIS CACHE
// ============================================================================

const MAX_CACHE_ENTRIES = 2000;

export function loadAnalysisCache(): AnalysisCache {
  try {
    const raw = localStorage.getItem(LS_ANALYSIS_CACHE);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.entries) return parsed;
  } catch { }
  return { v: 1, entries: {} };
}

export function saveAnalysisCache(cache: AnalysisCache) {
  try { localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(cache)); }
  catch (e: any) { console.warn('Failed to save analysis cache:', e.message); }
}

function cacheKey(promptHash: string, tweetUrl: string): string {
  return `${promptHash}:${tweetUrl}`;
}

export function getCachedSignals(cache: AnalysisCache, promptHash: string, tweetUrl: string): Signal[] | null {
  if (!tweetUrl) return null;
  const entry = cache.entries[cacheKey(promptHash, tweetUrl)];
  if (!entry) return null;
  return (entry.signals || []).filter(isValidSignal);
}

export function setCachedSignals(cache: AnalysisCache, promptHash: string, tweetUrl: string, signals: Signal[]) {
  if (!tweetUrl) return;
  cache.entries[cacheKey(promptHash, tweetUrl)] = { signals: signals || [], ts: Date.now() };
}

export function pruneCache(cache: AnalysisCache) {
  const keys = Object.keys(cache.entries);
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  keys.sort((a, b) => (cache.entries[a]?.ts || 0) - (cache.entries[b]?.ts || 0));
  const removeCount = keys.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i++) delete cache.entries[keys[i]];
}

// ============================================================================
// TWEET HELPERS
// ============================================================================

const tweetCache = new Map<string, Tweet[]>();

export function getTweetUrl(tw: Tweet): string {
  return tw.url || `https://x.com/i/status/${tw.id}`;
}

export function getTweetImageUrl(tw: Tweet): string | null {
  const media = tw.extendedEntities?.media || tw.entities?.media || tw.media || [];
  for (const m of media) {
    if (m.type === 'photo' || m.type === 'image') return m.media_url_https || m.url || null;
  }
  return null;
}

export function formatTweetForAnalysis(tw: Tweet): string {
  const date = new Date(tw.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  const engagement = `${tw.likeCount || 0}♥ ${tw.retweetCount || 0}↻ ${tw.viewCount || 0}👁`;
  const url = getTweetUrl(tw);
  let text = sanitizeText(tw.text || '');
  const externalLinks: string[] = [];
  if (tw.entities?.urls) {
    for (const u of tw.entities.urls) {
      if (u.url && u.expanded_url) {
        const expandedUrl = sanitizeText(u.expanded_url);
        text = text.replace(u.url, expandedUrl);
        if (!expandedUrl.match(/^https?:\/\/(twitter\.com|x\.com|t\.co)\//)) {
          externalLinks.push(expandedUrl);
        }
      }
    }
  }
  const parts = [`[${date}] ${text}`, `engagement: ${engagement}`, `tweet_url: ${url}`];
  if (externalLinks.length) parts.push(`external_links: ${externalLinks.join(', ')}`);
  if (tw.isReply) parts.push(`(reply to @${tw.inReplyToUsername || 'unknown'})`);
  if (tw.quoted_tweet) {
    const quotedText = sanitizeText(tw.quoted_tweet.text || '');
    const quotedAuthor = tw.quoted_tweet.author?.userName || 'unknown';
    parts.push(`--- QUOTED TWEET from @${quotedAuthor} ---\n${quotedText}\n--- END QUOTED TWEET ---`);
  }
  return parts.join('\n');
}

// ============================================================================
// TWITTER API
// ============================================================================

function backoffDelay(attempt: number, baseDelay = 2000, maxDelay = 60000, jitter = 0.3): number {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitterAmount = exponentialDelay * jitter * Math.random();
  return exponentialDelay + jitterAmount;
}

function getCacheKey(account: string, days: number): string {
  const hour = Math.floor(Date.now() / 3600000);
  return `${account}:${days}:${hour}`;
}

export async function fetchTweetsWithRetry(
  account: string, days: number, maxRetries = 3, signal: AbortSignal | null = null
): Promise<Tweet[]> {
  const key = getCacheKey(account, days);
  if (tweetCache.has(key)) return tweetCache.get(key)!;

  // Server API mode: use managed keys via the backend worker
  if (_useServerApi) {
    const { fetchTweets } = await import('./api')
    const result = await fetchTweets(account, days)
    const tweets = (result.tweets || []) as Tweet[]
    if (tweets.length > 0) tweetCache.set(key, tweets)
    return tweets
  }

  const twKey = getTwKey();
  if (!twKey) throw new Error('No Twitter API key configured. Add it in Settings.');

  const cutoff = new Date(Date.now() - days * 86400000);
  const allTweets: Tweet[] = [];
  let cursor: string | null = null;
  let pages = 0;
  const MAX_PAGES = 5;
  let consecutiveErrors = 0;

  while (pages < MAX_PAGES) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);
    const targetUrl = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;
    const fetchUrl = CORS_PROXY + encodeURIComponent(targetUrl);
    let data: any;
    let pageRetries = 0;

    while (pageRetries <= maxRetries) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      try {
        const res = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'X-API-Key': twKey, 'Accept': 'application/json' },
          signal: signal ?? undefined,
        });
        if (res.status === 401 || res.status === 403) {
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API auth error: ${body.slice(0, 100) || 'invalid key'}`);
        }
        if (res.status === 429) {
          const waitMs = backoffDelay(pageRetries, 5000, 30000);
          await new Promise(r => setTimeout(r, waitMs));
          pageRetries++; continue;
        }
        if (!res.ok) {
          if (pageRetries < maxRetries) {
            await new Promise(r => setTimeout(r, backoffDelay(pageRetries, 1000, 10000)));
            pageRetries++; continue;
          }
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API error ${res.status}: ${body.slice(0, 100) || res.statusText}`);
        }
        const text = await res.text();
        try { data = JSON.parse(text); } catch {
          if (pageRetries < maxRetries) { pageRetries++; continue; }
          throw new Error('Invalid JSON from Twitter API');
        }
        break;
      } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        if (e.message.includes('auth error') || e.message.includes('No Twitter API')) throw e;
        if (pageRetries >= maxRetries) throw e;
        await new Promise(r => setTimeout(r, backoffDelay(pageRetries, 1000, 10000)));
        pageRetries++;
      }
    }

    const apiData = data.data || data;
    if (data.status === 'error' || (data.status !== 'success' && data.message)) {
      consecutiveErrors++;
      if (consecutiveErrors >= 2) break;
      continue;
    }
    consecutiveErrors = 0;
    const tweets = apiData.tweets || [];
    if (!tweets.length) break;
    let hitCutoff = false;
    for (const tw of tweets) {
      const created = new Date(tw.createdAt);
      if (created < cutoff) { hitCutoff = true; break; }
      allTweets.push(tw);
    }
    if (hitCutoff) break;
    if (!apiData.has_next_page || !apiData.next_cursor) break;
    cursor = apiData.next_cursor;
    pages++;
    await new Promise(r => setTimeout(r, 100));
  }

  if (allTweets.length > 0) tweetCache.set(key, allTweets);
  return allTweets;
}

// ---------------------------------------------------------------------------
// PREFETCH — start fetching tweets in the background when user adds accounts
// This warms the in-memory cache so the actual scan starts instantly.
// ---------------------------------------------------------------------------
const prefetchInFlight = new Set<string>();

export function prefetchTweets(account: string, days: number) {
  const key = getCacheKey(account, days);
  if (tweetCache.has(key) || prefetchInFlight.has(key)) return;
  prefetchInFlight.add(key);
  fetchTweetsWithRetry(account, days, 2, null)
    .catch(() => {}) // swallow errors — this is best-effort
    .finally(() => prefetchInFlight.delete(key));
}

export function prefetchMultiple(accounts: string[], days: number) {
  // Stagger prefetches to avoid hammering the API
  accounts.forEach((account, i) => {
    setTimeout(() => prefetchTweets(account, days), i * 200);
  });
}

export async function fetchAllTweets(
  accounts: string[], days: number,
  onProgress: (msg: string) => void, signal: AbortSignal | null
): Promise<AccountTweets[]> {
  const BATCH_SIZE = 3;
  const accountTweets: AccountTweets[] = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const batch = accounts.slice(i, i + BATCH_SIZE);
    onProgress(`Fetching ${i + 1}-${Math.min(i + batch.length, accounts.length)} of ${accounts.length}`);
    const results = await Promise.all(batch.map(async (account) => {
      if (signal?.aborted) return { account, tweets: [] as Tweet[], error: 'Cancelled' };
      try {
        const tweets = await fetchTweetsWithRetry(account, days, 3, signal);
        return { account, tweets, error: null };
      } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        return { account, tweets: [] as Tweet[], error: e.message };
      }
    }));
    accountTweets.push(...results);
    if (i + BATCH_SIZE < accounts.length) await new Promise(r => setTimeout(r, 50));
  }
  return accountTweets;
}

// ============================================================================
// TWITTER FOLLOWING
// ============================================================================

export async function fetchFollowing(
  username: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal | null
): Promise<string[]> {
  const twKey = getTwKey();
  if (!twKey) throw new Error('No Twitter API key configured. Add it in Settings.');

  const allUsernames: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  const MAX_PAGES = 20;

  while (pages < MAX_PAGES) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const params = new URLSearchParams({ userName: username });
    if (cursor) params.set('cursor', cursor);
    const targetUrl = `https://api.twitterapi.io/twitter/user/followings?${params}`;
    const fetchUrl = CORS_PROXY + encodeURIComponent(targetUrl);
    let data: any;
    let retries = 0;
    const maxRetries = 3;

    while (retries <= maxRetries) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const res = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'X-API-Key': twKey, 'Accept': 'application/json' },
          signal: signal ?? undefined,
        });
        if (res.status === 401 || res.status === 403) {
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API auth error: ${body.slice(0, 100) || 'invalid key'}`);
        }
        if (res.status === 429) {
          const waitMs = backoffDelay(retries, 5000, 30000);
          await new Promise(r => setTimeout(r, waitMs));
          retries++; continue;
        }
        if (!res.ok) {
          if (retries < maxRetries) {
            await new Promise(r => setTimeout(r, backoffDelay(retries, 1000, 10000)));
            retries++; continue;
          }
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API error ${res.status}: ${body.slice(0, 100) || res.statusText}`);
        }
        const text = await res.text();
        try { data = JSON.parse(text); } catch {
          if (retries < maxRetries) { retries++; continue; }
          throw new Error('Invalid JSON from Twitter API');
        }
        break;
      } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        if (e.message.includes('auth error') || e.message.includes('No Twitter API')) throw e;
        if (retries >= maxRetries) throw e;
        await new Promise(r => setTimeout(r, backoffDelay(retries, 1000, 10000)));
        retries++;
      }
    }

    const apiData = data?.data || data;
    if (data?.status === 'error' || (data?.status !== 'success' && data?.message)) {
      throw new Error(data?.message || 'Failed to fetch following list');
    }

    const users = apiData?.followings || apiData?.users || apiData?.following || [];
    if (!users.length) break;

    for (const user of users) {
      const uname = user.userName || user.username || user.screen_name;
      if (uname) allUsernames.push(uname.toLowerCase());
    }

    onProgress?.(`Fetched ${allUsernames.length} accounts...`);

    if (!apiData.has_next_page || !apiData.next_cursor) break;
    cursor = apiData.next_cursor;
    pages++;
    await new Promise(r => setTimeout(r, 100));
  }

  return [...new Set(allUsernames)];
}

// ============================================================================
// ANTHROPIC API
// ============================================================================

const API_CONFIG = {
  baseUrl: 'https://api.anthropic.com/v1/messages',
  maxRetries: 5,
  maxDelay: 120000,
};

function categorizeError(error: any, status?: number): string {
  if (status === 429 || status === 529) return 'rate_limit';
  if (error?.type === 'overloaded_error') return 'overloaded';
  if (error?.type === 'rate_limit_error') return 'rate_limit';
  if (error?.message?.includes('credit balance')) return 'billing';
  if (error?.message?.includes('billing')) return 'billing';
  if (error?.message?.includes('prompt is too long')) return 'input_too_large';
  if (error?.type === 'not_found_error') return 'model_not_found';
  if (error?.type === 'authentication_error') return 'auth_error';
  if (error?.type === 'invalid_request_error') return 'invalid_request';
  return 'unknown';
}

export async function anthropicCall(
  body: any, maxRetries = API_CONFIG.maxRetries,
  signal: AbortSignal | null = null,
  onStreamProgress?: (p: { outputTokens?: number; inputTokens?: number; receivingData?: boolean }) => void,
  onStatusUpdate?: (msg: string) => void
): Promise<{ content: Array<{ type: string; text: string }>; usage: { input_tokens: number; output_tokens: number } }> {
  // Server API mode: use managed Anthropic key via the backend worker
  if (_useServerApi) {
    const { analyze } = await import('./api')
    const result = await analyze({
      model: body.model,
      max_tokens: body.max_tokens,
      messages: body.messages,
      system: body.system,
    })
    onStreamProgress?.({ receivingData: true, outputTokens: result.usage?.output_tokens || 0, inputTokens: result.usage?.input_tokens || 0 })
    return result
  }

  const key = getAnKey();
  if (!key) throw new Error('No Anthropic API key configured. Add it in Settings.');
  const isSlowModel = (body.model || '').toLowerCase().includes('opus');
  const requestTimeout = isSlowModel ? 300000 : 180000;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), requestTimeout);
      let combinedSignal: AbortSignal;
      if (!signal) {
        combinedSignal = timeoutController.signal;
      } else if (typeof AbortSignal.any === 'function') {
        combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
      } else {
        combinedSignal = timeoutController.signal;
        signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }

      // Enable Anthropic prompt caching: if body has a `system` field,
      // add cache_control to the first block so the system prompt is cached
      // server-side. This gives ~90% input token discount on subsequent calls
      // with the same system prompt (e.g. same analyst prompt across batches).
      const systemWithCache = body.system
        ? (Array.isArray(body.system) ? body.system : [{ type: 'text', text: body.system }])
            .map((block: any, i: number) => i === 0 ? { ...block, cache_control: { type: 'ephemeral' } } : block)
        : undefined;

      const streamBody = {
        ...body,
        stream: true,
        ...(systemWithCache ? { system: systemWithCache } : {}),
      };
      const res = await fetch(API_CONFIG.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(streamBody),
        signal: combinedSignal,
      });

      if (!res.ok) {
        clearTimeout(timeoutId);
        let errorData: any;
        try { errorData = await res.json(); } catch { errorData = { error: { message: `HTTP ${res.status}` } }; }
        if (errorData.error) {
          const errorType = categorizeError(errorData.error, res.status);
          if (['input_too_large', 'model_not_found', 'auth_error', 'invalid_request', 'billing'].includes(errorType)) {
            const messages: Record<string, string> = {
              input_too_large: 'Input too large. Try fewer accounts or a shorter time range.',
              model_not_found: 'Model not available. Your API key may not have access to this model.',
              auth_error: 'Invalid API key. Please check your Anthropic API key in Settings.',
              invalid_request: errorData.error?.message || 'Invalid request to Anthropic API.',
              billing: 'Credit balance too low. Add credits at platform.claude.com/settings/billing',
            };
            throw new Error(messages[errorType] || errorData.error?.message);
          }
          if (['rate_limit', 'overloaded', 'quota'].includes(errorType)) {
            if (attempt >= maxRetries) throw new Error('API rate limited after multiple attempts. Please wait a few minutes.');
            const baseWait = errorType === 'quota' ? 45000 : 15000;
            const waitMs = backoffDelay(attempt, baseWait, API_CONFIG.maxDelay);
            onStatusUpdate?.(`Rate limited · Retry ${attempt + 2}/${maxRetries + 1} in ${Math.ceil(waitMs / 1000)}s`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          lastError = errorData.error;
          if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 2000, 30000)));
          continue;
        }
      }

      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let buffer = '';
      let streamError: any = null;

      while (true) {
        if (signal?.aborted) { reader.cancel(); throw new DOMException('Scan cancelled', 'AbortError'); }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                fullText += event.delta.text;
                onStreamProgress?.({ outputTokens: Math.ceil(fullText.length / 4), receivingData: true });
              } else if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens || outputTokens;
              } else if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
                onStreamProgress?.({ inputTokens, receivingData: true });
              } else if (event.type === 'error') {
                streamError = event.error;
              }
            } catch { }
          }
        }
      }
      clearTimeout(timeoutId);

      if (streamError) {
        const errorType = categorizeError(streamError);
        if (['rate_limit', 'overloaded', 'quota'].includes(errorType)) {
          if (attempt >= maxRetries) throw new Error('API rate limited after multiple attempts.');
          const waitMs = backoffDelay(attempt, 15000, API_CONFIG.maxDelay);
          onStatusUpdate?.(`Rate limited · Retry ${attempt + 2}/${maxRetries + 1} in ${Math.ceil(waitMs / 1000)}s`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        lastError = streamError;
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 2000, 30000)));
        continue;
      }

      if (fullText) {
        return { content: [{ type: 'text', text: fullText }], usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
      }
      lastError = new Error('Empty response from Anthropic API');
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 2000, 30000)));
    } catch (e: any) {
      if (e.name === 'AbortError' && signal?.aborted) throw e;
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        lastError = new Error('Request timed out. The model may be overloaded.');
        if (attempt < maxRetries) {
          onStatusUpdate?.(`Request timed out · Retrying (${attempt + 2}/${maxRetries + 1})`);
          await new Promise(r => setTimeout(r, backoffDelay(attempt, 5000, 30000)));
        }
        continue;
      }
      if (e.message.includes('No Anthropic') || e.message.includes('Invalid API') ||
        e.message.includes('Input too large') || e.message.includes('Credit balance')) throw e;
      lastError = e;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 3000, 30000)));
    }
  }
  throw new Error(lastError?.message || 'Failed to connect to Anthropic API after multiple attempts.');
}

function extractText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b: any) => b.type === 'text' && b.text).map((b: any) => b.text).join('\n');
}

// ============================================================================
// SIGNAL PARSING
// ============================================================================

export function isValidSignal(s: any): s is Signal {
  if (!s || typeof s !== 'object') return false;
  const hasTitle = typeof s.title === 'string' && s.title.trim().length > 0;
  const hasSummary = typeof s.summary === 'string' && s.summary.trim().length > 0;
  return hasTitle || hasSummary;
}

export function safeParseSignals(text: string): Signal[] {
  if (!text) return [];
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];
  let jsonStr = arrayMatch[0];
  let parsed: any[] | null = null;
  try {
    const result = JSON.parse(jsonStr);
    if (Array.isArray(result)) parsed = result;
  } catch { }
  if (!parsed) {
    try {
      jsonStr = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
      jsonStr = jsonStr.replace(/([^\\])\\n(?=")/g, '$1\\\\n');
      const result = JSON.parse(jsonStr);
      if (Array.isArray(result)) parsed = result;
    } catch { }
  }
  if (!parsed) {
    try {
      jsonStr = sanitizeText(jsonStr);
      const result = JSON.parse(jsonStr);
      if (Array.isArray(result)) parsed = result;
    } catch { }
  }
  if (!parsed) return [];
  return parsed.filter(isValidSignal);
}

export function groupSignalsByTweet(signals: Signal[]): Map<string, Signal[]> {
  const map = new Map<string, Signal[]>();
  signals.forEach(s => {
    const url = s.tweet_url;
    if (!url) return;
    if (!map.has(url)) map.set(url, []);
    map.get(url)!.push(s);
  });
  return map;
}

export function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter(s => {
    const key = s.tweet_url || `${s.title || ''}|${s.summary || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// SCAN ENGINE
// ============================================================================

const MAX_BATCH_CHARS = 640000;
const MAX_BATCH_CHARS_WITH_IMAGES = 400000;
const MAX_IMAGES_PER_BATCH = 5;
const BATCH_SEPARATOR = '\n\n======\n\n';
const ANALYSIS_CONCURRENCY = 3;
const ANALYSIS_CONCURRENCY_SLOW = 2;

interface BatchItem {
  account: string;
  text: string;
  size: number;
  tweetUrls: string[];
  imageUrls: string[];
}

interface Batch {
  text: string;
  tweetUrls: string[];
  imageUrls: string[];
  accounts: string[];
  size: number;
}

function buildBatches(accountData: AccountTweets[], promptChars: number): Batch[] {
  const items: BatchItem[] = accountData.map(a => {
    const header = `=== @${a.account} (${a.tweets.length} tweets) ===`;
    const body = a.tweets.map(formatTweetForAnalysis).join('\n---\n');
    const accountText = `${header}\n${body}`;
    const tweetUrls = a.tweets.map(getTweetUrl).filter(Boolean);
    const imageUrls = a.tweets.map(getTweetImageUrl).filter((u): u is string => !!u);
    return { account: a.account, text: accountText, size: accountText.length, tweetUrls, imageUrls };
  });
  const hasAnyImages = items.some(i => i.imageUrls.length > 0);
  const maxChars = hasAnyImages ? MAX_BATCH_CHARS_WITH_IMAGES : MAX_BATCH_CHARS;
  items.sort((a, b) => b.size - a.size);
  const batches: Array<{ items: BatchItem[]; size: number; tweetUrls: string[]; imageUrls: string[] }> = [];
  items.forEach(item => {
    let placed = false;
    for (const batch of batches) {
      const extra = (batch.items.length ? BATCH_SEPARATOR.length : 0) + item.size;
      if (batch.size + extra <= maxChars) {
        batch.items.push(item);
        batch.size += extra;
        batch.tweetUrls.push(...item.tweetUrls);
        batch.imageUrls.push(...item.imageUrls);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push({ items: [item], size: promptChars + item.size, tweetUrls: [...item.tweetUrls], imageUrls: [...item.imageUrls] });
    }
  });
  return batches.map(b => ({
    text: b.items.map(i => i.text).join(BATCH_SEPARATOR),
    tweetUrls: [...new Set(b.tweetUrls)],
    imageUrls: [...new Set(b.imageUrls)].slice(0, MAX_IMAGES_PER_BATCH),
    accounts: b.items.map(i => i.account),
    size: b.size,
  }));
}

export async function analyzeWithBatching(
  accountData: AccountTweets[], totalTweets: number,
  onProgress: (msg: string) => void, promptHash: string,
  cache: AnalysisCache, signal: AbortSignal | null,
  analysts: Analyst[]
): Promise<Signal[]> {
  const prompt = getPrompt(analysts);
  const batches = buildBatches(accountData, prompt.length);
  if (!batches.length) return [];

  const allSignals: Signal[] = [];
  const results: Array<{ i: number; signals: Signal[]; tweetUrls: string[] }> = [];
  let nextIndex = 0;
  const modelName = getModel().toLowerCase();
  const isSlowModel = modelName.includes('opus');
  const maxConcurrency = isSlowModel ? ANALYSIS_CONCURRENCY_SLOW : ANALYSIS_CONCURRENCY;
  const concurrency = Math.min(maxConcurrency, batches.length);

  async function runBatchWorker() {
    while (true) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const i = nextIndex++;
      if (i >= batches.length) break;
      const batch = batches[i];
      const batchNum = i + 1;
      const batchLabel = batches.length > 1
        ? `Analyzing batch ${batchNum}/${batches.length}`
        : `${totalTweets} tweets fetched · Analyzing`;
      onProgress(batchLabel);

      const batchStart = Date.now();
      let streamState = { receivingData: false, outputTokens: 0 };
      const elapsedTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - batchStart) / 1000);
        if (streamState.receivingData && streamState.outputTokens > 0) {
          const tokK = (streamState.outputTokens / 1000).toFixed(1);
          onProgress(`${batchLabel} · ${elapsed}s · ${tokK}k tokens`);
        } else {
          onProgress(`${batchLabel} · ${elapsed}s`);
        }
      }, 1000);

      // Separate system prompt from tweet data so Anthropic can cache
      // the system prompt across batches (90%+ input token savings on
      // batches 2+ since only the tweet data changes).
      const tweetContent = sanitizeText(batch.text);
      let messageContent: any;
      if (batch.imageUrls.length > 0) {
        messageContent = [
          { type: 'text', text: tweetContent },
          ...batch.imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } }))
        ];
      } else {
        messageContent = tweetContent;
      }

      try {
        const data = await anthropicCall(
          {
            model: getModel(),
            max_tokens: 16384,
            system: [{ type: 'text', text: prompt }],
            messages: [{ role: 'user', content: messageContent }],
          },
          5, signal,
          (progress) => { Object.assign(streamState, progress); },
          (msg) => onProgress(msg)
        );
        clearInterval(elapsedTimer);
        const txt = extractText(data.content);
        const batchSignals = safeParseSignals(txt);
        results.push({ i, signals: batchSignals, tweetUrls: batch.tweetUrls });
        const grouped = groupSignalsByTweet(batchSignals);
        batch.tweetUrls.forEach(url => setCachedSignals(cache, promptHash, url, grouped.get(url) || []));
        saveAnalysisCache(cache);
      } catch (e) {
        clearInterval(elapsedTimer);
        throw e;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runBatchWorker()));
  results.sort((a, b) => a.i - b.i);
  results.forEach(res => {
    allSignals.push(...res.signals);
    const grouped = groupSignalsByTweet(res.signals);
    res.tweetUrls.forEach(url => setCachedSignals(cache, promptHash, url, grouped.get(url) || []));
  });
  saveAnalysisCache(cache);
  return allSignals;
}

// ============================================================================
// FULL SCAN
// ============================================================================

export async function runScan(
  accounts: string[], days: number, signal: AbortSignal | null,
  onStatus: (text: string, animate?: boolean) => void,
  onNotice: (type: 'error' | 'warning', msg: string) => void,
  analysts: Analyst[]
): Promise<ScanResult | null> {
  onStatus('', true);

  const accountTweets = await fetchAllTweets(accounts, days, (msg) => onStatus(msg, true), signal);
  const totalTweets = accountTweets.reduce((s, a) => s + a.tweets.length, 0);
  const fails = accountTweets.filter(a => a.error);

  if (totalTweets === 0) {
    let msg = 'No tweets found for this time range';
    if (fails.length) msg += ` — errors: ${fails.map(f => `${f.account} (${f.error})`).join(', ')}`;
    onNotice('error', msg);
    return null;
  }

  if (fails.length) onNotice('warning', `Errors: ${fails.map(f => f.account).join(', ')}`);

  // Save pending scan
  savePendingScan(accounts, days, accountTweets);

  const accountData = accountTweets.filter(a => a.tweets.length);
  const promptHash = getPromptHash(analysts);
  const analysisCache = loadAnalysisCache();
  let cachedSignals: Signal[] = [];

  const uncachedAccountData = accountData.map(a => {
    const uncachedTweets: Tweet[] = [];
    (a.tweets || []).forEach(tw => {
      const url = getTweetUrl(tw);
      const cached = getCachedSignals(analysisCache, promptHash, url);
      if (cached) cachedSignals.push(...cached);
      else uncachedTweets.push(tw);
    });
    return { account: a.account, tweets: uncachedTweets };
  }).filter(a => a.tweets.length);

  let signals: Signal[];
  if (uncachedAccountData.length) {
    const newSignals = await analyzeWithBatching(
      uncachedAccountData, totalTweets,
      (msg) => onStatus(msg, true),
      promptHash, analysisCache, signal, analysts
    );
    signals = dedupeSignals([...cachedSignals, ...newSignals]);
  } else {
    onStatus(`${totalTweets} tweets fetched · Using cache`, false);
    signals = dedupeSignals(cachedSignals);
  }

  pruneCache(analysisCache);
  saveAnalysisCache(analysisCache);

  const result: ScanResult = {
    date: new Date().toISOString(),
    range: '', // filled by caller
    days,
    accounts: [...accounts],
    totalTweets,
    signals,
    rawTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets })),
  };

  clearPendingScan();
  return result;
}

// ============================================================================
// SCAN STORAGE
// ============================================================================

export function saveScan(scan: ScanResult, skipHistory = false) {
  try {
    const tweetMeta: Record<string, any> = {};
    if (scan.rawTweets) {
      scan.rawTweets.forEach(a => {
        (a.tweets || []).forEach(tw => {
          const url = getTweetUrl(tw);
          tweetMeta[url] = { text: (tw.text || '').slice(0, 500), author: a.account, time: tw.createdAt };
        });
      });
    }
    const storable = { date: scan.date, range: scan.range, days: scan.days, accounts: scan.accounts, totalTweets: scan.totalTweets, signals: scan.signals, tweetMeta };
    localStorage.setItem(LS_CURRENT, JSON.stringify(storable));

    if (skipHistory) return;
    const history: ScanHistoryEntry[] = JSON.parse(localStorage.getItem(LS_SCANS) || '[]');
    const tweetTimes: Record<string, string> = {};
    if (scan.rawTweets) {
      scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        if (tw.createdAt) tweetTimes[url] = tw.createdAt;
      }));
    }
    const historyEntry: ScanHistoryEntry = {
      date: scan.date, range: scan.range,
      accounts: scan.accounts.length, totalTweets: scan.totalTweets,
      signalCount: scan.signals.length,
      signals: scan.signals.map(s => ({ ...s, tweet_time: tweetTimes[s.tweet_url] || undefined }))
    };
    if (history.length > 0) {
      const prev = new Date(history[0].date).getTime();
      const curr = new Date(scan.date).getTime();
      if (Math.abs(curr - prev) < 120000) history[0] = historyEntry;
      else history.unshift(historyEntry);
    } else {
      history.unshift(historyEntry);
    }
    if (history.length > 5) history.pop();
    localStorage.setItem(LS_SCANS, JSON.stringify(history));
  } catch (e: any) {
    console.warn('Failed to save scan:', e.message);
  }
}

export function loadCurrentScan(): ScanResult | null {
  const saved = localStorage.getItem(LS_CURRENT);
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
}

export function getScanHistory(): ScanHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_SCANS) || '[]'); } catch { return []; }
}

export function deleteHistoryScan(index: number) {
  const history = getScanHistory();
  if (index < 0 || index >= history.length) return;
  history.splice(index, 1);
  localStorage.setItem(LS_SCANS, JSON.stringify(history));
}

// Pending scan
export function savePendingScan(accounts: string[], days: number, accountTweets: AccountTweets[]) {
  try {
    const pending = {
      date: new Date().toISOString(), accounts: [...accounts], days,
      accountTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets, error: a.error || null })),
    };
    localStorage.setItem(LS_PENDING_SCAN, JSON.stringify(pending));
  } catch { }
}
export function clearPendingScan() { localStorage.removeItem(LS_PENDING_SCAN); }
export function loadPendingScan(): any | null {
  const raw = localStorage.getItem(LS_PENDING_SCAN);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    if (Date.now() - new Date(pending.date).getTime() > 3600000) { clearPendingScan(); return null; }
    return pending;
  } catch { clearPendingScan(); return null; }
}

// Export/Import
export function exportData(customAccounts: string[], loadedPresets: string[], analysts: Analyst[]): string {
  const data = {
    v: 1,
    settings: { theme: getTheme(), font: getFont(), fontSize: getFontSize(), financeProvider: getFinanceProvider(), model: getModel() },
    keys: { twitter: getTwKey(), anthropic: getAnKey() },
    presets: getPresets(), analysts, activeAnalyst: getActiveAnalystId(),
    accounts: customAccounts, loadedPresets, recents: getRecents(),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function importData(encoded: string): any {
  const json = decodeURIComponent(escape(atob(encoded.trim())));
  return JSON.parse(json);
}

// ============================================================================
// PRICES
// ============================================================================

export const priceCache: Record<string, PriceData> = {};
const PRICE_CACHE_TTL = 60000;

export function normalizeSymbol(sym: string): string {
  const clean = sym.replace(/^\$/, '').toUpperCase();
  return INDEX_MAP[clean] || clean;
}

export function isCrypto(sym: string): boolean {
  return !!CRYPTO_SLUGS[sym.replace(/^\$/, '').toUpperCase()];
}

/** TradingView symbol — checks override map, then BINANCE:XUSDT for crypto, else raw symbol */
export function getTvSymbol(sym: string): string {
  const clean = sym.replace(/^\$/, '').toUpperCase();
  if (TV_SYMBOL_OVERRIDES[clean]) return TV_SYMBOL_OVERRIDES[clean];
  if (CRYPTO_SLUGS[clean]) return `BINANCE:${clean}USDT`;
  return clean;
}

export function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(3);
}

export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return sign + change.toFixed(2) + '%';
}

export async function fetchCryptoPrices(symbols: string[]) {
  const now = Date.now();
  const needed = symbols.filter(s => { const c = priceCache[s]; return !c || (now - c.ts > PRICE_CACHE_TTL); });
  if (!needed.length) return;
  const ids = needed.map(s => CRYPTO_SLUGS[s]).filter(Boolean);
  if (!ids.length) return;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    needed.forEach(sym => {
      const slug = CRYPTO_SLUGS[sym];
      if (data[slug]) priceCache[sym] = { price: data[slug].usd, change: data[slug].usd_24h_change || 0, ts: now };
    });
  } catch { }
}

export async function fetchStockPrice(sym: string, originalSym?: string) {
  const cacheKey = originalSym || sym;
  const now = Date.now();
  if (priceCache[cacheKey] && (now - priceCache[cacheKey].ts < PRICE_CACHE_TTL)) return;
  try {
    const yahooSym = normalizeSymbol(sym);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2d`;
    const url = `https://proxy.sentry.is/?url=${encodeURIComponent(yahooUrl)}`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return;
    const price = result.meta?.regularMarketPrice;
    const prevClose = result.meta?.chartPreviousClose || result.meta?.previousClose;
    if (price == null) return;
    const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    priceCache[cacheKey] = { price, change, ts: now };
  } catch { }
}

export async function fetchAllPrices(symbols: string[]) {
  const cryptoSyms: string[] = [];
  const stockSyms: string[] = [];
  symbols.forEach(s => {
    const clean = s.replace(/^\$/, '').toUpperCase();
    if (CRYPTO_SLUGS[clean]) cryptoSyms.push(clean);
    else stockSyms.push(clean);
  });
  const promises: Promise<void>[] = [];
  if (cryptoSyms.length) promises.push(fetchCryptoPrices(cryptoSyms));
  stockSyms.forEach(s => promises.push(fetchStockPrice(s, s)));
  await Promise.all(promises);
}

export function tickerUrl(sym: string): string {
  const s = sym.replace(/^\$/, '').toUpperCase();
  const provider = getFinanceProvider();
  if (provider === 'tradingview') {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(getTvSymbol(s))}`;
  }
  if (CRYPTO_SLUGS[s]) return `https://www.coingecko.com/en/coins/${CRYPTO_SLUGS[s]}`;
  if (provider === 'google') return `https://www.google.com/finance/quote/${s}?window=6M`;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`;
}

// ============================================================================
// SHARING
// ============================================================================

export function encodeSignal(signal: Signal): string {
  const compact = {
    t: signal.title || '', s: signal.summary || '', c: signal.category || '',
    src: (signal.source || '').replace(/^@/, ''),
    tk: (signal.tickers || []).map(t => ({ s: t.symbol, a: t.action })),
    u: signal.tweet_url || '',
    ...(signal.links?.length ? { ln: signal.links } : {}),
  };
  const json = JSON.stringify(compact);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSignal(encoded: string): Signal | null {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const compact = JSON.parse(json);
    return {
      title: compact.t || '', summary: compact.s || '', category: compact.c || '',
      source: compact.src || '',
      tickers: (compact.tk || []).map((t: any) => ({ symbol: t.s, action: t.a })),
      tweet_url: compact.u || '', links: compact.ln || [],
    };
  } catch { return null; }
}

// ============================================================================
// DOWNLOAD
// ============================================================================

export function downloadScanAsMarkdown(scan: ScanResult) {
  const tweetText: Record<string, string> = {};
  if (scan.rawTweets) {
    scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => {
      tweetText[getTweetUrl(tw)] = tw.text || '';
    }));
  } else if (scan.tweetMeta) {
    Object.entries(scan.tweetMeta).forEach(([url, meta]) => { tweetText[url] = meta.text || ''; });
  }
  const d = new Date(scan.date);
  const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let md = `# Trading Signals\n\n**Date:** ${dateStr}\n**Range:** ${scan.range}\n**Accounts:** ${scan.accounts.length}\n**Signals:** ${scan.signals.length}\n\n---\n\n`;
  scan.signals.forEach((s, i) => {
    const cat = normCat(s.category);
    const tickers = (s.tickers || []).map(t => `${t.symbol} (${t.action})`).join(', ');
    md += `## ${s.title}\n\n${s.summary}\n\n`;
    if (tickers) md += `**Tickers:** ${tickers}\n`;
    md += `**Category:** ${cat}\n**Source:** @${s.source}\n`;
    if (i < scan.signals.length - 1) md += `\n---\n\n`;
  });
  const date = new Date(scan.date).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sentry-${date}.md`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
