import { useState, useRef } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { ChevronRight, Check, ExternalLink, Plus, X, Download, Loader2 } from '@/components/icons'
import * as engine from '@/lib/engine'

const STEPS = ['Welcome', 'Setup', 'Accounts', 'Analysts', 'Ready'] as const
type Step = (typeof STEPS)[number]

// ── Suggested analysts ───────────────────────────────────────────────────

const SUGGESTED_ANALYSTS: { id: string; name: string; description: string; prompt: string }[] = [
  {
    id: 'macro',
    name: 'Macro & Geopolitics',
    description: 'Central bank policy, geopolitical risk, sovereign debt, FX, and global macro positioning.',
    prompt: `You are a macro-geopolitical intelligence analyst. Extract signals about global macro themes, central bank policy, geopolitics, and their market implications from these tweets.

FOCUS ON:
- Central bank policy signals: rate decisions, QE/QT, forward guidance shifts, liquidity changes
- Geopolitical events: conflicts, sanctions, trade policy, elections, regime changes
- Sovereign risk: debt dynamics, fiscal policy, credit rating implications
- Currency & FX flows: dollar strength/weakness, carry trades, emerging market stress
- Commodity macro: energy policy, supply chain disruptions, strategic reserves
- Cross-asset implications: how macro events flow through to equities, bonds, commodities, crypto
- Contrarian macro views that challenge consensus narratives

SKIP:
- Single-stock earnings or company-specific news (unless it has macro significance)
- Pure technical analysis without macro context
- Crypto-specific protocol updates without broader market implications
- Memes, engagement bait, personal updates

WRITING:
- Titles: max 12 words, lead with the macro theme or region. Signal the market implication.
- Summaries: 1-2 sentences. What is the macro event/shift, and what does it imply for positioning?
- Connect the dots: if a policy change implies bond/FX/equity moves, say so explicitly.

Return a JSON array. Each signal:
- "title": headline, lead with theme or $TICKER when relevant
- "summary": 1-2 sentences — the macro view and implied positioning
- "category": "Trade" | "Insight" | "Tool" | "Resource"
- "source": twitter handle (no @)
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch"}]
  Map to tradeable instruments: currencies ($DXY, $EURUSD), bonds ($TLT, $TNX), commodities ($XAU, $USO), indices ($SPY, $QQQ), ETFs.
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned. Empty array if none.

Return ONLY valid JSON array. No markdown, no explanation.`,
  },
  {
    id: 'tech',
    name: 'Tech & Builders',
    description: 'AI models, dev tools, open source, startup launches, infrastructure, and products.',
    prompt: `You are a technology intelligence analyst focused on the builder ecosystem. Extract signals about AI, developer tools, infrastructure, and tech products from these tweets.

FOCUS ON:
- AI developments: new models, benchmarks, capabilities, research breakthroughs, API launches
- Developer tools & infrastructure: new frameworks, SDKs, platforms, databases, cloud services
- Open source: notable releases, major version updates, project milestones, ecosystem shifts
- Startup launches & products: new products, pivots, shutdowns, notable demos
- Infrastructure trends: edge computing, serverless, observability, security tooling
- Platform shifts: API changes, pricing model changes, ecosystem moves by major players (OpenAI, Google, Meta, etc.)
- Hiring signals & team moves that indicate strategic direction

SKIP:
- Pure financial/trading signals without tech substance
- Vague hype or "AI will change everything" posts without specifics
- Personal updates, engagement bait, motivational content
- Marketing fluff without substantive product information

WRITING:
- Titles: max 12 words, lead with the product/technology name. Be specific about what's new.
- Summaries: 1-2 sentences. What launched/changed, why it matters, and who should care.
- Use precise technical language but keep it accessible.

Return a JSON array. Each signal:
- "title": headline, lead with product/company name
- "summary": 1-2 sentences — what's new and why it matters
- "category": "Trade" (if there's a clear investment angle) | "Insight" (industry analysis, trend observation) | "Tool" (product, platform, or technology) | "Resource" (tutorial, documentation, dataset)
- "source": twitter handle (no @)
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch"}]
  Map companies to stock tickers when publicly traded (OpenAI ecosystem → $MSFT, Google/Alphabet → $GOOGL, Meta → $META, NVIDIA → $NVDA, AMD → $AMD, etc.). Include relevant crypto tokens for web3/protocol tools.
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned (GitHub repos, docs, blog posts, demos). Empty array if none.

Return ONLY valid JSON array. No markdown, no explanation.`,
  },
]

export function Onboarding() {
  const {
    completeOnboarding,
    presets, loadedPresets, togglePreset,
    customAccounts, addAccount, removeAccount,
    analysts, createAnalyst, savePreset,
    setPricingOpen,
  } = useSentry()

  const { isAuthenticated, signIn, signUp, signInWithGoogle, resetPassword, profile } = useAuth()

  const [step, setStep] = useState(0)
  const [setupPath, setSetupPath] = useState<'signin' | 'byok' | null>(null)
  const [twKey, setTwKey] = useState('')
  const [anKey, setAnKey] = useState('')
  const [accountInput, setAccountInput] = useState('')
  const [selectedAnalysts, setSelectedAnalysts] = useState<Set<string>>(new Set())
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInMessage, setSignInMessage] = useState('')
  const [signInMode, setSignInMode] = useState<'choose' | 'email'>('choose')

  // Import following state
  const [importUsername, setImportUsername] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importError, setImportError] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const importAbortRef = useRef<AbortController | null>(null)

  const handleImportFollowing = async () => {
    const username = importUsername.trim().replace(/^@/, '').toLowerCase()
    if (!username || importing) return

    setImporting(true)
    setImportError('')
    setImportProgress('Fetching following list...')
    setImportedCount(0)
    importAbortRef.current = new AbortController()

    try {
      const accounts = await engine.fetchFollowing(
        username,
        (msg) => setImportProgress(msg),
        importAbortRef.current.signal
      )
      if (accounts.length === 0) {
        setImportError('No accounts found. The user may have a private following list.')
        return
      }
      // Save as a preset
      const presetName = `${username}'s following`
      savePreset(presetName, accounts)
      togglePreset(presetName)
      setImportedCount(accounts.length)
      setImportProgress(`Imported ${accounts.length} accounts as "${presetName}"`)
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setImportProgress('Cancelled')
      } else {
        setImportError(e.message)
      }
    } finally {
      setImporting(false)
      importAbortRef.current = null
    }
  }

  const handleCancelImport = () => {
    importAbortRef.current?.abort()
  }

  const currentStep = STEPS[step]

  const handleSaveKeys = () => {
    if (twKey.trim()) localStorage.setItem('signal_twitter_key', twKey.trim())
    if (anKey.trim()) localStorage.setItem('signal_anthropic_key', anKey.trim())
  }

  const handleCreateAnalysts = () => {
    for (const sa of SUGGESTED_ANALYSTS) {
      if (selectedAnalysts.has(sa.id)) {
        if (!analysts.some(a => a.name === sa.name)) {
          createAnalyst(sa.name, sa.prompt)
        }
      }
    }
  }

  const handleNext = () => {
    if (step === 1 && setupPath === 'byok') handleSaveKeys()
    if (step === 3) handleCreateAnalysts()
    if (step < STEPS.length - 1) setStep(step + 1)
  }

  const handleBack = () => {
    if (step === 1) setSetupPath(null)
    if (step > 0) setStep(step - 1)
  }

  const handleFinish = () => {
    completeOnboarding()
  }

  const handleGoogleSignIn = async () => {
    setSigningIn(true)
    setSignInError('')
    try {
      await signInWithGoogle()
    } catch (err: any) {
      setSignInError(err.message || 'Sign in failed')
      setSigningIn(false)
    }
  }

  const handleEmailAuth = async (mode: 'login' | 'signup') => {
    if (!signInEmail.trim() || !signInPassword.trim()) {
      setSignInError('Please enter email and password')
      return
    }
    if (mode === 'signup' && signInPassword.length < 6) {
      setSignInError('Password must be at least 6 characters')
      return
    }
    setSigningIn(true)
    setSignInError('')
    setSignInMessage('')
    try {
      if (mode === 'signup') {
        await signUp(signInEmail.trim(), signInPassword)
        setSignInMessage('Check your email for a confirmation link!')
        setSigningIn(false)
      } else {
        await signIn(signInEmail.trim(), signInPassword)
      }
    } catch (err: any) {
      setSignInError(err.message || 'Authentication failed')
      setSigningIn(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!signInEmail.trim()) {
      setSignInError('Enter your email first')
      return
    }
    setSigningIn(true)
    setSignInError('')
    try {
      await resetPassword(signInEmail.trim())
      setSignInMessage('Password reset email sent!')
    } catch (err: any) {
      setSignInError(err.message || 'Failed to send reset email')
    } finally {
      setSigningIn(false)
    }
  }

  const handleAddAccount = () => {
    const val = accountInput.trim().replace(/^@/, '')
    if (val) {
      val.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).forEach(addAccount)
      setAccountInput('')
    }
  }

  const toggleAnalyst = (id: string) => {
    setSelectedAnalysts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasKeys = isAuthenticated || (twKey.trim().length >= 20 && anKey.trim().length >= 20)
  const hasAccounts = customAccounts.length > 0 || loadedPresets.length > 0
  const hasTwKey = isAuthenticated || twKey.trim().length >= 20

  return (
    <div className="onboarding min-h-screen bg-background flex items-center justify-center p-4">
      <div className="onboarding-container w-full max-w-md">
        {/* Progress dots */}
        <div className="onboarding-progress flex items-center justify-center gap-1.5 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step ? "w-6 bg-foreground" : i < step ? "w-1.5 bg-foreground/40" : "w-1.5 bg-foreground/15"
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="onboarding-steps space-y-6">

          {/* ── Step 0: Welcome ─────────────────────────────────── */}
          {currentStep === 'Welcome' && (
            <div className="onboarding-welcome text-center space-y-6">
              <div className="flex items-center justify-center gap-3">
                <div className="w-3 h-4 bg-foreground rounded-[3px]" />
                <span className="text-base tracking-tight">sentry</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-2xl tracking-tight">signal without the noise</h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Sentry scans X/Twitter accounts and uses AI to extract actionable trading signals — tickers, sentiment, and catalysts — from the noise.
                </p>
              </div>

              <div className="space-y-2 text-left max-w-xs mx-auto">
                <div className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                    <span className="text-xs">1</span>
                  </div>
                  <span className="text-muted-foreground">Sign in or add your own API keys</span>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                    <span className="text-xs">2</span>
                  </div>
                  <span className="text-muted-foreground">Pick accounts or presets to monitor</span>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                    <span className="text-xs">3</span>
                  </div>
                  <span className="text-muted-foreground">Hit scan and get structured signals</span>
                </div>
              </div>

              <Button onClick={handleNext} className="gap-2">
                Get started
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* ── Step 1: Setup (Sign in or BYOK) ─────────────────── */}
          {currentStep === 'Setup' && (
            <div className="onboarding-setup space-y-6">
              {/* Already signed in during this step */}
              {isAuthenticated ? (
                <div className="text-center space-y-4 py-4">
                  <div className="w-10 h-10 rounded-full bg-signal-green-bg flex items-center justify-center mx-auto">
                    <Check className="h-5 w-5 text-signal-green" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-base tracking-tight">You're signed in</h2>
                    <p className="text-sm text-muted-foreground">
                        Signed in! Buy credits for managed API keys, or use your own keys for free.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-4">
                    <Button variant="ghost" size="sm" onClick={handleBack}>
                      Back
                    </Button>
                    <Button onClick={handleNext} className="gap-1.5">
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : !setupPath ? (
                /* Choose path */
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <h2 className="text-base tracking-tight">How do you want to use Sentry?</h2>
                    <p className="text-sm text-muted-foreground">
                      Sign in for the easiest experience, or bring your own API keys.
                    </p>
                  </div>

                  {/* Option 1: Sign in */}
                  <button
                    onClick={() => { setSetupPath('signin') }}
                    className="w-full text-left rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="text-xs">Recommended</Badge>
                    </div>
                    <h3 className="text-sm font-medium">Sign in</h3>
                    <p className="text-sm text-muted-foreground">
                      Sign in and buy credits for managed API keys. Or use our free tier with your own keys (1 scan/day, 10 accounts).
                    </p>
                  </button>

                  {/* Option 2: BYOK */}
                  <button
                    onClick={() => setSetupPath('byok')}
                    className="w-full text-left rounded-lg border p-4 space-y-2 transition-colors hover:border-foreground/20"
                  >
                    <h3 className="text-sm font-medium">Use your own API keys</h3>
                    <p className="text-sm text-muted-foreground">
                      Bring your own X/Twitter and Anthropic keys. Unlimited scans, you pay the APIs directly.
                    </p>
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="ghost" size="sm" onClick={handleBack}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : setupPath === 'signin' ? (
                /* Sign in path */
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <h2 className="text-base tracking-tight">Sign in</h2>
                    <p className="text-sm text-muted-foreground">
                      Create an account to get started with managed API keys.
                    </p>
                  </div>

                  {signInError && (
                    <p className="text-sm text-destructive text-center">{signInError}</p>
                  )}
                  {signInMessage && (
                    <p className="text-sm text-signal-green text-center">{signInMessage}</p>
                  )}

                  {signInMode === 'choose' ? (
                    <>
                      <Button
                        className="w-full"
                        onClick={handleGoogleSignIn}
                        disabled={signingIn}
                      >
                        {signingIn ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Continue with Google'
                        )}
                      </Button>

                      <div className="relative flex items-center">
                        <Separator className="flex-1" />
                        <span className="px-3 text-xs text-muted-foreground">or</span>
                        <Separator className="flex-1" />
                      </div>

                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setSignInMode('email')}
                        disabled={signingIn}
                      >
                        Continue with email
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={signInEmail}
                            onChange={e => setSignInEmail(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleEmailAuth('login') }}
                            placeholder="you@email.com"
                            disabled={signingIn}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Password</Label>
                          <Input
                            type="password"
                            value={signInPassword}
                            onChange={e => setSignInPassword(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleEmailAuth('login') }}
                            placeholder="••••••••"
                            disabled={signingIn}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={() => handleEmailAuth('login')} disabled={signingIn}>
                          {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log in'}
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => handleEmailAuth('signup')} disabled={signingIn}>
                          {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign up'}
                        </Button>
                      </div>

                      <div className="flex items-center justify-between">
                        <button
                          onClick={handleForgotPassword}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Forgot password?
                        </button>
                        <button
                          onClick={() => setSignInMode('choose')}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Use Google instead
                        </button>
                      </div>
                    </>
                  )}

                  <div className="text-center">
                    <button
                      onClick={() => setSetupPath('byok')}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Use your own API keys instead
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="ghost" size="sm" onClick={() => { setSetupPath(null); setSignInMode('choose') }}>
                      Back
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleNext} className="text-muted-foreground">
                      Skip
                    </Button>
                  </div>
                </div>
              ) : (
                /* BYOK path */
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <h2 className="text-base tracking-tight">API keys</h2>
                    <p className="text-sm text-muted-foreground">
                      Your keys are stored securely on your device and never shared.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>X/Twitter API key</Label>
                      <Input
                        type="password"
                        value={twKey}
                        onChange={e => setTwKey(e.target.value)}
                        placeholder="Your twitterapi.io key"
                      />
                      <a
                        href="https://twitterapi.io"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Get one at twitterapi.io
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>

                    <div className="space-y-2">
                      <Label>Anthropic API key</Label>
                      <Input
                        type="password"
                        value={anKey}
                        onChange={e => setAnKey(e.target.value)}
                        placeholder="sk-ant-..."
                      />
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Get one at console.anthropic.com
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="text-center">
                    <button
                      onClick={() => setSetupPath('signin')}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Sign in instead for managed keys
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setSetupPath(null)}>
                      Back
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={handleNext} className="text-muted-foreground">
                        Skip
                      </Button>
                      <Button onClick={handleNext} disabled={!hasKeys} className="gap-1.5">
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Accounts ─────────────────────────────────── */}
          {currentStep === 'Accounts' && (
            <div className="onboarding-accounts space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-base tracking-tight">Accounts to scan</h2>
                <p className="text-sm text-muted-foreground">
                  Pick a preset or add individual X/Twitter accounts to monitor.
                </p>
              </div>

              {/* Presets */}
              <div className="space-y-3">
                <Label>Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {presets.filter(p => !p.hidden).map(p => {
                    const active = loadedPresets.includes(p.name)
                    return (
                      <button
                        key={p.name}
                        onClick={() => togglePreset(p.name)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                          active
                            ? "border-foreground/20 bg-foreground/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          active ? "bg-foreground border-foreground" : "border-border"
                        )}>
                          {active && <Check className="h-3 w-3 text-background" />}
                        </div>
                        <span>{p.name}</span>
                        <span className="text-muted-foreground text-xs">{p.accounts.length}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Separator />

              {/* Import from Twitter */}
              <div className="space-y-3">
                <Label>Import from Twitter</Label>
                <p className="text-xs text-muted-foreground">
                  Enter a username to import all accounts they follow as a preset.
                </p>
                <div className="rounded-md bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/30 dark:border-amber-500/20 px-3 py-2">
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    <strong className="font-medium">Note:</strong> Importing lists with thousands of accounts can consume credits rapidly when scanned. Consider creating smaller, focused presets to manage your credit usage effectively.
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  <Input
                    value={importUsername}
                    onChange={e => setImportUsername(e.target.value)}
                    placeholder="@ your username"
                    className="flex-1 h-10"
                    onKeyDown={e => { if (e.key === 'Enter') handleImportFollowing() }}
                    disabled={importing || !hasTwKey}
                  />
                  {importing ? (
                    <Button variant="outline" size="icon" onClick={handleCancelImport} className="h-10 w-10">
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleImportFollowing}
                      disabled={!importUsername.trim() || !hasTwKey}
                      className="h-10 w-10"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {!hasTwKey && (
                  <p className="text-xs text-muted-foreground">Requires a Twitter API key (set in the previous step).</p>
                )}
                {importing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{importProgress}</span>
                  </div>
                )}
                {importError && (
                  <p className="text-xs text-destructive">{importError}</p>
                )}
                {!importing && !importError && importedCount > 0 && (
                  <p className="text-xs text-signal-green">{importProgress}</p>
                )}
              </div>

              <Separator />

              {/* Custom accounts */}
              <div className="space-y-3">
                <Label>Custom accounts</Label>
                <div className="flex gap-2">
                  <Input
                    value={accountInput}
                    onChange={e => setAccountInput(e.target.value.replace(/^@/, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddAccount() }}
                    placeholder="@ username"
                    className="flex-1"
                  />
                  {accountInput.trim() && (
                    <Button variant="outline" size="icon" onClick={handleAddAccount}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {customAccounts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {customAccounts.map(a => (
                      <Badge key={a} variant="secondary" className="gap-1 cursor-pointer select-none">
                        @{a}
                        <X
                          className="h-3 w-3 opacity-50 hover:opacity-100 transition-opacity"
                          onClick={() => removeAccount(a)}
                        />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleNext} className="text-muted-foreground">
                    Skip
                  </Button>
                  <Button onClick={handleNext} disabled={!hasAccounts} className="gap-1.5">
                    Continue
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Analysts ─────────────────────────────────── */}
          {currentStep === 'Analysts' && (
            <div className="onboarding-analysts space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-base tracking-tight">Analysts</h2>
                <p className="text-sm text-muted-foreground">
                  Analysts are AI prompts that tell Sentry what to look for. The default one covers trading signals. You can add more for other areas.
                </p>
              </div>

              {/* Default analyst (always on) */}
              <div className="rounded-lg border border-foreground/20 bg-foreground/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Default</span>
                  <Badge variant="default" className="text-xs">active</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Trading signals — directional views, catalysts, technicals, on-chain data, and contrarian takes.
                </p>
              </div>

              <Separator />

              {/* Suggested analysts */}
              <div className="space-y-3">
                <Label>Add analysts</Label>
                <div className="space-y-2">
                  {SUGGESTED_ANALYSTS.map(sa => {
                    const active = selectedAnalysts.has(sa.id)
                    return (
                      <button
                        key={sa.id}
                        onClick={() => toggleAnalyst(sa.id)}
                        className={cn(
                          "w-full text-left rounded-lg border p-3 space-y-1.5 transition-colors",
                          active
                            ? "border-foreground/20 bg-foreground/5"
                            : "border-border hover:border-foreground/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                            active ? "bg-foreground border-foreground" : "border-border"
                          )}>
                            {active && <Check className="h-3 w-3 text-background" />}
                          </div>
                          <span className="text-sm">{sa.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground pl-6">
                          {sa.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <p className="text-sm text-muted-foreground text-center">
                You can create, edit, or remove analysts anytime in settings.
              </p>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
                <Button onClick={handleNext} className="gap-1.5">
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Ready ─────────────────────────────────── */}
          {currentStep === 'Ready' && (
            <div className="onboarding-ready text-center space-y-6">
              <div className="w-10 h-10 rounded-full bg-signal-green-bg flex items-center justify-center mx-auto">
                <Check className="h-5 w-5 text-signal-green" />
              </div>

              <div className="space-y-2">
                <h2 className="text-base tracking-tight">You're all set</h2>
                <p className="text-sm text-muted-foreground">
                  You can always change your settings later from the gear icon in the top right.
                </p>
              </div>

              <div className="space-y-2 text-sm text-left max-w-xs mx-auto">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Account</span>
                  <span>{isAuthenticated ? (
                    <span className="text-signal-green flex items-center gap-1"><Check className="h-3.5 w-3.5" />signed in</span>
                  ) : (
                    <span className="text-muted-foreground">not signed in</span>
                  )}</span>
                </div>
                <Separator />
                {!isAuthenticated && (
                  <>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-muted-foreground">API keys</span>
                      <span>{hasKeys ? (
                        <span className="text-signal-green flex items-center gap-1"><Check className="h-3.5 w-3.5" />configured</span>
                      ) : (
                        <span className="text-muted-foreground">skipped</span>
                      )}</span>
                    </div>
                    <Separator />
                  </>
                )}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Accounts</span>
                  <span>
                    {hasAccounts ? (
                      <span className="text-signal-green flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" />
                        {loadedPresets.length > 0 && loadedPresets.join(', ')}
                        {loadedPresets.length > 0 && customAccounts.length > 0 && ' + '}
                        {customAccounts.length > 0 && `${customAccounts.length} custom`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">skipped</span>
                    )}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Analysts</span>
                  <span className="text-signal-green flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" />
                    {1 + selectedAnalysts.size} active
                  </span>
                </div>
              </div>

              {!isAuthenticated && (
                <p className="text-sm text-muted-foreground">
                  You can{' '}
                  <button onClick={() => { completeOnboarding(); setPricingOpen(true) }} className="underline hover:text-foreground transition-colors">
                    buy credits
                  </button>
                  {' '}anytime for managed API keys and unlimited accounts.
                </p>
              )}

              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={handleFinish} className="gap-2">
                  Start using sentry
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground">
                  Go back
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
