// ============================================================================
// SENTRY v3 — Auth Module (Supabase Auth)
// ============================================================================
//
// Provides authentication via Supabase with Google, Apple, and email/password.
// Manages session tokens and user state.
//
// Usage:
//   await SentryAuth.init()          — Initialize auth, check for existing session
//   await SentryAuth.signInGoogle()  — Sign in with Google
//   await SentryAuth.signInApple()   — Sign in with Apple
//   await SentryAuth.signInEmail()   — Sign in with email/password
//   await SentryAuth.signUp()        — Create account with email/password
//   await SentryAuth.signOut()       — Sign out
//   SentryAuth.getToken()            — Get current access token
//   SentryAuth.getUser()             — Get current user object
//   SentryAuth.isAuthenticated()     — Check if user is logged in
//   SentryAuth.onAuthChange(cb)      — Register auth state change callback
// ============================================================================

const SentryAuth = (() => {
  // --- Config (set these for your Supabase project) ---
  const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';      // Replace with your project URL
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                     // Replace with your anon key

  const LS_ACCESS_TOKEN = 'sentry_access_token';
  const LS_REFRESH_TOKEN = 'sentry_refresh_token';
  const LS_USER = 'sentry_user';
  const LS_EXPIRES_AT = 'sentry_token_expires';

  let currentUser = null;
  let accessToken = null;
  let refreshToken = null;
  let expiresAt = 0;
  let authChangeCallbacks = [];
  let refreshTimer = null;

  // --- Core API ---

  async function supabaseAuth(path, body = null, method = 'POST') {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || 'Auth error');
    }
    return data;
  }

  // --- Token Management ---

  function saveSession(session) {
    if (!session) return;
    accessToken = session.access_token;
    refreshToken = session.refresh_token;
    expiresAt = Date.now() + (session.expires_in || 3600) * 1000;

    localStorage.setItem(LS_ACCESS_TOKEN, accessToken);
    localStorage.setItem(LS_REFRESH_TOKEN, refreshToken);
    localStorage.setItem(LS_EXPIRES_AT, String(expiresAt));

    if (session.user) {
      currentUser = session.user;
      localStorage.setItem(LS_USER, JSON.stringify(currentUser));
    }

    scheduleRefresh();
  }

  function clearSession() {
    currentUser = null;
    accessToken = null;
    refreshToken = null;
    expiresAt = 0;
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_EXPIRES_AT);
    if (refreshTimer) clearTimeout(refreshTimer);
  }

  function loadSession() {
    accessToken = localStorage.getItem(LS_ACCESS_TOKEN);
    refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
    expiresAt = parseInt(localStorage.getItem(LS_EXPIRES_AT) || '0');
    const userStr = localStorage.getItem(LS_USER);
    if (userStr) {
      try { currentUser = JSON.parse(userStr); } catch { currentUser = null; }
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const msUntilExpiry = expiresAt - Date.now();
    // Refresh 60 seconds before expiry
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

  async function init() {
    loadSession();

    // Check for OAuth callback in URL
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
        // Fetch user data
        try {
          const user = await supabaseAuth('/user', null, 'GET');
          currentUser = user;
          localStorage.setItem(LS_USER, JSON.stringify(user));
        } catch (e) {
          console.warn('Failed to fetch user after OAuth:', e.message);
        }
        // Clean URL
        history.replaceState(null, '', window.location.pathname + window.location.search);
        notifyAuthChange();
        return;
      }
    }

    // Check for query param callback (PKCE flow)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      try {
        const data = await supabaseAuth('/token?grant_type=authorization_code', { code });
        saveSession(data);
        history.replaceState(null, '', window.location.pathname);
        notifyAuthChange();
        return;
      } catch (e) {
        console.warn('OAuth code exchange failed:', e.message);
      }
    }

    // Existing session — check if token is still valid
    if (accessToken) {
      if (Date.now() < expiresAt - 30000) {
        // Token still valid, schedule refresh
        scheduleRefresh();
        notifyAuthChange();
      } else if (refreshToken) {
        // Token expired, try refresh
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

  async function signInGoogle() {
    const redirectUrl = window.location.origin + window.location.pathname;
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
    window.location.href = url;
  }

  async function signInApple() {
    const redirectUrl = window.location.origin + window.location.pathname;
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=apple&redirect_to=${encodeURIComponent(redirectUrl)}`;
    window.location.href = url;
  }

  async function signInEmail(email, password) {
    const data = await supabaseAuth('/token?grant_type=password', { email, password });
    saveSession(data);
    notifyAuthChange();
    return data.user;
  }

  async function signUp(email, password, name) {
    const data = await supabaseAuth('/signup', {
      email,
      password,
      data: { full_name: name },
    });
    if (data.access_token) {
      saveSession(data);
      notifyAuthChange();
    }
    return data;
  }

  async function signOut() {
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

  async function resetPassword(email) {
    await supabaseAuth('/recover', {
      email,
      redirect_to: window.location.origin + window.location.pathname + '?type=recovery',
    });
  }

  // --- State ---

  function getToken() { return accessToken; }
  function getUser() { return currentUser; }
  function isAuthenticated() { return !!accessToken && !!currentUser; }

  function getUserName() {
    if (!currentUser) return '';
    return currentUser.user_metadata?.full_name
      || currentUser.user_metadata?.name
      || currentUser.email?.split('@')[0]
      || '';
  }

  function getUserAvatar() {
    return currentUser?.user_metadata?.avatar_url || null;
  }

  // --- Callbacks ---

  function onAuthChange(callback) {
    authChangeCallbacks.push(callback);
    // Return unsubscribe function
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

  // --- Public API ---
  return {
    init,
    signInGoogle,
    signInApple,
    signInEmail,
    signUp,
    signOut,
    resetPassword,
    getToken,
    getUser,
    isAuthenticated,
    getUserName,
    getUserAvatar,
    onAuthChange,
    // Constants for external config
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  };
})();
