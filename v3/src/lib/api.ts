// ============================================================================
// SENTRY API CLIENT - Communicates with the backend Cloudflare Worker
// ============================================================================

import { supabase } from './supabase'
import type { Analyst, UserProfile, ScheduledScan } from './types'

const API_BASE = import.meta.env.VITE_API_URL || 'https://sentry-api.tomaspalmeirim.workers.dev'

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

const DEFAULT_TIMEOUT_MS = 30_000 // 30 second default timeout

async function fetchApi<T = any>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options
  const token = await getToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> || {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Create abort controller for timeout (merge with any existing signal)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  // If the caller provided a signal, forward its abort
  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener('abort', () => controller.abort())
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })
  } catch (e: any) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') {
      throw new Error('Request timed out — the server took too long to respond')
    }
    throw new Error('Network error — please check your connection')
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`
    try {
      const errorData = await res.json()
      errorMessage = errorData.error || errorData.message || errorMessage
    } catch {
      // Response body isn't JSON — use status text
      errorMessage = res.statusText || errorMessage
    }
    const err = new Error(errorMessage) as Error & { status: number; code?: string }
    err.status = res.status
    throw err
  }

  try {
    return await res.json()
  } catch {
    throw new Error('Invalid response from server')
  }
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
    timeoutMs: 60_000, // Batch tweet fetching can be slow for many accounts
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
    timeoutMs: 120_000, // Analysis can take up to 2 minutes
  })
}

/**
 * Check the server-side analysis cache for individual tweet URLs.
 * Returns partial results: cached signals for known URLs + list of missing URLs.
 * This enables cross-user analysis caching — if another user already analyzed
 * the same tweets with the same prompt, we skip re-analysis.
 */
export async function checkAnalysisCache(promptHash: string, tweetUrls: string[]): Promise<{
  cached: Record<string, any[]>
  missing: string[]
}> {
  return fetchApi('/api/analysis/check-cache', {
    method: 'POST',
    body: JSON.stringify({ prompt_hash: promptHash, tweet_urls: tweetUrls }),
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

export async function reserveCredits(accountsCount: number, rangeDays: number, model?: string): Promise<{
  ok: boolean
  reservation_id?: string
  credits_needed: number
  credits_balance?: number
  free_tier?: boolean
  error?: string
  code?: string
}> {
  return fetchApi('/api/scans/reserve', {
    method: 'POST',
    body: JSON.stringify({ accounts_count: accountsCount, range_days: rangeDays, model }),
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
  reservation_id?: string
  model?: string
}): Promise<{ ok: boolean; id?: string; credits_used?: number; credits_balance?: number }> {
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
// SCHEDULED SCANS (matches worker routes: /api/user/schedules)
// ============================================================================

export async function getSchedules(): Promise<ScheduledScan[]> {
  return fetchApi('/api/user/schedules')
}

export async function saveSchedule(data: {
  id?: string
  label: string
  time: string
  timezone: string
  days: number[]
  range_days: number
  preset_id?: string | null
  accounts: string[]
  enabled: boolean
}): Promise<{ ok: boolean; id?: string }> {
  return fetchApi('/api/user/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteScheduleFromServer(id: string): Promise<void> {
  return fetchApi('/api/user/schedules', {
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
  checkAnalysisCache,
  // Scans
  getScanHistory,
  checkScanCache,
  reserveCredits,
  saveScan: saveScanToServer,
  deleteScan: deleteScanFromServer,
  // Schedules
  getSchedules,
  saveSchedule,
  deleteSchedule: deleteScheduleFromServer,
  // Billing
  buyCredits,
  getBillingPortalUrl,
  getBillingStatus,
  // Health
  healthCheck,
}

export default api
