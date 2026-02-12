// ============================================================================
// SENTRY — Scan Engine
// ============================================================================
//
// Core business logic: tweet fetching, analysis, caching, prices, sharing.
// Ported from v1/js/app.js — all the non-UI, non-auth logic lives here.
//

import {
  DEFAULT_PRESETS, DEFAULT_PROMPT, DEFAULT_ANALYST_ID, DEFAULT_MODEL,
  CORS_PROXY, RANGES, CAT_MIGRATE, MODEL_PRICING,
  CRYPTO_SLUGS, INDEX_MAP, TV_SYMBOL_OVERRIDES, TICKER_SYMBOL_ALIASES,
  LS_TW, LS_AN, LS_SCANS, LS_CURRENT, LS_ANALYSTS, LS_ACTIVE_ANALYST,
  LS_DEFAULT_PROMPT_HASH, LS_ACCOUNTS, LS_LOADED_PRESETS, LS_PRESETS,
  LS_THEME, LS_FINANCE, LS_FONT, LS_FONT_SIZE, LS_CASE, LS_RECENTS,
  LS_ANALYSIS_CACHE, LS_PENDING_SCAN, LS_LIVE_ENABLED, LS_MODEL,
  LS_ONBOARDING_DONE, LS_SHOW_TICKER_PRICE, LS_ICON_SET,
  MAX_RECENTS, MAX_CACHE_ENTRIES,
  ANALYSIS_CONCURRENCY, ANALYSIS_CONCURRENCY_SLOW,
  MAX_BATCH_CHARS, MAX_BATCH_CHARS_WITH_IMAGES, MAX_IMAGES_PER_BATCH,
  BATCH_SEPARATOR,
} from './config.js';

import * as api from './api.js';
import * as auth from './auth.js';

// ============================================================================
// UTILITIES
// ============================================================================

export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

export function sanitizeText(str) {
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

// Reuse a single element for HTML escaping (avoids creating a throwaway DOM element per call)
const _escEl = document.createElement('div');
export const esc = s => { _escEl.textContent = s; return _escEl.innerHTML; };

// Safe localStorage write — swallows quota errors instead of crashing
function safeLsSet(key, value) {
  try { localStorage.setItem(key, value); }
  catch (e) { console.warn('localStorage write failed:', key, e.message); }
}
export function normCat(c) { return CAT_MIGRATE[c] || c; }

const SHOW_TICKER_PRICE_DEFAULT = true;
let showTickerPriceRuntime = null;
let showTickerPriceReadWarned = false;

// ============================================================================
// SETTINGS
// ============================================================================

export function getTwKey() { return localStorage.getItem(LS_TW) || ''; }
export function getAnKey() { return localStorage.getItem(LS_AN) || ''; }
export function getModel() { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; }
export function getTheme() { return localStorage.getItem(LS_THEME) || 'light'; }
export function getFinanceProvider() { return localStorage.getItem(LS_FINANCE) || 'tradingview'; }
export function getFont() { return localStorage.getItem(LS_FONT) || 'mono'; }
export function getFontSize() { return localStorage.getItem(LS_FONT_SIZE) || 'medium'; }
export function getCase() { return localStorage.getItem(LS_CASE) || 'lower'; }

export function setTheme(t) { localStorage.setItem(LS_THEME, t); document.documentElement.setAttribute('data-theme', t); }
export function setFont(f) { localStorage.setItem(LS_FONT, f); document.documentElement.setAttribute('data-font', f); }
export function setFontSize(s) { localStorage.setItem(LS_FONT_SIZE, s); document.documentElement.setAttribute('data-font-size', s); }
export function setCase(c) { localStorage.setItem(LS_CASE, c); document.documentElement.setAttribute('data-case', c); }

export function bothKeys() {
  const tw = getTwKey();
  const an = getAnKey();
  return tw.length >= 20 && an.length >= 20;
}

// True if user can make API calls (either BYOK or has credits)
export function canMakeApiCalls() {
  return bothKeys() || (auth.isAuthenticated() && api.hasCredits());
}

// Whether to use managed (server) keys for this scan
export function shouldUseManaged() {
  return auth.isAuthenticated() && api.hasCredits() && !bothKeys();
}

// ============================================================================
// MODEL SELECTION
// ============================================================================

export function getModelPricing(modelId) {
  const id = modelId.toLowerCase();
  for (const [family, pricing] of Object.entries(MODEL_PRICING)) {
    if (id.includes(family)) return pricing;
  }
  return null;
}

export function formatModelCost(modelId) {
  const p = getModelPricing(modelId);
  if (!p) return '';
  return `$${p.input}/$${p.output} per MTok`;
}

export function modelCostLabel(modelId) {
  const p = getModelPricing(modelId);
  if (!p) return '';
  if (p.input <= 1) return '· $';
  if (p.input <= 5) return '· $$';
  return '· $$$';
}

let cachedModels = null;
export function getCachedModels() { return cachedModels; }

export async function fetchAvailableModels(apiKey) {
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
    const TIER_ORDER = { opus: 0, sonnet: 1, haiku: 2 };
    function extractModelVersion(id) {
      const parts = id.replace(/claude-/, '').split('-').filter(p => !/^\d{8,}$/.test(p));
      const nums = parts.filter(p => /^\d+$/.test(p));
      if (nums.length >= 2) return parseFloat(nums[0] + '.' + nums[1]);
      if (nums.length === 1) return parseFloat(nums[0]);
      return 0;
    }
    cachedModels = data.data
      .filter(m => m.id.startsWith('claude-') && !m.id.includes('embed'))
      .map(m => ({ id: m.id, name: m.display_name || m.id }))
      .sort((a, b) => {
        const verA = extractModelVersion(a.id), verB = extractModelVersion(b.id);
        if (verA !== verB) return verB - verA;
        const tierA = Object.keys(TIER_ORDER).find(t => a.id.includes(t));
        const tierB = Object.keys(TIER_ORDER).find(t => b.id.includes(t));
        return (TIER_ORDER[tierA] ?? 9) - (TIER_ORDER[tierB] ?? 9);
      });
    return cachedModels;
  } catch (e) {
    console.warn('Failed to fetch models:', e.message);
    return null;
  }
}

// ============================================================================
// PRESETS
// ============================================================================

export function getPresets() {
  const stored = localStorage.getItem(LS_PRESETS);
  if (!stored) {
    localStorage.setItem(LS_PRESETS, JSON.stringify(DEFAULT_PRESETS));
    return DEFAULT_PRESETS;
  }
  return JSON.parse(stored);
}

export function savePresetsData(p) { safeLsSet(LS_PRESETS, JSON.stringify(p)); }

// ============================================================================
// ACCOUNTS
// ============================================================================

export function loadStoredAccounts() {
  const saved = localStorage.getItem(LS_ACCOUNTS);
  return saved ? JSON.parse(saved) : [];
}

export function saveAccounts(accounts) { safeLsSet(LS_ACCOUNTS, JSON.stringify(accounts)); }

export function loadStoredLoadedPresets() {
  const saved = localStorage.getItem(LS_LOADED_PRESETS);
  return saved ? JSON.parse(saved) : [];
}

export function saveLoadedPresets(presets) { safeLsSet(LS_LOADED_PRESETS, JSON.stringify(presets)); }

// ============================================================================
// RECENTS
// ============================================================================

export function getRecents() {
  return JSON.parse(localStorage.getItem(LS_RECENTS) || '[]');
}

export function addToRecents(accounts) {
  let recents = getRecents();
  accounts.forEach(a => {
    recents = recents.filter(r => r !== a);
    recents.unshift(a);
  });
  recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem(LS_RECENTS, JSON.stringify(recents));
}

export function clearRecents() { localStorage.removeItem(LS_RECENTS); }

// ============================================================================
// ANALYSTS
// ============================================================================

export function generateAnalystId() { return 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function getAnalysts() {
  try {
    const raw = localStorage.getItem(LS_ANALYSTS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveAnalysts(analysts) { safeLsSet(LS_ANALYSTS, JSON.stringify(analysts)); }
export function getActiveAnalystId() { return localStorage.getItem(LS_ACTIVE_ANALYST) || DEFAULT_ANALYST_ID; }
export function setActiveAnalystId(id) { localStorage.setItem(LS_ACTIVE_ANALYST, id); }

export function initAnalysts() {
  let analysts = getAnalysts();
  const currentDefaultHash = hashString(DEFAULT_PROMPT);
  const storedDefaultHash = localStorage.getItem(LS_DEFAULT_PROMPT_HASH);

  if (!analysts) {
    const oldPrompt = localStorage.getItem('signal_custom_prompt');
    const userHadCustomPrompt = oldPrompt && oldPrompt !== DEFAULT_PROMPT;
    analysts = [{ id: DEFAULT_ANALYST_ID, name: 'Default', prompt: DEFAULT_PROMPT, isDefault: true }];
    if (userHadCustomPrompt) {
      const custom = { id: generateAnalystId(), name: 'My Analyst', prompt: oldPrompt, isDefault: false };
      analysts.push(custom);
      setActiveAnalystId(custom.id);
    }
    localStorage.removeItem('signal_custom_prompt');
    saveAnalysts(analysts);
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, currentDefaultHash);
    return;
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
}

export function getActiveAnalyst() {
  const analysts = getAnalysts() || [];
  const activeId = getActiveAnalystId();
  return analysts.find(a => a.id === activeId) || analysts.find(a => a.id === DEFAULT_ANALYST_ID) || { id: DEFAULT_ANALYST_ID, name: 'Default', prompt: DEFAULT_PROMPT, isDefault: true };
}

export function getPrompt() { return getActiveAnalyst().prompt; }

export function getPromptHash() { return hashString(`${getModel()}\n${getPrompt()}`); }

// ============================================================================
// LIVE FEED STATE
// ============================================================================

export function isLiveEnabled() { return localStorage.getItem(LS_LIVE_ENABLED) === 'true'; }
export function setLiveEnabled(v) {
  if (v) localStorage.setItem(LS_LIVE_ENABLED, 'true');
  else localStorage.removeItem(LS_LIVE_ENABLED);
}

// ============================================================================
// ANALYSIS CACHE
// ============================================================================

export function loadAnalysisCache() {
  try {
    const raw = localStorage.getItem(LS_ANALYSIS_CACHE);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.entries) return parsed;
  } catch {}
  return { v: 1, entries: {} };
}

export function saveAnalysisCache(cache) {
  try { localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(cache)); }
  catch (e) { console.warn('Failed to save analysis cache:', e.message); }
}

function cacheKey(promptHash, tweetUrl) { return `${promptHash}:${tweetUrl}`; }

export function getCachedSignals(cache, promptHash, tweetUrl) {
  if (!tweetUrl) return null;
  const entry = cache.entries[cacheKey(promptHash, tweetUrl)];
  if (!entry) return null;
  return (entry.signals || []).filter(isValidSignal);
}

export function setCachedSignals(cache, promptHash, tweetUrl, signals) {
  if (!tweetUrl) return;
  cache.entries[cacheKey(promptHash, tweetUrl)] = { signals: signals || [], ts: Date.now() };
}

export function pruneCache(cache) {
  const keys = Object.keys(cache.entries);
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  keys.sort((a, b) => (cache.entries[a]?.ts || 0) - (cache.entries[b]?.ts || 0));
  const removeCount = keys.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i++) delete cache.entries[keys[i]];
}

// In-memory tweet cache (per session)
export const tweetCache = new Map();

export function cleanupTweetCache() {
  const twoHoursAgo = Math.floor(Date.now() / 3600000) - 2;
  for (const [key] of tweetCache) {
    const keyHour = parseInt(key.split(':')[2]);
    if (keyHour < twoHoursAgo) tweetCache.delete(key);
  }
}

// ============================================================================
// TWEET FETCHING
// ============================================================================

function getCacheKeyForTweets(account, days) {
  return `${account}:${days}:${Math.floor(Date.now() / 3600000)}`;
}

function backoffDelay(attempt, baseDelay = 2000, maxDelay = 60000, jitter = 0.3) {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  return exponentialDelay + exponentialDelay * jitter * Math.random();
}

export async function fetchTweetsWithRetry(account, days, maxRetries = 3, signal = null) {
  // If using managed keys, delegate to API module
  if (shouldUseManaged()) {
    const tweets = await api.fetchTweets(account, days, signal);
    return tweets;
  }

  const ck = getCacheKeyForTweets(account, days);
  if (tweetCache.has(ck)) return tweetCache.get(ck);

  const key = getTwKey();
  if (!key) throw new Error('No Twitter API key configured. Add it in Settings.');

  const cutoff = new Date(Date.now() - days * 86400000);
  const allTweets = [];
  let cursor = null;
  let pages = 0;
  let consecutiveErrors = 0;

  while (pages < 5) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);

    const targetUrl = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;
    const fetchUrl = CORS_PROXY + encodeURIComponent(targetUrl);
    let res, data;
    let pageRetries = 0;

    while (pageRetries <= maxRetries) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      try {
        res = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'X-API-Key': key, 'Accept': 'application/json' },
          signal,
        });
        if (res.status === 401 || res.status === 403) {
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API auth error: ${body.slice(0, 100) || 'invalid key'}`);
        }
        if (res.status === 429) {
          const waitMs = backoffDelay(pageRetries, 5000, 30000);
          await new Promise(r => setTimeout(r, waitMs));
          pageRetries++;
          continue;
        }
        if (!res.ok) {
          if (pageRetries < maxRetries) {
            await new Promise(r => setTimeout(r, backoffDelay(pageRetries, 1000, 10000)));
            pageRetries++;
            continue;
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
      } catch (e) {
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
      if (new Date(tw.createdAt) < cutoff) { hitCutoff = true; break; }
      allTweets.push(tw);
    }
    if (hitCutoff) break;
    if (!apiData.has_next_page || !apiData.next_cursor) break;
    cursor = apiData.next_cursor;
    pages++;
    await new Promise(r => setTimeout(r, 100));
  }

  if (allTweets.length > 0) tweetCache.set(ck, allTweets);
  return allTweets;
}

export async function fetchAllTweets(accounts, days, onProgress, signal) {
  const BATCH_SIZE = 3;
  const accountTweets = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const batch = accounts.slice(i, i + BATCH_SIZE);
    onProgress?.(`Fetching ${i + 1}-${Math.min(i + batch.length, accounts.length)} of ${accounts.length}`);
    const results = await Promise.all(batch.map(async (account) => {
      if (signal?.aborted) return { account, tweets: [], error: 'Cancelled' };
      try {
        const tweets = await fetchTweetsWithRetry(account, days, 3, signal);
        return { account, tweets, error: null };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        return { account, tweets: [], error: e.message };
      }
    }));
    accountTweets.push(...results);
    if (i + BATCH_SIZE < accounts.length) await new Promise(r => setTimeout(r, 50));
  }
  return accountTweets;
}

// ============================================================================
// TWEET FORMATTING
// ============================================================================

export function getTweetUrl(tw) { return tw.url || `https://x.com/i/status/${tw.id}`; }

export function getTweetImageUrl(tw) {
  const media = tw.extendedEntities?.media || tw.entities?.media || tw.media || [];
  for (const m of media) {
    if (m.type === 'photo' || m.type === 'image') return m.media_url_https || m.url || null;
  }
  return null;
}

export function formatTweetForAnalysis(tw) {
  const date = new Date(tw.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  const engagement = `${tw.likeCount || 0}♥ ${tw.retweetCount || 0}↻ ${tw.viewCount || 0}👁`;
  const url = getTweetUrl(tw);
  let text = sanitizeText(tw.text || '');
  const externalLinks = [];
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
// SIGNAL PARSING
// ============================================================================

export function isValidSignal(s) {
  if (!s || typeof s !== 'object') return false;
  const hasTitle = typeof s.title === 'string' && s.title.trim().length > 0;
  const hasSummary = typeof s.summary === 'string' && s.summary.trim().length > 0;
  return hasTitle || hasSummary;
}

export function safeParseSignals(text) {
  if (!text) return [];
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];
  let jsonStr = arrayMatch[0];
  let parsed = null;
  try {
    const result = JSON.parse(jsonStr);
    if (Array.isArray(result)) parsed = result;
  } catch {}
  if (!parsed) {
    try {
      jsonStr = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
      jsonStr = jsonStr.replace(/([^\\])\\n(?=")/g, '$1\\\\n');
      const result = JSON.parse(jsonStr);
      if (Array.isArray(result)) parsed = result;
    } catch {}
  }
  if (!parsed) {
    try {
      jsonStr = sanitizeText(jsonStr);
      const result = JSON.parse(jsonStr);
      if (Array.isArray(result)) parsed = result;
    } catch {}
  }
  if (!parsed) return [];
  return parsed.filter(isValidSignal);
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
}

export function groupSignalsByTweet(signals) {
  const map = new Map();
  signals.forEach(s => {
    const url = s.tweet_url;
    if (!url) return;
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(s);
  });
  return map;
}

export function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter(s => {
    const key = s.tweet_url || `${s.title || ''}|${s.summary || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// ANTHROPIC CALLS (BYOK MODE)
// ============================================================================

const API_CONFIG = {
  anthropic: { baseUrl: 'https://api.anthropic.com/v1/messages', maxRetries: 5, baseDelay: 2000, maxDelay: 120000 }
};

function categorizeError(error, status) {
  if (status === 429 || status === 529) return 'rate_limit';
  if (error?.type === 'overloaded_error') return 'overloaded';
  if (error?.type === 'rate_limit_error') return 'rate_limit';
  if (error?.message?.includes('credit balance')) return 'billing';
  if (error?.message?.includes('billing')) return 'billing';
  if (error?.message?.includes('prompt is too long')) return 'input_too_large';
  if (error?.type === 'not_found_error') return 'model_not_found';
  if (error?.type === 'authentication_error') return 'auth_error';
  if (error?.type === 'invalid_request_error') return 'invalid_request';
  if (error?.message?.includes('rate') || error?.message?.includes('limit')) return 'rate_limit';
  return 'unknown';
}

export async function anthropicCall(body, maxRetries = 5, signal = null, onStreamProgress = null, onStatus = null) {
  // If using managed keys, delegate to API module
  if (shouldUseManaged()) {
    const data = await api.analyze(body, signal);
    return data;
  }

  const key = getAnKey();
  if (!key) throw new Error('No Anthropic API key configured. Add it in Settings.');

  const isSlowModel = (body.model || '').toLowerCase().includes('opus');
  const requestTimeout = isSlowModel ? 300000 : 180000;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), requestTimeout);
      let combinedSignal;
      if (!signal) {
        combinedSignal = timeoutController.signal;
      } else if (typeof AbortSignal.any === 'function') {
        combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
      } else {
        combinedSignal = timeoutController.signal;
        signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }

      const streamBody = { ...body, stream: true };
      const res = await fetch(API_CONFIG.anthropic.baseUrl, {
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
        let errorData;
        try { errorData = await res.json(); } catch { errorData = { error: { message: `HTTP ${res.status}` } }; }
        if (errorData.error) {
          const errorType = categorizeError(errorData.error, res.status);
          if (['input_too_large', 'model_not_found', 'auth_error', 'invalid_request', 'billing'].includes(errorType)) {
            const messages = {
              input_too_large: 'Input too large. Try fewer accounts or a shorter time range.',
              model_not_found: 'Model not available. Your API key may not have access to this model.',
              auth_error: 'Invalid API key. Please check your Anthropic API key in Settings.',
              invalid_request: errorData.error?.message || 'Invalid request to Anthropic API.',
              billing: 'Credit balance too low. Add credits at platform.claude.com',
            };
            throw new Error(messages[errorType] || errorData.error?.message);
          }
          if (['rate_limit', 'overloaded', 'quota'].includes(errorType)) {
            if (attempt >= maxRetries) throw new Error(`API rate limited after ${maxRetries + 1} attempts.`);
            const baseWait = errorType === 'quota' ? 45000 : 15000;
            const waitMs = backoffDelay(attempt, baseWait, API_CONFIG.anthropic.maxDelay);
            onStatus?.(`Rate limited · Retry ${attempt + 2}/${maxRetries + 1} in ${Math.ceil(waitMs / 1000)}s`, true);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          lastError = errorData.error;
          if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 2000, 30000)));
          continue;
        }
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let buffer = '';
      let streamError = null;

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
              } else if (event.type === 'error') {
                streamError = event.error;
              }
            } catch {}
          }
        }
      }

      clearTimeout(timeoutId);

      if (streamError) {
        const errorType = categorizeError(streamError);
        if (['rate_limit', 'overloaded', 'quota'].includes(errorType)) {
          if (attempt >= maxRetries) throw new Error(`API rate limited after ${maxRetries + 1} attempts.`);
          const waitMs = backoffDelay(attempt, 15000, API_CONFIG.anthropic.maxDelay);
          onStatus?.(`Rate limited · Retry ${attempt + 2}/${maxRetries + 1} in ${Math.ceil(waitMs / 1000)}s`, true);
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
    } catch (e) {
      if (e.name === 'AbortError' && signal?.aborted) throw e;
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        lastError = new Error(`Request timed out. The model may be overloaded.`);
        if (attempt < maxRetries) {
          onStatus?.(`Request timed out · Retrying (${attempt + 2}/${maxRetries + 1})`, true);
          await new Promise(r => setTimeout(r, backoffDelay(attempt, 5000, 30000)));
        }
        continue;
      }
      if (e.message.includes('No Anthropic') || e.message.includes('Invalid API') ||
          e.message.includes('Input too large') || e.message.includes('Model not available') ||
          e.message.includes('Credit balance')) throw e;
      lastError = e;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, backoffDelay(attempt, 3000, 30000)));
    }
  }
  throw new Error(lastError?.message || 'Failed to connect to Anthropic API after multiple attempts.');
}

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

export function buildBatches(accountData, promptChars) {
  const items = accountData.map(a => {
    const header = `=== @${a.account} (${a.tweets.length} tweets) ===`;
    const body = a.tweets.map(formatTweetForAnalysis).join('\n---\n');
    const accountText = `${header}\n${body}`;
    const tweetUrls = a.tweets.map(getTweetUrl).filter(Boolean);
    const imageUrls = a.tweets.map(getTweetImageUrl).filter(Boolean);
    return { account: a.account, text: accountText, size: accountText.length, tweetUrls, imageUrls };
  });
  const hasAnyImages = items.some(i => i.imageUrls.length > 0);
  const maxChars = hasAnyImages ? MAX_BATCH_CHARS_WITH_IMAGES : MAX_BATCH_CHARS;
  items.sort((a, b) => b.size - a.size);
  const batches = [];
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

export async function analyzeWithBatching(accountData, totalTweets, onProgress, promptHash, cache, signal = null) {
  const prompt = getPrompt();
  const batches = buildBatches(accountData, prompt.length);
  if (!batches.length) return [];

  const allSignals = [];
  const results = [];
  let nextIndex = 0;
  const isSlowModel = getModel().toLowerCase().includes('opus');
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
      onProgress?.(batchLabel);

      const batchStart = Date.now();
      let streamState = { receivingData: false, outputTokens: 0 };
      const elapsedTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - batchStart) / 1000);
        if (streamState.receivingData && streamState.outputTokens > 0) {
          const tokK = (streamState.outputTokens / 1000).toFixed(1);
          onProgress?.(`${batchLabel} · ${elapsed}s · ${tokK}k tokens`);
        } else {
          onProgress?.(`${batchLabel} · ${elapsed}s`);
        }
      }, 1000);

      const textContent = sanitizeText(`${prompt}\n\n${batch.text}`);
      let messageContent;
      if (batch.imageUrls && batch.imageUrls.length > 0) {
        messageContent = [
          { type: 'text', text: textContent },
          ...batch.imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } }))
        ];
      } else {
        messageContent = textContent;
      }

      try {
        const data = await anthropicCall(
          { model: getModel(), max_tokens: 16384, messages: [{ role: 'user', content: messageContent }] },
          5, signal,
          (progress) => { Object.assign(streamState, progress); },
          (msg, animate) => onProgress?.(msg)
        );

        const txt = extractText(data.content);
        const batchSignals = safeParseSignals(txt);
        results.push({ i, signals: batchSignals, tweetUrls: batch.tweetUrls });

        const grouped = groupSignalsByTweet(batchSignals);
        batch.tweetUrls.forEach(url => {
          setCachedSignals(cache, promptHash, url, grouped.get(url) || []);
        });
        saveAnalysisCache(cache);
      } finally {
        clearInterval(elapsedTimer);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runBatchWorker()));
  results.sort((a, b) => a.i - b.i);
  results.forEach(res => {
    allSignals.push(...res.signals);
    const grouped = groupSignalsByTweet(res.signals);
    res.tweetUrls.forEach(url => {
      setCachedSignals(cache, promptHash, url, grouped.get(url) || []);
    });
  });
  saveAnalysisCache(cache);
  return allSignals;
}

// ============================================================================
// SCAN STORAGE
// ============================================================================

export function createStorableScan(scan) {
  // Start with any existing tweetMeta (e.g. from server cache)
  const tweetMeta = scan.tweetMeta ? { ...scan.tweetMeta } : {};
  // Overlay with rawTweets data (more detailed, has full text)
  if (scan.rawTweets) {
    scan.rawTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        tweetMeta[url] = { text: (tw.text || '').slice(0, 500), author: a.account, time: tw.createdAt };
      });
    });
  }
  return {
    id: scan.id || null,
    date: scan.date,
    range: scan.range,
    days: scan.days,
    accounts: scan.accounts,
    totalTweets: scan.totalTweets,
    signals: scan.signals,
    tweetMeta,
    scheduled: scan.scheduled === true,
  };
}

export function saveScanToStorage(scan, skipHistory = false) {
  try {
    const storable = createStorableScan(scan);
    localStorage.setItem(LS_CURRENT, JSON.stringify(storable));
    if (skipHistory) return;
    const history = JSON.parse(localStorage.getItem(LS_SCANS) || '[]');
    const tweetTimes = {};
    if (scan.rawTweets) {
      scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        if (tw.createdAt) tweetTimes[url] = tw.createdAt;
      }));
    }
    const historyEntry = {
      date: scan.date, range: scan.range,
      accounts: scan.accounts.length, totalTweets: scan.totalTweets,
      signalCount: scan.signals.length,
      signals: scan.signals.map(s => ({ ...s, tweet_time: tweetTimes[s.tweet_url] || null }))
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
  } catch (e) {
    console.warn('Failed to save scan:', e.message);
    try {
      localStorage.removeItem(LS_SCANS);
      localStorage.setItem(LS_CURRENT, JSON.stringify(createStorableScan(scan)));
    } catch { localStorage.removeItem(LS_CURRENT); localStorage.removeItem(LS_SCANS); }
  }
}

export function loadCurrentScan() {
  const saved = localStorage.getItem(LS_CURRENT);
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
}

export function getScanHistory() { return JSON.parse(localStorage.getItem(LS_SCANS) || '[]'); }

export function deleteHistoryScan(index) {
  const history = getScanHistory();
  if (index < 0 || index >= history.length) return;
  history.splice(index, 1);
  localStorage.setItem(LS_SCANS, JSON.stringify(history));
}

// ============================================================================
// PENDING SCAN (resume)
// ============================================================================

export function savePendingScan(accounts, days, accountTweets, rangeLabel) {
  try {
    localStorage.setItem(LS_PENDING_SCAN, JSON.stringify({
      date: new Date().toISOString(), accounts: [...accounts], days, rangeLabel,
      accountTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets, error: a.error || null })),
    }));
  } catch (e) { console.warn('Failed to save pending scan:', e.message); }
}

export function clearPendingScan() { localStorage.removeItem(LS_PENDING_SCAN); }

export function loadPendingScan() {
  const raw = localStorage.getItem(LS_PENDING_SCAN);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    if (Date.now() - new Date(pending.date).getTime() > 3600000) { clearPendingScan(); return null; }
    return pending;
  } catch { clearPendingScan(); return null; }
}

// ============================================================================
// PRICE FETCHING
// ============================================================================

export const priceCache = {};
const PRICE_CACHE_TTL = 60000;
const STOCK_QUOTE_BATCH_SIZE = 50;
const pendingPriceFetches = new Map();
const STOCK_RETRY_BASE_MS = 15000;
const STOCK_RETRY_MAX_MS = 10 * 60 * 1000;
const STOCK_RATE_LIMIT_FALLBACK_MS = 60000;
const stockFailureState = new Map();
let stockRateLimitedUntil = 0;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasFreshPriceChange(symbol, now = Date.now()) {
  const cached = priceCache[symbol];
  return !!cached && Number.isFinite(cached.change) && (now - cached.ts < PRICE_CACHE_TTL);
}

function parseRetryAfterMs(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return STOCK_RATE_LIMIT_FALLBACK_MS;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(STOCK_RATE_LIMIT_FALLBACK_MS, Math.floor(seconds * 1000));
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const ms = dateMs - Date.now();
    if (ms > 0) return Math.max(STOCK_RATE_LIMIT_FALLBACK_MS, ms);
  }

  return STOCK_RATE_LIMIT_FALLBACK_MS;
}

function markStockFailure(symbol, delayMs = null) {
  const clean = (symbol || '').replace(/^\$/, '').toUpperCase();
  if (!clean) return;
  const current = stockFailureState.get(clean) || { failures: 0, retryAt: 0 };
  const failures = current.failures + 1;
  const expDelay = Math.min(STOCK_RETRY_BASE_MS * (2 ** Math.max(0, failures - 1)), STOCK_RETRY_MAX_MS);
  const retryDelay = delayMs == null ? expDelay : Math.min(Math.max(delayMs, STOCK_RETRY_BASE_MS), STOCK_RETRY_MAX_MS);
  stockFailureState.set(clean, { failures, retryAt: Date.now() + retryDelay });
}

function clearStockFailure(symbol) {
  const clean = (symbol || '').replace(/^\$/, '').toUpperCase();
  if (!clean) return;
  stockFailureState.delete(clean);
}

function shouldSkipStockRequest(symbol, now = Date.now()) {
  if (now < stockRateLimitedUntil) return true;
  const clean = (symbol || '').replace(/^\$/, '').toUpperCase();
  if (!clean) return true;
  const state = stockFailureState.get(clean);
  return !!state && state.retryAt > now;
}

function markStockRateLimited(symbols, headers) {
  const delayMs = parseRetryAfterMs(headers);
  const retryAt = Date.now() + delayMs;
  if (retryAt > stockRateLimitedUntil) stockRateLimitedUntil = retryAt;
  symbols.forEach(sym => markStockFailure(sym, delayMs));
}

export function normalizeSymbol(sym) {
  const clean = sym.replace(/^\$/, '').toUpperCase();
  return INDEX_MAP[clean] || clean;
}

export function isCrypto(sym) { return !!CRYPTO_SLUGS[sym.replace(/^\$/, '').toUpperCase()]; }

export function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(3);
}

export function formatChange(change) {
  return (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
}

export function priceHtml(data, { showPrice = false } = {}) {
  if (!data || data.price == null) return '';
  const cls = data.change > 0.01 ? 'pos' : data.change < -0.01 ? 'neg' : 'neutral';
  const priceStr = showPrice ? `<span class="ticker-price">${formatPrice(data.price)}</span>` : '';
  return `<span class="ticker-change ${cls}">${priceStr}${formatChange(data.change)}</span>`;
}

async function fetchCryptoPrices(symbols) {
  const now = Date.now();
  const needed = symbols.filter(s => {
    return !hasFreshPriceChange(s, now);
  });
  if (!needed.length) return;
  const ids = needed.map(s => CRYPTO_SLUGS[s]).filter(Boolean);
  if (!ids.length) return;
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    if (!resp.ok) return;
    const data = await resp.json();
    needed.forEach(sym => {
      const slug = CRYPTO_SLUGS[sym];
      const row = data?.[slug];
      if (!row) return;
      const price = finiteNumber(row.usd);
      const change = finiteNumber(row.usd_24h_change);
      if (price == null) return;
      priceCache[sym] = { price, change: change ?? 0, ts: now };
    });
  } catch {}
}

async function fetchStockPrice(sym, originalSym = null) {
  const cacheKey = originalSym || sym;
  const now = Date.now();
  if (hasFreshPriceChange(cacheKey, now)) return true;
  if (shouldSkipStockRequest(cacheKey, now)) return false;
  try {
    const yahooSym = normalizeSymbol(sym);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2d`;
    const url = CORS_PROXY + encodeURIComponent(yahooUrl);
    const resp = await fetch(url);
    if (resp.status === 429) {
      markStockRateLimited([cacheKey], resp.headers);
      return false;
    }
    if (!resp.ok) {
      markStockFailure(cacheKey);
      return false;
    }
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      markStockFailure(cacheKey);
      return false;
    }
    const price = finiteNumber(result.meta?.regularMarketPrice);
    const prevClose = finiteNumber(result.meta?.chartPreviousClose) ?? finiteNumber(result.meta?.previousClose);
    if (price == null || prevClose == null || prevClose === 0) {
      markStockFailure(cacheKey);
      return false;
    }
    const change = ((price - prevClose) / prevClose) * 100;
    if (!Number.isFinite(change)) {
      markStockFailure(cacheKey);
      return false;
    }
    priceCache[cacheKey] = { price, change, ts: now };
    clearStockFailure(cacheKey);
    return true;
  } catch {
    markStockFailure(cacheKey);
    return false;
  }
}

async function fetchStockQuoteBatch(stockSyms) {
  if (!stockSyms.length) return;
  const now = Date.now();
  if (now < stockRateLimitedUntil) return;
  const queryToCacheKeys = new Map();
  stockSyms.forEach((sym) => {
    const clean = sym.replace(/^\$/, '').toUpperCase();
    if (!clean) return;
    if (shouldSkipStockRequest(clean, now)) return;
    const query = normalizeSymbol(clean).toUpperCase();
    if (!queryToCacheKeys.has(query)) queryToCacheKeys.set(query, []);
    queryToCacheKeys.get(query).push(clean);
  });

  const querySymbols = [...queryToCacheKeys.keys()];
  if (!querySymbols.length) return;
  const unresolved = new Set(querySymbols);
  let rateLimited = false;

  for (let i = 0; i < querySymbols.length; i += STOCK_QUOTE_BATCH_SIZE) {
    if (Date.now() < stockRateLimitedUntil) { rateLimited = true; break; }
    const batch = querySymbols.slice(i, i + STOCK_QUOTE_BATCH_SIZE);
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(batch.join(','))}`;
    const url = CORS_PROXY + encodeURIComponent(yahooUrl);
    try {
      const resp = await fetch(url);
      if (resp.status === 429) {
        const batchKeys = batch.flatMap(sym => queryToCacheKeys.get(sym) || []);
        markStockRateLimited(batchKeys, resp.headers);
        rateLimited = true;
        break;
      }
      if (!resp.ok) {
        batch.forEach((querySym) => {
          const keys = queryToCacheKeys.get(querySym) || [];
          keys.forEach(k => markStockFailure(k));
          unresolved.delete(querySym);
        });
        continue;
      }
      const data = await resp.json();
      const results = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
      results.forEach((row) => {
        const quoteSym = String(row?.symbol || '').toUpperCase();
        const cacheKeys = queryToCacheKeys.get(quoteSym);
        if (!cacheKeys?.length) return;

        const price = finiteNumber(row.regularMarketPrice);
        let change = finiteNumber(row.regularMarketChangePercent);
        if (change == null) {
          const prevClose = finiteNumber(row.regularMarketPreviousClose) ?? finiteNumber(row.previousClose);
          if (price != null && prevClose != null && prevClose !== 0) {
            change = ((price - prevClose) / prevClose) * 100;
          }
        }
        if (price == null || change == null) return;

        cacheKeys.forEach((cacheKey) => {
          priceCache[cacheKey] = { price, change, ts: now };
          clearStockFailure(cacheKey);
        });
        unresolved.delete(quoteSym);
      });
    } catch {
      batch.forEach((querySym) => {
        const keys = queryToCacheKeys.get(querySym) || [];
        keys.forEach(k => markStockFailure(k));
        unresolved.delete(querySym);
      });
    }
  }

  if (rateLimited) return;

  if (!unresolved.size) return;
  const fallbackPromises = [];
  unresolved.forEach((querySym) => {
    const cacheKeys = queryToCacheKeys.get(querySym) || [];
    cacheKeys.forEach((cacheKey) => {
      fallbackPromises.push(fetchStockPrice(querySym, cacheKey));
    });
  });
  await Promise.all(fallbackPromises);
}

export async function fetchAllPrices(symbols) {
  const now = Date.now();
  const waiting = [];
  const cryptoSyms = [];
  const stockSyms = [];
  const seen = new Set();

  symbols.forEach(s => {
    const clean = s.replace(/^\$/, '').toUpperCase();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    if (hasFreshPriceChange(clean, now)) return;

    const pending = pendingPriceFetches.get(clean);
    if (pending) {
      waiting.push(pending);
      return;
    }
    if (CRYPTO_SLUGS[clean]) cryptoSyms.push(clean);
    else if (!shouldSkipStockRequest(clean, now)) stockSyms.push(clean);
  });

  const launched = [];
  if (cryptoSyms.length) {
    const task = fetchCryptoPrices(cryptoSyms);
    cryptoSyms.forEach((sym) => pendingPriceFetches.set(sym, task));
    launched.push(task.finally(() => {
      cryptoSyms.forEach((sym) => {
        if (pendingPriceFetches.get(sym) === task) pendingPriceFetches.delete(sym);
      });
    }));
  }
  if (stockSyms.length) {
    const task = fetchStockQuoteBatch(stockSyms);
    stockSyms.forEach((sym) => pendingPriceFetches.set(sym, task));
    launched.push(task.finally(() => {
      stockSyms.forEach((sym) => {
        if (pendingPriceFetches.get(sym) === task) pendingPriceFetches.delete(sym);
      });
    }));
  }

  await Promise.all([...waiting, ...launched]);
}

// ============================================================================
// TICKER URLS
// ============================================================================

export function tickerUrl(sym) {
  const s = sym.replace(/^\$/, '').toUpperCase();
  const provider = getFinanceProvider();
  if (provider === 'tradingview') {
    if (CRYPTO_SLUGS[s]) return `https://www.tradingview.com/chart/?symbol=${s}USDT`;
    if (s.endsWith('.TW')) return `https://www.tradingview.com/chart/?symbol=TWSE:${s.replace('.TW', '')}`;
    if (s.endsWith('.HK')) return `https://www.tradingview.com/chart/?symbol=HKEX:${s.replace('.HK', '')}`;
    if (s.endsWith('.T')) return `https://www.tradingview.com/chart/?symbol=TSE:${s.replace('.T', '')}`;
    if (s.endsWith('.KS')) return `https://www.tradingview.com/chart/?symbol=KRX:${s.replace('.KS', '')}`;
    return `https://www.tradingview.com/chart/?symbol=${s}`;
  }
  if (CRYPTO_SLUGS[s]) return `https://www.coingecko.com/en/coins/${CRYPTO_SLUGS[s]}`;
  if (provider === 'google') {
    if (s.endsWith('.TW')) return `https://www.google.com/finance/quote/${s.replace('.TW', '')}:TPE?window=6M`;
    if (s.endsWith('.HK')) return `https://www.google.com/finance/quote/${s.replace('.HK', '')}:HKG?window=6M`;
    if (s.endsWith('.T')) return `https://www.google.com/finance/quote/${s.replace('.T', '')}:TYO?window=6M`;
    if (s.endsWith('.KS')) return `https://www.google.com/finance/quote/${s.replace('.KS', '')}:KRX?window=6M`;
    return `https://www.google.com/finance/quote/${s}?window=6M`;
  }
  return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`;
}

// ============================================================================
// SHARING
// ============================================================================

export function encodeSignal(signal) {
  const compact = {
    t: signal.title || '', s: signal.summary || '', c: signal.category || '',
    src: (signal.source || '').replace(/^@/, ''),
    tk: (signal.tickers || []).map(t => ({ s: t.symbol, a: t.action })),
    u: signal.tweet_url || '',
  };
  if (signal.links?.length) compact.ln = signal.links;
  const json = JSON.stringify(compact);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSignal(encoded) {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const c = JSON.parse(json);
    return {
      title: c.t || '', summary: c.s || '', category: c.c || '', source: c.src || '',
      tickers: (c.tk || []).map(t => ({ symbol: t.s, action: t.a })),
      tweet_url: c.u || '', links: c.ln || [],
    };
  } catch (e) { console.warn('Failed to decode shared signal:', e); return null; }
}

// ============================================================================
// EXPORT / IMPORT
// ============================================================================

export function encodeBackup(str) { return btoa(unescape(encodeURIComponent(str))); }
export function decodeBackup(str) { return decodeURIComponent(escape(atob(str))); }

export function exportDataToString(customAccounts, loadedPresets) {
  const data = {
    v: 1,
    settings: {
      theme: getTheme(), font: getFont(), fontSize: getFontSize(), textCase: getCase(),
      financeProvider: getFinanceProvider(), model: getModel(), prompt: getPrompt(),
    },
    keys: { twitter: getTwKey(), anthropic: getAnKey() },
    presets: getPresets(),
    analysts: getAnalysts(),
    activeAnalyst: getActiveAnalystId(),
    accounts: customAccounts,
    loadedPresets: loadedPresets,
    recents: getRecents(),
  };
  return encodeBackup(JSON.stringify(data));
}

// ============================================================================
// ONBOARDING
// ============================================================================

export function isOnboardingDone() {
  // Auto-skip for existing users who have keys or scan data
  if (localStorage.getItem(LS_ONBOARDING_DONE) === 'true') return true;
  if (getTwKey() || getAnKey()) return true;
  if (localStorage.getItem(LS_CURRENT)) return true;
  return false;
}

export function setOnboardingDone(v = true) {
  if (v) localStorage.setItem(LS_ONBOARDING_DONE, 'true');
  else localStorage.removeItem(LS_ONBOARDING_DONE);
}

// ============================================================================
// SHOW TICKER PRICE SETTING
// ============================================================================

export function getShowTickerPrice() {
  if (typeof showTickerPriceRuntime === 'boolean') return showTickerPriceRuntime;
  try {
    const v = localStorage.getItem(LS_SHOW_TICKER_PRICE);
    return v === null ? SHOW_TICKER_PRICE_DEFAULT : v === 'true';
  } catch (e) {
    if (!showTickerPriceReadWarned) {
      showTickerPriceReadWarned = true;
      console.warn('localStorage read failed:', LS_SHOW_TICKER_PRICE, e.message);
    }
    return SHOW_TICKER_PRICE_DEFAULT;
  }
}

export function setShowTickerPrice(v) {
  showTickerPriceRuntime = Boolean(v);
  safeLsSet(LS_SHOW_TICKER_PRICE, String(showTickerPriceRuntime));
}

// ============================================================================
// ICON SET
// ============================================================================

export function getIconSet() { return localStorage.getItem(LS_ICON_SET) || 'sf'; }
export function setIconSet(s) { localStorage.setItem(LS_ICON_SET, s); }

// ============================================================================
// TRADINGVIEW SYMBOL MAPPING
// ============================================================================

export function getTvSymbol(sym) {
  const clean = sym.replace(/^\$/, '').toUpperCase();
  // Check override map first
  if (TV_SYMBOL_OVERRIDES[clean]) return TV_SYMBOL_OVERRIDES[clean];
  // Crypto → BINANCE:XUSDT
  if (CRYPTO_SLUGS[clean]) return `BINANCE:${clean}USDT`;
  // Regional exchanges
  if (clean.endsWith('.TW')) return `TWSE:${clean.replace('.TW', '')}`;
  if (clean.endsWith('.HK')) return `HKEX:${clean.replace('.HK', '')}`;
  if (clean.endsWith('.T')) return `TSE:${clean.replace('.T', '')}`;
  if (clean.endsWith('.KS')) return `KRX:${clean.replace('.KS', '')}`;
  return clean;
}

// ============================================================================
// SIGNAL NORMALIZATION
// ============================================================================

function stripDollar(sym) {
  if (!sym || typeof sym !== 'string') return '';
  return sym.replace(/^\$/, '').toUpperCase().trim();
}

function normalizeTickerAction(action) {
  if (!action || typeof action !== 'string') return 'watch';
  const a = action.toLowerCase().trim();
  if (['buy', 'sell', 'hold', 'watch', 'mixed'].includes(a)) return a;
  return 'watch';
}

function canonicalTickerSymbol(sym) {
  const clean = stripDollar(sym);
  return TICKER_SYMBOL_ALIASES[clean] || clean;
}

export function normalizeSignals(signals) {
  if (!signals || !Array.isArray(signals)) return [];
  return signals.filter(isValidSignal).map(s => {
    const tickers = (s.tickers || []).filter(t => t && t.symbol).map(t => ({
      symbol: '$' + canonicalTickerSymbol(t.symbol),
      action: normalizeTickerAction(t.action),
    }));
    // Deduplicate tickers by symbol, merge conflicting actions to 'mixed'
    const tickerMap = new Map();
    for (const t of tickers) {
      const key = t.symbol.toUpperCase();
      if (tickerMap.has(key)) {
        const existing = tickerMap.get(key);
        if (existing.action !== t.action) existing.action = 'mixed';
      } else {
        tickerMap.set(key, { ...t });
      }
    }
    return {
      ...s,
      category: normCat(s.category || 'Insight'),
      tickers: [...tickerMap.values()],
    };
  });
}

// ============================================================================
// SERVER-BATCHED TWEET FETCHING (managed keys)
// ============================================================================

export async function fetchAllTweetsServerBatch(accounts, days, onProgress, signal) {
  const BATCH_SIZE = 25;
  const accountTweets = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const batch = accounts.slice(i, i + BATCH_SIZE);
    onProgress?.(`Fetching ${i + 1}-${Math.min(i + batch.length, accounts.length)} of ${accounts.length}`);
    try {
      const data = await api.fetchTweetsBatch(batch, days, signal);
      if (data.results) {
        accountTweets.push(...data.results.map(r => ({
          account: r.account,
          tweets: r.tweets || [],
          error: r.error || null,
        })));
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // Fallback: fetch individually
      for (const account of batch) {
        if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
        try {
          const tweets = await api.fetchTweets(account, days, signal);
          accountTweets.push({ account, tweets, error: null });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          accountTweets.push({ account, tweets: [], error: err.message });
        }
      }
    }
  }
  return accountTweets;
}

// ============================================================================
// FULL SCAN ORCHESTRATOR (matches v3 engine.runScan)
// ============================================================================

export async function runScan(accounts, days, signal, onStatus, onNotice, prefetchedTweets) {
  onStatus('', true);

  const analysts = getAnalysts() || [];
  const promptHash = getPromptHash();

  // ── Layer 0: Cross-user whole-scan cache ──
  // Check if any user already scanned the same accounts+range+prompt
  if (!prefetchedTweets && auth.isAuthenticated()) {
    try {
      const cached = await api.checkScanCache(accounts, days, promptHash);
      if (cached.cached && cached.signals?.length) {
        onStatus(`${cached.signals.length} signals (from cache)`, false);
        return {
          date: new Date().toISOString(),
          range: '',
          days,
          accounts: [...accounts],
          totalTweets: cached.total_tweets || 0,
          signals: normalizeSignals(cached.signals),
        };
      }
    } catch {
      // Cache miss or error — continue with full scan
    }
  }

  // ── Fetch tweets ──
  let accountTweets;
  if (prefetchedTweets) {
    accountTweets = prefetchedTweets;
  } else if (shouldUseManaged()) {
    accountTweets = await fetchAllTweetsServerBatch(accounts, days, (msg) => onStatus(msg, true), signal);
  } else {
    accountTweets = await fetchAllTweets(accounts, days, (msg) => onStatus(msg, true), signal);
  }

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
  savePendingScan(accounts, days, accountTweets, '');

  const accountData = accountTweets.filter(a => a.tweets.length);
  const analysisCache = loadAnalysisCache();
  let cachedSignals = [];

  // ── Layer 1: Local (localStorage) analysis cache ──
  let uncachedAccountData = accountData.map(a => {
    const uncachedTweets = [];
    (a.tweets || []).forEach(tw => {
      const url = getTweetUrl(tw);
      const cached = getCachedSignals(analysisCache, promptHash, url);
      if (cached) cachedSignals.push(...cached);
      else uncachedTweets.push(tw);
    });
    return { account: a.account, tweets: uncachedTweets };
  }).filter(a => a.tweets.length);

  // ── Layer 2: Server-side cross-user analysis cache ──
  if (uncachedAccountData.length && auth.isAuthenticated()) {
    try {
      const allUncachedUrls = uncachedAccountData.flatMap(a => a.tweets.map(tw => getTweetUrl(tw)));
      if (allUncachedUrls.length > 0) {
        onStatus(`Checking analysis cache (${allUncachedUrls.length} tweets)…`, true);
        const serverCache = await api.checkAnalysisCache(promptHash, allUncachedUrls);
        if (serverCache.cached && Object.keys(serverCache.cached).length > 0) {
          const serverCachedUrls = new Set(Object.keys(serverCache.cached));
          for (const [url, sigs] of Object.entries(serverCache.cached)) {
            const validSigs = (sigs || []).filter(isValidSignal);
            cachedSignals.push(...validSigs);
            setCachedSignals(analysisCache, promptHash, url, validSigs);
          }
          uncachedAccountData = uncachedAccountData.map(a => ({
            account: a.account,
            tweets: a.tweets.filter(tw => !serverCachedUrls.has(getTweetUrl(tw))),
          })).filter(a => a.tweets.length);
        }
      }
    } catch {
      // Server cache unavailable — continue without it
    }
  }

  // ── Layer 3: Analyze remaining uncached tweets ──
  let signals;
  if (uncachedAccountData.length) {
    const cached = cachedSignals.length;
    const remaining = uncachedAccountData.reduce((s, a) => s + a.tweets.length, 0);
    if (cached > 0) onStatus(`${cached} signals cached · Analyzing ${remaining} remaining tweets`, true);

    const newSignals = await analyzeWithBatching(
      uncachedAccountData, totalTweets,
      (msg) => onStatus(msg, true),
      promptHash, analysisCache, signal
    );
    signals = normalizeSignals(dedupeSignals([...cachedSignals, ...newSignals]));
  } else {
    onStatus(`${totalTweets} tweets fetched · Using cache`, false);
    signals = normalizeSignals(dedupeSignals(cachedSignals));
  }

  pruneCache(analysisCache);
  saveAnalysisCache(analysisCache);

  return {
    date: new Date().toISOString(),
    range: '',
    days,
    accounts: [...accounts],
    totalTweets,
    signals,
    rawTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets })),
  };
}

// ============================================================================
// SCHEDULE HELPERS
// ============================================================================

export function getBrowserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}

export function formatScheduleTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function getNextScheduleTime(schedules) {
  if (!schedules?.length) return null;
  const enabled = schedules.filter(s => s.enabled);
  if (!enabled.length) return null;

  const now = new Date();
  let nearest = null;
  let nearestDate = null;

  for (const schedule of enabled) {
    const [h, m] = (schedule.time || '00:00').split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    // Check next 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(h, m, 0, 0);

      // Skip if in the past
      if (candidate <= now) continue;

      // Check day-of-week filter
      if (schedule.days && schedule.days.length > 0) {
        if (!schedule.days.includes(candidate.getDay())) continue;
      }

      if (!nearestDate || candidate < nearestDate) {
        nearestDate = candidate;
        nearest = { schedule, date: candidate };
      }
      break; // Only need the first valid day for this schedule
    }
  }

  return nearest;
}

export function getNextScheduleLabel(schedules) {
  const next = getNextScheduleTime(schedules);
  if (!next) return '';
  const now = new Date();
  const diffMs = next.date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return formatScheduleTime(next.schedule.time);
}

// ============================================================================
// FETCH FOLLOWING (for onboarding import)
// ============================================================================

export async function fetchFollowing(username, onProgress, signal) {
  if (shouldUseManaged()) {
    // Use backend to fetch following
    try {
      const data = await api.fetchTweets(username, 0, signal); // special case: days=0 means fetch following
      return data;
    } catch { return []; }
  }
  // BYOK: direct fetch
  const key = getTwKey();
  if (!key) return [];
  try {
    const url = `https://api.twitterapi.io/twitter/user/following?userName=${encodeURIComponent(username)}`;
    const fetchUrl = CORS_PROXY + encodeURIComponent(url);
    const res = await fetch(fetchUrl, {
      headers: { 'X-API-Key': key, 'Accept': 'application/json' },
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.users || data.data?.users || []).map(u => u.userName || u.username).filter(Boolean);
  } catch { return []; }
}

// ============================================================================
// DOWNLOAD SCAN
// ============================================================================

export function downloadScanAsMarkdown(scan) {
  const tweetText = {};
  if (scan.rawTweets) {
    scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => { tweetText[getTweetUrl(tw)] = tw.text || ''; }));
  } else if (scan.tweetMeta) {
    Object.entries(scan.tweetMeta).forEach(([url, meta]) => { tweetText[url] = meta.text || ''; });
  }
  const d = new Date(scan.date);
  const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  let md = `# Trading Signals\n\n**Date:** ${dateStr}\n**Range:** ${scan.range}\n**Accounts:** ${scan.accounts.length}\n**Signals:** ${scan.signals.length}\n\n---\n\n`;
  scan.signals.forEach((s, i) => {
    const cat = normCat(s.category);
    const tickers = (s.tickers || []).map(t => `${t.symbol} (${t.action})`).join(', ');
    const tweet = tweetText[s.tweet_url] || '';
    const links = (s.links || []).length ? s.links.join(', ') : '';
    md += `## ${s.title}\n\n${s.summary}\n\n`;
    if (tickers) md += `**Tickers:** ${tickers}\n`;
    md += `**Category:** ${cat}\n**Source:** @${s.source}\n`;
    if (tweet) md += `**Tweet:** "${tweet}"\n`;
    if (links) md += `**Links:** ${links}\n`;
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
