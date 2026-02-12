// ============================================================================
// SENTRY — API Client Module
// ============================================================================
//
// Unified API layer that supports both:
//   1. Backend mode (authenticated) — calls proxied through Sentry API
//   2. BYOK mode (unauthenticated) — direct API calls with user's own keys
//

import { API_BASE, CORS_PROXY, LS_TW, LS_AN } from './config.js';
import * as auth from './auth.js';

let userProfile = null;

function makeHttpError(message, status, code = null, details = null) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (details) err.details = details;
  return err;
}

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// --- HTTP Helpers ---

async function apiCall(path, options = {}) {
  const { method = 'GET', body, signal, timeoutMs = 30000 } = options;
  const token = auth.getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external abort signal to our controller (cleaned up in finally)
  const onAbort = signal ? () => controller.abort() : null;
  if (onAbort) signal.addEventListener('abort', onAbort, { once: true });

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw new Error('Network error — please check your connection');
  } finally {
    clearTimeout(timeout);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    const data = await parseJsonSafe(res);
    throw makeHttpError(
      data?.error || data?.message || `HTTP ${res.status}`,
      res.status,
      data?.code || null,
      data
    );
  }

  const data = await parseJsonSafe(res);
  if (data === null) return null;
  if (typeof data === 'object') return data;
  throw new Error('Invalid response from server');
}

// --- Mode Detection ---

export function isBackendMode() {
  return auth.isAuthenticated();
}

// --- Initialization ---

export async function init() {
  if (userProfile?._mock) return; // Skip if mock profile is active (dev mode)
  if (isBackendMode()) {
    try {
      userProfile = await apiCall('/api/user');
    } catch (e) {
      console.warn('Failed to load user profile:', e.message);
    }
  }
}

export async function refreshProfile() {
  if (!isBackendMode()) { userProfile = null; return null; }
  try {
    userProfile = await apiCall('/api/user');
    return userProfile;
  } catch (e) {
    console.warn('Failed to refresh profile:', e.message);
    return null;
  }
}

export function getCachedProfile() { return userProfile; }

// --- Tweet Fetching ---

export async function fetchTweets(account, days, signal) {
  if (isBackendMode()) {
    const data = await apiCall('/api/tweets/fetch', {
      method: 'POST', body: { account, days }, signal,
    });
    return data.tweets || [];
  } else {
    return fetchTweetsDirect(account, days, signal);
  }
}

async function fetchTweetsDirect(account, days, signal) {
  const key = localStorage.getItem(LS_TW);
  if (!key) throw new Error('No Twitter API key configured. Add it in Settings.');

  const cutoff = new Date(Date.now() - days * 86400000);
  const allTweets = [];
  let cursor = null;
  let pages = 0;

  while (pages < 5) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);

    const targetUrl = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;
    const fetchUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

    const res = await fetch(fetchUrl, {
      headers: { 'X-API-Key': key, 'Accept': 'application/json' },
      signal,
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      if (res.status === 429) throw makeHttpError('Twitter API rate limited. Please wait and retry.', 429);
      throw makeHttpError(data?.error || data?.message || `Twitter API error ${res.status}`, res.status, data?.code, data);
    }
    if (!data || typeof data !== 'object') throw new Error('Invalid response from Twitter API');

    const apiData = data.data || data;
    if (data.status === 'error') break;
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
  }
  return allTweets;
}

// --- Claude Analysis ---

export async function analyze(body, signal) {
  if (isBackendMode()) {
    return apiCall('/api/analyze', {
      method: 'POST', body, signal, timeoutMs: 120000,
    });
  } else {
    return analyzeDirect(body, signal);
  }
}

async function analyzeDirect(body, signal) {
  const key = localStorage.getItem(LS_AN);
  if (!key) throw new Error('No Anthropic API key configured. Add it in Settings.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || data?.error) {
    const message = data?.error?.message || data?.message || `Anthropic API error (${res.status})`;
    throw makeHttpError(message, res.status, data?.error?.type || data?.code, data);
  }
  if (!data || typeof data !== 'object') throw new Error('Invalid response from Anthropic API');
  return data;
}

// --- User Profile ---

export async function getProfile() {
  if (!isBackendMode()) return null;
  userProfile = await apiCall('/api/user');
  return userProfile;
}

// --- Settings ---

export async function getSettings() {
  if (!isBackendMode()) return null;
  return apiCall('/api/user/settings');
}

export async function saveSettings(settings) {
  if (!isBackendMode()) return;
  await apiCall('/api/user/settings', { method: 'PUT', body: settings });
}

// --- Presets ---

export async function getPresets() {
  if (!isBackendMode()) return null;
  return apiCall('/api/user/presets');
}

export async function savePreset(preset) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/presets', { method: 'POST', body: preset });
}

export async function deletePresetRemote(id) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/presets', { method: 'DELETE', body: { id } });
}

// --- Analysts ---

export async function getAnalysts() {
  if (!isBackendMode()) return null;
  return apiCall('/api/user/analysts');
}

export async function saveAnalyst(analyst) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/analysts', { method: 'POST', body: analyst });
}

export async function deleteAnalystRemote(id) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/analysts', { method: 'DELETE', body: { id } });
}

// --- Tweet Batch Fetching (managed keys — up to 25 accounts per request) ---

export async function fetchTweetsBatch(accounts, days, signal) {
  return apiCall('/api/tweets/fetch-batch', {
    method: 'POST',
    body: { accounts, days },
    signal,
    timeoutMs: 60000,
  });
}

// --- Scan History ---

export async function getScans() {
  if (!isBackendMode()) return null;
  return apiCall('/api/scans');
}

export async function saveScan(scan) {
  if (!isBackendMode()) return;
  return apiCall('/api/scans', { method: 'POST', body: scan });
}

export async function deleteScan(id) {
  if (!isBackendMode()) return;
  return apiCall('/api/scans', { method: 'DELETE', body: { id } });
}

// --- Shared Scans ---

export async function shareScan(scanData) {
  if (!isBackendMode()) return null;
  return apiCall('/api/scans/share', { method: 'POST', body: scanData });
}

export async function getSharedScan(shareId) {
  const res = await fetch(`${API_BASE}/api/shared/${encodeURIComponent(shareId)}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to load shared scan');
  }
  return res.json();
}

// --- Cross-user scan cache (whole-scan cache) ---

export async function checkScanCache(accounts, days, promptHash) {
  return apiCall('/api/scans/check-cache', {
    method: 'POST',
    body: { accounts, days, prompt_hash: promptHash },
  });
}

// --- Cross-user analysis cache (per-tweet cache) ---

export async function checkAnalysisCache(promptHash, tweetUrls) {
  return apiCall('/api/analysis/check-cache', {
    method: 'POST',
    body: { prompt_hash: promptHash, tweet_urls: tweetUrls },
  });
}

// --- Credit Reservation ---

export async function reserveCredits(accountsCount, rangeDays, model) {
  return apiCall('/api/scans/reserve', {
    method: 'POST',
    body: { accounts_count: accountsCount, range_days: rangeDays, model },
  });
}

// --- Scheduled Scans ---

export async function getSchedules() {
  if (!isBackendMode()) return [];
  return apiCall('/api/user/schedules');
}

export async function saveSchedule(data) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/schedules', { method: 'POST', body: data });
}

export async function deleteSchedule(id) {
  if (!isBackendMode()) return;
  return apiCall('/api/user/schedules', { method: 'DELETE', body: { id } });
}

// --- Billing ---

export async function buyCredits(params) {
  return apiCall('/api/billing/checkout', {
    method: 'POST',
    body: {
      pack_id: params.packId,
      recurring: params.recurring || false,
      success_url: params.successUrl || window.location.origin + window.location.pathname + '?billing=success',
      cancel_url: params.cancelUrl || window.location.origin + window.location.pathname + '?billing=cancel',
    },
  });
}

export async function getBillingPortalUrl(returnUrl) {
  return apiCall('/api/billing/portal', {
    method: 'POST',
    body: { return_url: returnUrl || window.location.href },
  });
}

export async function verifyCheckout(sessionId) {
  return apiCall('/api/billing/verify', {
    method: 'POST',
    body: { session_id: sessionId },
  });
}

// --- Plan Helpers ---

export function hasCredits() {
  if (!isBackendMode()) return false;
  return userProfile?.has_credits || (userProfile?.credits_balance > 0);
}

export function getCreditsBalance() {
  return userProfile?.credits_balance || 0;
}

export function isFreeScanAvailable() {
  return userProfile?.free_scan_available ?? true;
}

export function hasSubscription() {
  return userProfile?.subscription_status === 'active';
}

// --- Dev Mode: Mock profile for testing ---

export function _setMockProfile(profile) {
  if (!new URLSearchParams(window.location.search).has('dev')) return;
  userProfile = profile;
}
