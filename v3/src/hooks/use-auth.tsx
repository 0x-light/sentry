import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import * as api from '@/lib/api'
import type { UserProfile, AuthState } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

interface AuthStore extends AuthState {
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  refreshProfile: () => Promise<void>
  // Mock mode controls (exposed for DevToolbar)
  _mock?: {
    setUser: (user: User | null) => void
    setProfile: (profile: UserProfile | null) => void
  }
}

const AuthContext = createContext<AuthStore | null>(null)

export function useAuth(): AuthStore {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

interface AuthProviderProps {
  children: React.ReactNode
  mockMode?: boolean
}

export function AuthProvider({ children, mockMode = false }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(!mockMode)

  const isAuthenticated = !!user

  // Fetch user profile from backend
  const refreshProfile = useCallback(async () => {
    if (mockMode) return // Mock mode doesn't fetch from server
    if (!user) {
      setProfile(null)
      return
    }
    try {
      const p = await api.getProfile()
      setProfile(p)
    } catch (err) {
      console.warn('Failed to fetch profile:', err)
      setProfile(null)
    }
  }, [user, mockMode])

  // Initialize auth state (skip in mock mode)
  useEffect(() => {
    if (mockMode) {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (!session?.user) {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [mockMode])

  // Fetch profile when user changes
  useEffect(() => {
    if (user && !mockMode) {
      refreshProfile()
    }
  }, [user, refreshProfile, mockMode])

  // Verify checkout and update profile after returning from Stripe
  // Stripe appends session_id to the success URL — we use it to verify directly
  useEffect(() => {
    if (mockMode || !user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') !== 'success') return

    const sessionId = params.get('session_id')

    // Clean up the URL
    const cleanUrl = window.location.pathname + window.location.hash
    window.history.replaceState({}, '', cleanUrl)

    let pollInterval: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const verify = async () => {
      // Try direct verification first (doesn't depend on webhook)
      if (sessionId) {
        try {
          const result = await api.verifyCheckout(sessionId)
          if (result.status === 'fulfilled') {
            if (!cancelled) await refreshProfile()
            return
          }
        } catch (e) {
          console.warn('Checkout verify failed, falling back to polling:', e)
        }
      }

      if (cancelled) return

      // Fallback: poll profile until credits appear (webhook may be slow)
      let attempts = 0
      const maxAttempts = 10
      pollInterval = setInterval(async () => {
        if (cancelled) { if (pollInterval) clearInterval(pollInterval); return; }
        attempts++
        try {
          const p = await api.getProfile()
          if (p && (p.credits_balance > 0 || p.subscription_status === 'active')) {
            if (!cancelled) setProfile(p)
            if (pollInterval) clearInterval(pollInterval)
          } else if (attempts >= maxAttempts) {
            if (pollInterval) clearInterval(pollInterval)
          }
        } catch {
          if (attempts >= maxAttempts && pollInterval) clearInterval(pollInterval)
        }
      }, 2000)
    }

    verify()

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [user, mockMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignUp = useCallback(async (email: string, password: string) => {
    if (mockMode) {
      // Mock: instantly "sign up" and "sign in"
      setUser({ id: 'mock-user-id', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email))
      return
    }
    await api.signUp(email, password)
  }, [mockMode])

  const handleSignIn = useCallback(async (email: string, password: string) => {
    if (mockMode) {
      setUser({ id: 'mock-user-id', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email))
      return
    }
    await api.signIn(email, password)
  }, [mockMode])

  const handleSignInWithGoogle = useCallback(async () => {
    if (mockMode) {
      const email = 'demo@google.com'
      setUser({ id: 'mock-google-id', email, app_metadata: {}, user_metadata: { full_name: 'Demo User' }, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email, { credits_balance: 5000 }))
      return
    }
    await api.signInWithGoogle()
  }, [mockMode])

  const handleSignOut = useCallback(async () => {
    if (mockMode) {
      setUser(null)
      setProfile(null)
      return
    }
    await api.signOut()
    setUser(null)
    setProfile(null)
  }, [mockMode])

  const handleResetPassword = useCallback(async (email: string) => {
    if (mockMode) {
      alert(`[Mock] Password reset email sent to ${email}`)
      return
    }
    await api.resetPassword(email)
  }, [mockMode])

  const value: AuthStore = {
    user,
    profile,
    loading,
    isAuthenticated,
    signUp: handleSignUp,
    signIn: handleSignIn,
    signInWithGoogle: handleSignInWithGoogle,
    signOut: handleSignOut,
    resetPassword: handleResetPassword,
    refreshProfile,
    // Expose mock controls for DevToolbar
    ...(mockMode ? {
      _mock: {
        setUser,
        setProfile,
      }
    } : {}),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ============================================================================
// MOCK PROFILE FACTORY
// ============================================================================

export function makeMockProfile(
  email: string,
  overrides: Partial<UserProfile> = {},
): UserProfile {
  const credits = overrides.credits_balance ?? 0
  return {
    id: 'mock-user-id',
    email,
    name: email.split('@')[0],
    avatar_url: null,
    credits_balance: credits,
    has_credits: credits > 0,
    free_scan_available: true,
    subscription_status: credits > 0 ? 'active' : null,
    ...overrides,
  }
}
