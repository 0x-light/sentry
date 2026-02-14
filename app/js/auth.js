// ============================================================================
// SENTRY — Auth Module (Supabase Auth, no SDK dependency)
// ============================================================================
//
// Vanilla JS auth using Supabase REST API directly — no npm packages needed.
// Manages session tokens, auto-refresh, and auth state callbacks.
//

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LS_ACCESS_TOKEN = 'sentry_access_token';
const LS_REFRESH_TOKEN = 'sentry_refresh_token';
const LS_USER = 'sentry_user';
const LS_EXPIRES_AT = 'sentry_token_expires';

let currentUser = null;
let accessToken = null;
let refreshToken = null;
let expiresAt = 0;
let authChangeCallbacks = [];
let pendingRecovery = false;
let refreshTimer = null;

function hasAuthConfig() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

function assertAuthConfig() {
  if (hasAuthConfig()) return;
  throw new Error('Authentication is not configured. Set sentry-supabase-url and sentry-supabase-anon-key.');
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`Failed to persist auth key "${key}":`, e.message);
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`Failed to clear auth key "${key}":`, e.message);
  }
}

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`Failed to read auth key "${key}":`, e.message);
    return null;
  }
}

// --- Core API ---

async function supabaseAuth(path, body = null, method = 'POST') {
  assertAuthConfig();
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Auth request timed out');
    throw new Error('Unable to reach auth service');
  } finally {
    clearTimeout(timeout);
  }
  const rawText = await res.text();
  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('Auth service returned an invalid response');
    }
  }
  if (!res.ok) {
    const err = new Error(data.error_description || data.msg || data.error || 'Auth error');
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      err.retryAfter = retryAfter || 60;
    }
    throw err;
  }
  return data;
}

// --- Token Management ---

function saveSession(session) {
  if (!session) return;
  accessToken = session.access_token;
  refreshToken = session.refresh_token;
  expiresAt = Date.now() + (session.expires_in || 3600) * 1000;

  lsSet(LS_ACCESS_TOKEN, accessToken);
  lsSet(LS_REFRESH_TOKEN, refreshToken);
  lsSet(LS_EXPIRES_AT, String(expiresAt));

  if (session.user) {
    currentUser = session.user;
    lsSet(LS_USER, JSON.stringify(currentUser));
  }

  scheduleRefresh();
}

function clearSession() {
  currentUser = null;
  accessToken = null;
  refreshToken = null;
  expiresAt = 0;
  lsRemove(LS_ACCESS_TOKEN);
  lsRemove(LS_REFRESH_TOKEN);
  lsRemove(LS_USER);
  lsRemove(LS_EXPIRES_AT);
  if (refreshTimer) clearTimeout(refreshTimer);
}

function loadSession() {
  accessToken = lsGet(LS_ACCESS_TOKEN);
  refreshToken = lsGet(LS_REFRESH_TOKEN);
  expiresAt = parseInt(lsGet(LS_EXPIRES_AT) || '0');
  const userStr = lsGet(LS_USER);
  if (userStr) {
    try { currentUser = JSON.parse(userStr); } catch { currentUser = null; }
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const msUntilExpiry = expiresAt - Date.now();
  const refreshIn = Math.max(msUntilExpiry - 60000, 5000);
  refreshTimer = setTimeout(async () => {
    try {
      await refreshSession();
    } catch (e) {
      console.warn('Token refresh failed:', e.message);
      clearSession();
      notifyAuthChange();
    }
  }, refreshIn);
}

async function refreshSession() {
  if (!refreshToken) throw new Error('No refresh token');
  const data = await supabaseAuth('/token?grant_type=refresh_token', {
    refresh_token: refreshToken,
  });
  saveSession(data);
  notifyAuthChange();
}

// --- Auth Methods ---

export async function init() {
  loadSession();

  if (!hasAuthConfig()) {
    clearSession();
    notifyAuthChange();
    return;
  }

  // Check for OAuth error in query params (e.g. bad_oauth_state from Supabase)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('error')) {
    console.warn('OAuth error:', urlParams.get('error_description') || urlParams.get('error'));
    history.replaceState(null, '', window.location.pathname);
  }

  // Check for OAuth callback in URL hash (implicit flow)
  const hash = window.location.hash;
  if (hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    const session = {
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      expires_in: parseInt(params.get('expires_in') || '3600'),
    };
    if (session.access_token) {
      saveSession(session);
      try {
        const user = await supabaseAuth('/user', null, 'GET');
        currentUser = user;
        lsSet(LS_USER, JSON.stringify(user));
      } catch (e) {
        console.warn('Failed to fetch user after OAuth:', e.message);
      }
      if (params.get('type') === 'recovery') {
        pendingRecovery = true;
      }
      history.replaceState(null, '', window.location.pathname);
      notifyAuthChange();
      return;
    }
  }

  // Check for PKCE code in query params
  const code = urlParams.get('code');
  if (code) {
    // Always clean up the code from the URL to prevent replay and stale bookmarks
    history.replaceState(null, '', window.location.pathname);
    try {
      const data = await supabaseAuth('/token?grant_type=authorization_code', { code });
      saveSession(data);
      notifyAuthChange();
      return;
    } catch (e) {
      console.warn('OAuth code exchange failed:', e.message);
    }
  }

  // Existing session — check if token is still valid
  if (accessToken) {
    if (Date.now() < expiresAt - 30000) {
      scheduleRefresh();
      notifyAuthChange();
    } else if (refreshToken) {
      try {
        await refreshSession();
      } catch {
        clearSession();
        notifyAuthChange();
      }
    } else {
      clearSession();
      notifyAuthChange();
    }
  }
}

export function signInGoogle() {
  assertAuthConfig();
  const redirectUrl = window.location.origin + window.location.pathname;
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
  window.location.assign(url);
}

export async function signInEmail(email, password) {
  const data = await supabaseAuth('/token?grant_type=password', { email, password });
  saveSession(data);
  notifyAuthChange();
  return data.user;
}

export async function signUp(email, password) {
  const data = await supabaseAuth('/signup', { email, password });
  if (data.access_token) {
    saveSession(data);
    notifyAuthChange();
  }
  return data;
}

export async function signOut() {
  try {
    if (accessToken) {
      await supabaseAuth('/logout', {}, 'POST');
    }
  } catch (e) {
    console.warn('Logout API call failed:', e.message);
  }
  clearSession();
  notifyAuthChange();
}

export function isPendingRecovery() { return pendingRecovery; }
export function clearPendingRecovery() { pendingRecovery = false; }

export async function updatePassword(newPassword) {
  await supabaseAuth('/user', { password: newPassword }, 'PUT');
  pendingRecovery = false;
}

export async function resetPassword(email) {
  await supabaseAuth('/recover', {
    email,
    redirect_to: window.location.origin + window.location.pathname + '?type=recovery',
  });
}

// --- State ---

export function getToken() { return accessToken; }
export function getUser() { return currentUser; }
export function isAuthenticated() { return !!accessToken && !!currentUser; }

export function getUserEmail() {
  return currentUser?.email || '';
}

export function getUserName() {
  if (!currentUser) return '';
  return currentUser.user_metadata?.full_name
    || currentUser.user_metadata?.name
    || currentUser.email?.split('@')[0]
    || '';
}

// --- Callbacks ---

export function onAuthChange(callback) {
  authChangeCallbacks.push(callback);
  return () => {
    authChangeCallbacks = authChangeCallbacks.filter(cb => cb !== callback);
  };
}

function notifyAuthChange() {
  const state = { user: currentUser, authenticated: isAuthenticated() };
  authChangeCallbacks.forEach(cb => {
    try { cb(state); } catch (e) { console.error('Auth callback error:', e); }
  });
}

// --- Dev Mode: Mock auth for local testing (only works with ?dev in URL) ---

export function _mockSignIn(email = 'dev@sentry.is') {
  if (!new URLSearchParams(window.location.search).has('dev')) return;
  currentUser = {
    id: 'mock-dev-user',
    email,
    user_metadata: { full_name: 'Dev User' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  accessToken = 'mock-token-for-dev';
  notifyAuthChange();
}

export function _mockSignOut() {
  if (!new URLSearchParams(window.location.search).has('dev')) return;
  currentUser = null;
  accessToken = null;
  notifyAuthChange();
}
