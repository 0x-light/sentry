// ============================================================================
// SENTRY API CLIENT - Communicates with the backend Cloudflare Worker
// ============================================================================

import { supabase } from './supabase'
import type { Analyst, UserProfile } from './types'

const API_BASE = import.meta.env.VITE_API_URL || 'https://sentry-api.tomaspalmeirim.workers.dev'

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(errorData.error || 'API request failed')
  }

  return res.json()
}

// ============================================================================
// AUTH (via Supabase directly, not through the worker)
// ============================================================================

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/' },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/',
  })
  if (error) throw error
}

// ============================================================================
// USER PROFILE (matches worker route: GET /api/user)
// ============================================================================

export async function getProfile(): Promise<UserProfile> {
  return fetchApi('/api/user')
}

// ============================================================================
// USER SETTINGS (matches worker routes: GET/PUT /api/user/settings)
// ============================================================================

export async function getSettings(): Promise<any> {
  return fetchApi('/api/user/settings')
}

export async function updateSettings(updates: Record<string, any>): Promise<void> {
  return fetchApi('/api/user/settings', {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

// ============================================================================
// API KEYS — stored locally in browser (BYOK), or use platform keys (paid)
// No per-user server-side key storage — free users BYOK, paid users use
// platform keys configured as Cloudflare Worker secrets.
// ============================================================================

export async function getApiKeys(): Promise<any[]> {
  // API keys are local-only for now — return empty array
  // This is called by settings-dialog to check if keys are synced
  return []
}

export async function saveApiKey(_provider: string, _keyValue: string): Promise<any> {
  throw new Error('API key storage is local-only. Keys are saved in your browser.')
}

export async function deleteApiKey(_provider: string): Promise<void> {
  throw new Error('API key storage is local-only.')
}

// ============================================================================
// ANALYSTS (matches worker routes: /api/user/analysts)
// ============================================================================

export async function getAnalysts(): Promise<Analyst[]> {
  return fetchApi('/api/user/analysts')
}

export async function createAnalystRemote(name: string, prompt: string, isDefault = false): Promise<Analyst> {
  return fetchApi('/api/user/analysts', {
    method: 'POST',
    body: JSON.stringify({ name, prompt, is_default: isDefault }),
  })
}

export async function updateAnalystRemote(id: string, updates: Partial<Analyst>): Promise<Analyst> {
  return fetchApi('/api/user/analysts', {
    method: 'POST',
    body: JSON.stringify({ id, ...updates }),
  })
}

export async function deleteAnalystRemote(id: string): Promise<void> {
  return fetchApi('/api/user/analysts', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}

// ============================================================================
// PRESETS (matches worker routes: /api/user/presets)
// ============================================================================

export async function getPresets(): Promise<any[]> {
  return fetchApi('/api/user/presets')
}

export async function savePreset(data: { id?: string; name: string; accounts: string[] }): Promise<any> {
  return fetchApi('/api/user/presets', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deletePreset(id: string): Promise<void> {
  return fetchApi('/api/user/presets', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}

// ============================================================================
// TWEET FETCHING (matches worker routes: POST /api/tweets/fetch, fetch-batch)
// ============================================================================

export async function fetchTweets(account: string, days: number): Promise<{ tweets: any[]; cached: boolean }> {
  return fetchApi('/api/tweets/fetch', {
    method: 'POST',
    body: JSON.stringify({ account, days }),
  })
}

export async function fetchTweetsBatch(accounts: string[], days: number): Promise<{
  results: Array<{ account: string; tweets: any[]; cached: boolean; error: string | null }>
}> {
  return fetchApi('/api/tweets/fetch-batch', {
    method: 'POST',
    body: JSON.stringify({ accounts, days }),
  })
}

// ============================================================================
// ANALYSIS (matches worker route: POST /api/analyze)
// ============================================================================

export async function analyze(params: {
  model: string
  max_tokens: number
  messages: any[]
  system?: any
  prompt_hash?: string
  tweet_urls?: string[]
}): Promise<any> {
  return fetchApi('/api/analyze', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

// ============================================================================
// SCAN HISTORY (matches worker routes: /api/scans)
// ============================================================================

export async function getScanHistory(): Promise<any[]> {
  return fetchApi('/api/scans')
}

export async function checkScanCache(accounts: string[], days: number, promptHash: string): Promise<{
  cached: boolean
  signals?: any[]
  total_tweets?: number
  ts?: number
}> {
  return fetchApi('/api/scans/check-cache', {
    method: 'POST',
    body: JSON.stringify({ accounts, days, prompt_hash: promptHash }),
  })
}

export async function saveScanToServer(data: {
  accounts: string[]
  range_label: string
  range_days: number
  total_tweets: number
  signal_count: number
  signals: any[]
  tweet_meta?: Record<string, any>
  prompt_hash?: string
  byok?: boolean
}): Promise<{ ok: boolean; id?: string }> {
  return fetchApi('/api/scans', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteScanFromServer(id: string): Promise<void> {
  return fetchApi('/api/scans', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}

// ============================================================================
// BILLING (matches worker routes: /api/billing/*)
// ============================================================================

export async function buyCredits(params: {
  packId: string
  recurring?: boolean
  successUrl?: string
  cancelUrl?: string
}): Promise<{ url: string; id: string }> {
  return fetchApi('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      pack_id: params.packId,
      recurring: params.recurring || false,
      success_url: params.successUrl || window.location.origin + '/v3/?billing=success',
      cancel_url: params.cancelUrl || window.location.origin + '/v3/?billing=cancel',
    }),
  })
}

export async function getBillingPortalUrl(returnUrl?: string): Promise<{ url: string }> {
  return fetchApi('/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify({
      return_url: returnUrl || window.location.origin + '/v3/',
    }),
  })
}

export async function getBillingStatus(): Promise<{
  credits_balance: number
  has_credits: boolean
  subscription_status: string | null
  recent_transactions: any[]
}> {
  return fetchApi('/api/billing/status')
}

export async function verifyCheckout(sessionId: string): Promise<{
  status: string
  credits_balance?: number
  has_credits?: boolean
  subscription_status?: string | null
}> {
  return fetchApi('/api/billing/verify', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function healthCheck(): Promise<{ status: string; version: string }> {
  return fetchApi('/api/health')
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export const api = {
  // Auth
  signUp,
  signIn,
  signInWithGoogle,
  signOut,
  resetPassword,
  // Profile
  getProfile,
  // Settings
  getSettings,
  updateSettings,
  // API Keys (local-only)
  getApiKeys,
  saveApiKey,
  deleteApiKey,
  // Analysts
  getAnalysts,
  createAnalyst: createAnalystRemote,
  updateAnalyst: updateAnalystRemote,
  deleteAnalyst: deleteAnalystRemote,
  // Presets
  getPresets,
  savePreset,
  deletePreset,
  // Tweets
  fetchTweets,
  fetchTweetsBatch,
  // Analysis
  analyze,
  // Scans
  getScanHistory,
  checkScanCache,
  saveScan: saveScanToServer,
  deleteScan: deleteScanFromServer,
  // Billing
  buyCredits,
  getBillingPortalUrl,
  getBillingStatus,
  // Health
  healthCheck,
}

export default api
