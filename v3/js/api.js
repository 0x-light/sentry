wrangler deploy// ============================================================================
// SENTRY v3 — API Client Module
// ============================================================================
//
// Provides a unified API layer that supports both:
//   1. Backend mode (authenticated) — all calls proxied through Sentry API
//   2. BYOK mode (unauthenticated) — direct API calls like v2
//
// The mode is determined by auth state. When authenticated, all tweet fetching
// and analysis goes through the backend (which manages API keys, caching, and
// billing). When not authenticated, falls back to user-provided API keys.
//
// Usage:
//   SentryAPI.init()                               — Initialize API client
//   await SentryAPI.fetchTweets(account, days)      — Fetch tweets
//   await SentryAPI.analyze(body)                   — Analyze with Claude
//   await SentryAPI.getUserProfile()                — Get user profile
//   await SentryAPI.saveSettings(settings)          — Save settings
//   await SentryAPI.getPresets()                    — Get presets
//   await SentryAPI.savePreset(preset)              — Save preset
//   await SentryAPI.getAnalysts()                   — Get analysts
//   await SentryAPI.saveScan(scan)                  — Save scan
//   SentryAPI.isBackendMode()                       — Check if using backend
// ============================================================================

const SentryAPI = (() => {
  // --- Config ---
  const API_BASE = 'https://api.sentry.is';  // Replace with your API URL
  const PROXY_BASE = API_BASE;

  let userProfile = null;
  let userSettings = null;
  let userPlan = null;

  // --- HTTP Helpers ---

  async function apiCall(path, options = {}) {
    const { method = 'GET', body, signal } = options;
    const token = SentryAuth.getToken();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || `API error ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  // --- Mode Detection ---

  function isBackendMode() {
    return SentryAuth.isAuthenticated();
  }

  // --- Initialization ---

  async function init() {
    if (isBackendMode()) {
      try {
        const [profile, settings] = await Promise.all([
          apiCall('/api/user'),
          apiCall('/api/user/settings'),
        ]);
        userProfile = profile;
        userSettings = settings;
        userPlan = profile.plan_details;
      } catch (e) {
        console.warn('Failed to load user data:', e.message);
      }
    }
  }

  // --- Tweet Fetching ---

  async function fetchTweets(account, days, signal) {
    if (isBackendMode()) {
      // Backend mode — server fetches tweets with its own API key
      const data = await apiCall('/api/tweets/fetch', {
        method: 'POST',
        body: { account, days },
        signal,
      });
      return data.tweets || [];
    } else {
      // BYOK mode — direct fetch (requires user's Twitter API key)
      return fetchTweetsDirect(account, days, signal);
    }
  }

  async function fetchTweetsDirect(account, days, signal) {
    const key = localStorage.getItem('signal_twitter_key');
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
      const fetchUrl = `${PROXY_BASE}/api/proxy?url=${encodeURIComponent(targetUrl)}`;

      const res = await fetch(fetchUrl, {
        headers: { 'X-API-Key': key, 'Accept': 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`Twitter API error ${res.status}`);
      const data = await res.json();

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

  async function analyze(body, signal) {
    if (isBackendMode()) {
      // Backend mode — server calls Claude with its own API key
      return apiCall('/api/analyze', {
        method: 'POST',
        body,
        signal,
      });
    } else {
      // BYOK mode — direct call to Anthropic
      return analyzeDirect(body, signal);
    }
  }

  async function analyzeDirect(body, signal) {
    const key = localStorage.getItem('signal_anthropic_key');
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
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic API error');
    return data;
  }

  // --- User Profile ---

  async function getUserProfile() {
    if (!isBackendMode()) return null;
    userProfile = await apiCall('/api/user');
    userPlan = userProfile.plan_details;
    return userProfile;
  }

  function getCachedProfile() { return userProfile; }
  function getCachedPlan() { return userPlan; }
  function getCachedSettings() { return userSettings; }

  // --- Settings ---

  async function getSettings() {
    if (!isBackendMode()) return null;
    userSettings = await apiCall('/api/user/settings');
    return userSettings;
  }

  async function saveSettings(settings) {
    if (!isBackendMode()) return;
    await apiCall('/api/user/settings', { method: 'PUT', body: settings });
    if (userSettings) Object.assign(userSettings, settings);
  }

  // --- Presets ---

  async function getPresets() {
    if (!isBackendMode()) return null;
    return apiCall('/api/user/presets');
  }

  async function savePreset(preset) {
    if (!isBackendMode()) return;
    return apiCall('/api/user/presets', { method: 'POST', body: preset });
  }

  async function deletePreset(id) {
    if (!isBackendMode()) return;
    return apiCall('/api/user/presets', { method: 'DELETE', body: { id } });
  }

  // --- Analysts ---

  async function getAnalysts() {
    if (!isBackendMode()) return null;
    return apiCall('/api/user/analysts');
  }

  async function saveAnalyst(analyst) {
    if (!isBackendMode()) return;
    return apiCall('/api/user/analysts', { method: 'POST', body: analyst });
  }

  async function deleteAnalyst(id) {
    if (!isBackendMode()) return;
    return apiCall('/api/user/analysts', { method: 'DELETE', body: { id } });
  }

  // --- Scan History ---

  async function getScans() {
    if (!isBackendMode()) return null;
    return apiCall('/api/scans');
  }

  async function saveScan(scan) {
    if (!isBackendMode()) return;
    return apiCall('/api/scans', { method: 'POST', body: scan });
  }

  async function deleteScan(id) {
    if (!isBackendMode()) return;
    return apiCall('/api/scans', { method: 'DELETE', body: { id } });
  }

  // --- Billing ---

  async function createCheckout(plan) {
    return apiCall('/api/billing/checkout', {
      method: 'POST',
      body: {
        plan,
        success_url: window.location.origin + window.location.pathname + '?billing=success',
        cancel_url: window.location.origin + window.location.pathname + '?billing=cancel',
      },
    });
  }

  async function openBillingPortal() {
    const data = await apiCall('/api/billing/portal', {
      method: 'POST',
      body: { return_url: window.location.href },
    });
    if (data.url) window.location.href = data.url;
    return data;
  }

  async function getBillingStatus() {
    return apiCall('/api/billing/status');
  }

  // --- Plan Helpers ---

  function canScan() {
    if (!isBackendMode()) return true; // BYOK mode, always allowed
    if (!userProfile) return false;
    return userProfile.scans_remaining !== 0; // -1 = unlimited, >0 = has remaining
  }

  function canUseLiveFeed() {
    if (!isBackendMode()) return true; // BYOK mode
    return userPlan?.live_feed || false;
  }

  function canUseModel(modelId) {
    if (!isBackendMode()) return true; // BYOK mode
    const isExpensive = (modelId || '').toLowerCase().includes('opus');
    if (!isExpensive) return true;
    return userPlan?.all_models || false;
  }

  function getScansRemaining() {
    if (!isBackendMode()) return -1; // unlimited in BYOK
    return userProfile?.scans_remaining ?? 0;
  }

  function getPlanName() {
    if (!isBackendMode()) return 'byok';
    return userProfile?.plan || 'free';
  }

  // --- Public API ---
  return {
    init,
    isBackendMode,
    fetchTweets,
    analyze,
    getUserProfile,
    getCachedProfile,
    getCachedPlan,
    getCachedSettings,
    getSettings,
    saveSettings,
    getPresets,
    savePreset,
    deletePreset,
    getAnalysts,
    saveAnalyst,
    deleteAnalyst,
    getScans,
    saveScan,
    deleteScan,
    createCheckout,
    openBillingPortal,
    getBillingStatus,
    canScan,
    canUseLiveFeed,
    canUseModel,
    getScansRemaining,
    getPlanName,
    API_BASE,
  };
})();
