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

  const handleSignUp = useCallback(async (email: string, password: string) => {
    if (mockMode) {
      // Mock: instantly "sign up" and "sign in"
      setUser({ id: 'mock-user-id', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email, 'free'))
      return
    }
    await api.signUp(email, password)
  }, [mockMode])

  const handleSignIn = useCallback(async (email: string, password: string) => {
    if (mockMode) {
      setUser({ id: 'mock-user-id', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email, 'free'))
      return
    }
    await api.signIn(email, password)
  }, [mockMode])

  const handleSignInWithGoogle = useCallback(async () => {
    if (mockMode) {
      const email = 'demo@google.com'
      setUser({ id: 'mock-google-id', email, app_metadata: {}, user_metadata: { full_name: 'Demo User' }, aud: 'authenticated', created_at: new Date().toISOString() } as User)
      setProfile(makeMockProfile(email, 'pro'))
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

const PLAN_DETAILS = {
  free: { scans_per_month: 3, max_accounts_per_scan: 10, live_feed: false, all_models: false, api_access: false },
  pro: { scans_per_month: 100, max_accounts_per_scan: 0, live_feed: true, all_models: true, api_access: false },
  ultra: { scans_per_month: 0, max_accounts_per_scan: 0, live_feed: true, all_models: true, api_access: true },
}

export function makeMockProfile(
  email: string,
  plan: 'free' | 'pro' | 'ultra',
  overrides: Partial<UserProfile> = {},
): UserProfile {
  const details = PLAN_DETAILS[plan]
  const scansPerMonth = details.scans_per_month
  return {
    id: 'mock-user-id',
    email,
    name: email.split('@')[0],
    avatar_url: null,
    plan,
    plan_details: details,
    scans_this_month: overrides.scans_this_month ?? 0,
    scans_remaining: scansPerMonth === 0 ? -1 : Math.max(scansPerMonth - (overrides.scans_this_month ?? 0), 0),
    subscription_status: plan === 'free' ? null : 'active',
    current_period_end: plan === 'free' ? null : new Date(Date.now() + 30 * 86400000).toISOString(),
    ...overrides,
  }
}
