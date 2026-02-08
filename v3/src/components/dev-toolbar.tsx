import { useState } from 'react'
import { useAuth, makeMockProfile } from '@/hooks/use-auth'
import { useSentry } from '@/hooks/use-sentry'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/lib/types'

const PLANS = ['free', 'pro', 'ultra'] as const

export function DevToolbar() {
  const auth = useAuth()
  const sentry = useSentry()
  const [collapsed, setCollapsed] = useState(false)
  const [scansUsed, setScansUsed] = useState(0)

  const mock = auth._mock
  if (!mock) return null // Only render in mock mode

  const currentPlan = auth.profile?.plan || 'free'

  const setMockAuth = (plan: typeof PLANS[number]) => {
    const email = 'tester@sentry.is'
    const user = {
      id: 'mock-user-id',
      email,
      app_metadata: {},
      user_metadata: { full_name: 'Test User' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    } as User

    mock.setUser(user)
    mock.setProfile(makeMockProfile(email, plan, { scans_this_month: scansUsed }))
  }

  const handleLogout = () => {
    mock.setUser(null)
    mock.setProfile(null)
  }

  const handleSetScans = (n: number) => {
    setScansUsed(n)
    if (auth.isAuthenticated && auth.profile) {
      const plan = auth.profile.plan
      mock.setProfile(makeMockProfile(auth.profile.email, plan, { scans_this_month: n }))
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[9999] bg-violet-600 text-white px-3 py-1.5 rounded-full text-xs font-medium shadow-lg hover:bg-violet-500 transition-colors"
      >
        DEV
      </button>
    )
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-[9999] bg-zinc-900 border-t border-zinc-700 text-zinc-200 text-xs">
      <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
        {/* Label */}
        <span className="font-semibold text-violet-400 shrink-0">DEV</span>

        {/* Separator */}
        <div className="w-px h-4 bg-zinc-700" />

        {/* Auth state */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Auth:</span>
          {auth.isAuthenticated ? (
            <span className="text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {auth.user?.email}
            </span>
          ) : (
            <span className="text-zinc-500">signed out</span>
          )}
        </div>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Plan switcher */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Plan:</span>
          {PLANS.map(plan => (
            <button
              key={plan}
              onClick={() => setMockAuth(plan)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                auth.isAuthenticated && currentPlan === plan
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              {plan}
            </button>
          ))}
          {auth.isAuthenticated && (
            <button
              onClick={handleLogout}
              className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-red-400 hover:bg-red-900/50 transition-colors"
            >
              logout
            </button>
          )}
        </div>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Scans slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Scans used:</span>
          <input
            type="range"
            min={0}
            max={10}
            value={scansUsed}
            onChange={e => handleSetScans(Number(e.target.value))}
            className="w-16 h-1 accent-violet-500"
          />
          <span className="text-zinc-400 tabular-nums w-4 text-center">{scansUsed}</span>
        </div>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Open dialogs */}
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Open:</span>
          <button
            onClick={() => sentry.setAuthDialogOpen(true)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Auth
          </button>
          <button
            onClick={() => sentry.openSettings('account')}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Account
          </button>
          <button
            onClick={() => sentry.setPricingOpen(true)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Pricing
          </button>
          <button
            onClick={() => sentry.openSettings('api')}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Settings
          </button>
        </div>

        {/* Collapse */}
        <button
          onClick={() => setCollapsed(true)}
          className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
