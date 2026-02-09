import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Signal, Analyst, ScanResult, ScanHistoryEntry, Preset, ScheduledScan } from '@/lib/types'
import { RANGES } from '@/lib/constants'
import * as engine from '@/lib/engine'
import { useAuth } from '@/hooks/use-auth'
import * as api from '@/lib/api'

interface Notice { type: 'error' | 'warning' | 'resume'; message: string; }
interface Status { text: string; animate: boolean; showDownload: boolean; }

interface SentryStore {
  // Theme
  theme: string;
  toggleTheme: () => void;

  // Accounts
  customAccounts: string[];
  loadedPresets: string[];
  presets: Preset[];
  addAccount: (account: string) => void;
  removeAccount: (account: string) => void;
  togglePreset: (name: string) => void;
  clearAllAccounts: () => void;
  savePreset: (name: string, accounts: string[], editingName?: string | null) => void;
  deletePreset: (name: string) => void;
  togglePresetVisibility: (name: string) => void;

  // Recents
  recents: string[];
  addFromRecents: (account: string) => void;
  clearRecents: () => void;

  // Scanning
  range: number;
  setRange: (r: number) => void;
  busy: boolean;
  scanResult: ScanResult | null;
  status: Status | null;
  notices: Notice[];
  scan: () => Promise<void>;
  cancelScan: () => void;
  resumeScan: () => Promise<void>;
  dismissResumeBanner: () => void;
  hasPendingScan: boolean;
  pendingScanInfo: string;

  // Signals & Filters
  filters: { category: string | null; ticker: string | null };
  setFilter: (category: string | null) => void;
  setTickerFilter: (ticker: string | null) => void;

  // History
  scanHistory: ScanHistoryEntry[];
  deleteHistoryScan: (index: number) => void;
  refreshHistory: () => void;

  // Settings
  settingsOpen: boolean;
  settingsTab: string;
  setSettingsTab: (tab: string) => void;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;

  // Preset dialog
  presetDialogOpen: boolean;
  editingPreset: string | null;
  openPresetDialog: (editing?: string | null) => void;
  closePresetDialog: () => void;

  // Analysts
  analysts: Analyst[];
  activeAnalystId: string;
  setActiveAnalystId: (id: string) => void;
  saveAnalysts: (analysts: Analyst[]) => void;
  createAnalyst: (name: string, prompt: string) => Analyst;
  deleteAnalyst: (id: string) => void;
  duplicateAnalyst: (id: string) => Analyst | null;

  // Display
  financeProvider: string;
  font: string;
  fontSize: string;
  showTickerPrice: boolean;
  iconSet: string;

  // Live feed
  liveEnabled: boolean;
  isLiveMode: boolean;
  toggleLive: () => void;

  // Sharing
  shareSignal: (index: number) => Promise<void>;
  downloadScan: () => void;
  isSharedView: boolean;
  sharedSignal: Signal | null;

  // Export/Import
  exportData: () => Promise<string>;
  importBackup: (encoded: string) => void;
  clearCache: () => void;
  cacheSize: number;

  // Prices
  priceCache: Record<string, { price: number; change: number; ts: number }>;
  fetchPrices: (symbols: string[]) => Promise<void>;

  // Onboarding
  onboardingDone: boolean;
  completeOnboarding: () => void;
  resetOnboarding: () => void;

  // V3: Auth-related UI state
  authDialogOpen: boolean;
  setAuthDialogOpen: (open: boolean) => void;
  authDialogTab: 'login' | 'signup';
  pricingOpen: boolean;
  setPricingOpen: (open: boolean) => void;

  // Current model (reactive)
  model: string;

  // Settings apply (no page reload)
  applySettings: () => void;

  // Dev: load mock signals
  loadMockSignals?: () => void;

  // Scheduled scans (server-side)
  schedules: ScheduledScan[];
  schedulesLoading: boolean;
  addSchedule: (data: { time: string; label: string; range_days: number; preset_id?: string | null; accounts: string[] }) => void;
  updateSchedule: (id: string, updates: Partial<ScheduledScan>) => void;
  deleteSchedule: (id: string) => void;
  refreshSchedules: () => void;
  nextScheduleLabel: string;
}

const SentryContext = createContext<SentryStore | null>(null)

export function useSentry(): SentryStore {
  const ctx = useContext(SentryContext)
  if (!ctx) throw new Error('useSentry must be used within SentryProvider')
  return ctx
}

export function SentryProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile, refreshProfile } = useAuth()

  // Theme
  const [theme, setThemeState] = useState(() => engine.getTheme())
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    engine.setTheme(next)
    setThemeState(next)
  }, [theme])

  // Range (declared early because addAccount/togglePreset reference it for prefetch)
  const [range, setRange] = useState(0)

  // Accounts
  const [customAccounts, setCustomAccounts] = useState(() => engine.getStoredAccounts())
  const [loadedPresets, setLoadedPresets] = useState(() => engine.getStoredLoadedPresets())
  const [presets, setPresets] = useState(() => engine.getPresets())
  const [recents, setRecents] = useState(() => engine.getRecents())

  const getAllAccounts = useCallback(() => {
    const all = [...customAccounts]
    for (const name of loadedPresets) {
      const p = presets.find(p => p.name === name)
      if (p) all.push(...p.accounts)
    }
    return [...new Set(all)]
  }, [customAccounts, loadedPresets, presets])

  const addAccount = useCallback((account: string) => {
    const c = account.trim().replace(/^@/, '').toLowerCase()
    if (!c) return
    setCustomAccounts(prev => {
      if (prev.includes(c)) return prev
      const next = [...prev, c]
      engine.saveAccounts(next)
      // Prefetch tweets in background so scan starts instantly
      if (engine.bothKeys()) {
        engine.prefetchTweets(c, RANGES[range].days)
      }
      return next
    })
  }, [range])

  const removeAccount = useCallback((account: string) => {
    setCustomAccounts(prev => {
      const next = prev.filter(a => a !== account)
      engine.saveAccounts(next)
      return next
    })
  }, [])

  const togglePreset = useCallback((name: string) => {
    setLoadedPresets(prev => {
      const wasLoaded = prev.includes(name)
      const next = wasLoaded ? prev.filter(n => n !== name) : [...prev, name]
      engine.saveLoadedPresets(next)
      // Prefetch tweets for newly-loaded preset accounts
      if (!wasLoaded && engine.bothKeys()) {
        const preset = presets.find(p => p.name === name)
        if (preset) engine.prefetchMultiple(preset.accounts, RANGES[range].days)
      }
      return next
    })
  }, [presets, range])

  const clearAllAccounts = useCallback(() => {
    setCustomAccounts([])
    setLoadedPresets([])
    engine.saveAccounts([])
    engine.saveLoadedPresets([])
  }, [])

  const addFromRecents = useCallback((account: string) => {
    addAccount(account)
  }, [addAccount])

  const clearRecentsHandler = useCallback(() => {
    engine.clearRecents()
    setRecents([])
  }, [])

  // Presets
  const savePreset = useCallback((name: string, accounts: string[], editingName?: string | null) => {
    let p = engine.getPresets()
    const existing = p.find(x => x.name === (editingName || name))
    if (editingName) p = p.filter(x => x.name !== editingName)
    p = p.filter(x => x.name !== name)
    p.push({ name, accounts, hidden: existing?.hidden })
    engine.savePresetsData(p)
    setPresets(p)
    if (editingName && editingName !== name && loadedPresets.includes(editingName)) {
      setLoadedPresets(prev => {
        const next = prev.map(n => n === editingName ? name : n)
        engine.saveLoadedPresets(next)
        return next
      })
    }
  }, [loadedPresets])

  const deletePreset = useCallback((name: string) => {
    const p = engine.getPresets().filter(x => x.name !== name)
    engine.savePresetsData(p)
    setPresets(p)
    if (loadedPresets.includes(name)) {
      setLoadedPresets(prev => {
        const next = prev.filter(n => n !== name)
        engine.saveLoadedPresets(next)
        return next
      })
    }
  }, [loadedPresets])

  const togglePresetVisibility = useCallback((name: string) => {
    const p = engine.getPresets().map(x =>
      x.name === name ? { ...x, hidden: !x.hidden } : x
    )
    engine.savePresetsData(p)
    setPresets(p)
  }, [])

  // Scanning
  const [busy, setBusy] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(() => engine.loadCurrentScan())
  const [status, setStatus] = useState<Status | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [filters, setFilters] = useState<{ category: string | null; ticker: string | null }>({ category: null, ticker: null })
  const [scanHistory, setScanHistory] = useState(() => engine.getScanHistory())
  const abortRef = useRef<AbortController | null>(null)
  const pendingTweetsRef = useRef<import('@/lib/types').AccountTweets[] | null>(null)

  // Pending scan
  const [hasPendingScan, setHasPendingScan] = useState(() => !!engine.loadPendingScan())
  const [pendingScanInfo, setPendingScanInfo] = useState(() => {
    const p = engine.loadPendingScan()
    if (!p) return ''
    const total = p.accountTweets.reduce((s: number, a: any) => s + a.tweets.length, 0)
    const ago = Math.round((Date.now() - new Date(p.date).getTime()) / 60000)
    return `${p.accounts.length} accounts · ${total} tweets · ${ago < 1 ? 'just now' : ago + 'm ago'}`
  })

  // Analysts
  const [analysts, setAnalysts] = useState(() => engine.initAnalysts())
  const [activeAnalystId, setActiveAnalystIdState] = useState(() => engine.getActiveAnalystId())

  const setActiveAnalystIdHandler = useCallback((id: string) => {
    engine.setActiveAnalystId(id)
    setActiveAnalystIdState(id)
  }, [])

  const saveAnalystsHandler = useCallback((a: Analyst[]) => {
    engine.saveAnalysts(a)
    setAnalysts(a)
  }, [])

  const createAnalyst = useCallback((name: string, prompt: string): Analyst => {
    const newA: Analyst = { id: engine.generateAnalystId(), name, prompt, isDefault: false }
    const next = [...analysts, newA]
    engine.saveAnalysts(next)
    setAnalysts(next)
    return newA
  }, [analysts])

  const deleteAnalystHandler = useCallback((id: string) => {
    if (id === 'default') return
    const next = analysts.filter(a => a.id !== id)
    engine.saveAnalysts(next)
    setAnalysts(next)
    if (activeAnalystId === id) {
      engine.setActiveAnalystId('default')
      setActiveAnalystIdState('default')
    }
  }, [analysts, activeAnalystId])

  const duplicateAnalyst = useCallback((id: string): Analyst | null => {
    const source = analysts.find(a => a.id === id)
    if (!source) return null
    return createAnalyst(source.name + ' (copy)', source.prompt)
  }, [analysts, createAnalyst])

  // Display settings
  const [financeProvider, setFinanceProvider] = useState(() => engine.getFinanceProvider())
  const [model, setModelState] = useState(() => engine.getModel())
  const [font, setFont] = useState(() => engine.getFont())
  const [fontSize, setFontSize] = useState(() => engine.getFontSize())
  const [showTickerPrice, setShowTickerPrice] = useState(() => engine.getShowTickerPrice())
  const [iconSet, setIconSet] = useState(() => engine.getIconSet())

  // Apply font class to body
  useEffect(() => {
    document.body.classList.remove('font-geist', 'font-mono')
    if (font === 'geist') document.body.classList.add('font-geist')
    else if (font === 'mono') document.body.classList.add('font-mono')
  }, [font])

  // Apply font size to document
  useEffect(() => {
    if (fontSize && fontSize !== 'medium') {
      document.documentElement.setAttribute('data-font-size', fontSize)
    } else {
      document.documentElement.removeAttribute('data-font-size')
    }
  }, [fontSize])

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('api')
  const openSettings = useCallback((tab?: string) => {
    // V3: Handle special "auth" pseudo-tab
    if (tab === 'auth') {
      setAuthDialogOpen(true)
      return
    }
    if (tab) setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Preset dialog
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<string | null>(null)
  const openPresetDialog = useCallback((editing?: string | null) => {
    setEditingPreset(editing ?? null)
    setPresetDialogOpen(true)
  }, [])
  const closePresetDialog = useCallback(() => {
    setEditingPreset(null)
    setPresetDialogOpen(false)
  }, [])

  // Onboarding
  const [onboardingDone, setOnboardingDoneState] = useState(() => engine.isOnboardingDone())
  const completeOnboarding = useCallback(() => {
    engine.setOnboardingDone(true)
    setOnboardingDoneState(true)
  }, [])
  const resetOnboarding = useCallback(() => {
    engine.setOnboardingDone(false)
    setOnboardingDoneState(false)
  }, [])

  // V3: Auth dialog state
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [authDialogTab, setAuthDialogTab] = useState<'login' | 'signup'>('login')

  // V3: User menu state


  // V3: Pricing dialog state
  const [pricingOpen, setPricingOpen] = useState(false)

  // Live feed
  const [liveEnabled, setLiveEnabledState] = useState(() => engine.isLiveEnabled())
  const [isLiveMode, setIsLiveMode] = useState(false)
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seenTweetUrlsRef = useRef(new Set<string>())

  const toggleLive = useCallback(() => {
    if (!liveEnabled) { openSettings('data'); return; }
    if (isLiveMode) {
      setIsLiveMode(false)
    } else {
      const hasCredits = isAuthenticated && profile?.has_credits
      if (!engine.bothKeys() && !hasCredits) { openSettings('api'); return; }
      // Initialize seen tweets from the current scan result
      seenTweetUrlsRef.current.clear()
      if (scanResult?.rawTweets) {
        scanResult.rawTweets.forEach(a => a.tweets.forEach(tw => seenTweetUrlsRef.current.add(engine.getTweetUrl(tw))))
      }
      const pollAccounts = scanResult?.accounts || getAllAccounts()
      if (!pollAccounts.length) return
      setIsLiveMode(true)
    }
  }, [liveEnabled, isLiveMode, scanResult, openSettings, isAuthenticated, profile, getAllAccounts])

  // Live polling effect — starts/stops based on isLiveMode state.
  // Reads fresh values of analysts, accounts, etc. on each poll tick.
  useEffect(() => {
    if (!isLiveMode) {
      // Clean up on toggle off or unmount
      if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
      return
    }

    const poll = async () => {
      try {
        const currentAccounts = scanResult?.accounts || getAllAccounts()
        if (!currentAccounts.length) return

        const hasBYOK = engine.bothKeys()
        const hasCredits = isAuthenticated && profile?.has_credits
        const useManaged = !!hasCredits && !hasBYOK
        engine.setUseServerApi(useManaged)

        const fresh = await engine.fetchAllTweets(currentAccounts, 1, () => {}, null)
        engine.setUseServerApi(false)

        const newTweets: import('@/lib/types').AccountTweets[] = []
        for (const acct of fresh) {
          const unseen = acct.tweets.filter(tw => !seenTweetUrlsRef.current.has(engine.getTweetUrl(tw)))
          if (unseen.length) {
            unseen.forEach(tw => seenTweetUrlsRef.current.add(engine.getTweetUrl(tw)))
            newTweets.push({ account: acct.account, tweets: unseen })
          }
        }

        if (!newTweets.length) return

        const cache = engine.loadAnalysisCache()
        const promptHash = engine.getPromptHash(analysts)
        const newSignals = await engine.analyzeWithBatching(
          newTweets,
          newTweets.reduce((s, a) => s + a.tweets.length, 0),
          () => {},
          promptHash, cache, null, analysts
        )
        if (newSignals.length) {
          setScanResult(prev => {
            if (!prev) return prev
            return { ...prev, signals: [...newSignals, ...prev.signals], totalTweets: prev.totalTweets + newTweets.reduce((s, a) => s + a.tweets.length, 0) }
          })
        }
      } catch (e) {
        console.warn('Live poll error:', e)
      }
    }

    liveIntervalRef.current = setInterval(poll, 90_000)
    return () => {
      if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode])

  // Sharing
  const isSharedView = typeof window !== 'undefined' && window.location.hash.startsWith('#s=')
  const [sharedSignal, setSharedSignal] = useState<Signal | null>(() => {
    if (typeof window === 'undefined') return null
    const hash = window.location.hash
    if (!hash.startsWith('#s=')) return null
    return engine.decodeSignal(hash.slice(3))
  })

  const shareSignal = useCallback(async (index: number) => {
    if (!scanResult?.signals?.[index]) return
    const signal = scanResult.signals[index]
    const encoded = engine.encodeSignal(signal)
    const url = `${location.origin}${location.pathname}#s=${encoded}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard API may not be available (e.g. HTTP context, iframe)
      console.warn('Clipboard API unavailable')
    }
  }, [scanResult])

  const downloadScan = useCallback(() => {
    if (scanResult) engine.downloadScanAsMarkdown(scanResult)
  }, [scanResult])

  // Prices
  const [priceCacheVersion, setPriceCacheVersion] = useState(0)
  const fetchPrices = useCallback(async (symbols: string[]) => {
    await engine.fetchAllPrices(symbols)
    setPriceCacheVersion(v => v + 1)
  }, [])

  // Cache
  const [cacheSize, setCacheSize] = useState(() => {
    const cache = engine.loadAnalysisCache()
    return Object.keys(cache.entries || {}).length
  })

  const clearCache = useCallback(() => {
    localStorage.removeItem('signal_analysis_cache')
    engine.clearPendingScan()
    setCacheSize(0)
  }, [])

  // Export/Import
  const exportDataFn = useCallback(async () => {
    return engine.exportData(customAccounts, loadedPresets, analysts)
  }, [customAccounts, loadedPresets, analysts])

  const importBackup = useCallback((encoded: string) => {
    let data: ReturnType<typeof engine.importData>
    try {
      data = engine.importData(encoded)
    } catch (e) {
      throw new Error('Failed to parse backup data. The data may be corrupted.')
    }
    if (!data || typeof data !== 'object' || (!data.v && !data.version)) {
      throw new Error('Invalid backup format — missing version identifier')
    }
    try {
      if (data.settings && typeof data.settings === 'object') {
        if (typeof data.settings.theme === 'string') { engine.setTheme(data.settings.theme); setThemeState(data.settings.theme); }
        if (typeof data.settings.font === 'string') { engine.setFont(data.settings.font); setFont(data.settings.font); }
        if (typeof data.settings.fontSize === 'number') { engine.setFontSize(data.settings.fontSize); setFontSize(data.settings.fontSize); }
        if (typeof data.settings.financeProvider === 'string') localStorage.setItem('signal_finance_provider', data.settings.financeProvider)
        if (typeof data.settings.model === 'string') localStorage.setItem('signal_model', data.settings.model)
      }
      if (Array.isArray(data.analysts)) { engine.saveAnalysts(data.analysts); setAnalysts(data.analysts); }
      if (typeof data.activeAnalyst === 'string') { engine.setActiveAnalystId(data.activeAnalyst); setActiveAnalystIdState(data.activeAnalyst); }
      if (typeof data.keys?.twitter === 'string') localStorage.setItem('signal_twitter_key', data.keys.twitter)
      if (typeof data.keys?.anthropic === 'string') localStorage.setItem('signal_anthropic_key', data.keys.anthropic)
      if (Array.isArray(data.presets)) { engine.savePresetsData(data.presets); setPresets(data.presets); }
      if (Array.isArray(data.accounts)) { engine.saveAccounts(data.accounts); setCustomAccounts(data.accounts); }
      if (Array.isArray(data.loadedPresets)) { engine.saveLoadedPresets(data.loadedPresets); setLoadedPresets(data.loadedPresets); }
      if (Array.isArray(data.recents)) { localStorage.setItem('signal_recent_accounts', JSON.stringify(data.recents)); setRecents(data.recents); }
    } catch (e) {
      console.error('Import error while applying data:', e)
      throw new Error('Import partially failed — some settings may not have been restored')
    }
  }, [])

  // ── Cross-device sync: load scan history from server for signed-in users ──
  const loadServerHistory = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const serverScans = await api.getScanHistory()
      if (!serverScans?.length) return
      const serverHistory: ScanHistoryEntry[] = serverScans.map((s: any) => ({
        id: s.id,
        date: s.created_at,
        range: s.range_label,
        accounts: Array.isArray(s.accounts) ? s.accounts.length : (s.accounts ?? 0),
        totalTweets: s.total_tweets ?? 0,
        signalCount: s.signal_count ?? 0,
        signals: engine.normalizeSignals(s.signals || []),
      }))
      setScanHistory(serverHistory)

      // If no current scan in localStorage, load the latest server scan
      if (!engine.loadCurrentScan() && serverScans[0]) {
        const latest = serverScans[0]
        const restored: ScanResult = {
          date: latest.created_at,
          range: latest.range_label,
          days: latest.range_days,
          accounts: Array.isArray(latest.accounts) ? latest.accounts : [],
          totalTweets: latest.total_tweets ?? 0,
          signals: engine.normalizeSignals(latest.signals || []),
          tweetMeta: latest.tweet_meta || {},
        }
        setScanResult(restored)
        // Also set the range selector to match
        const idx = RANGES.findIndex(r => r.label === latest.range_label)
        if (idx !== -1) setRange(idx)
      }
    } catch (e) {
      console.warn('Failed to load server scan history:', e)
    }
  }, [isAuthenticated])

  useEffect(() => { loadServerHistory() }, [loadServerHistory])

  // Scan
  const scan = useCallback(async () => {
    const accounts = getAllAccounts()
    if (!accounts.length || busy) return

    // V3: Credit-based access control
    const hasCredits = isAuthenticated && profile?.has_credits
    if (isAuthenticated && profile) {
      if (!hasCredits && !profile.free_scan_available) {
        setPricingOpen(true)
        setNotices([{ type: 'error', message: 'Daily free scan used. Buy credits or come back tomorrow.' }])
        return
      }
      if (!hasCredits && accounts.length > 10) {
        setPricingOpen(true)
        setNotices([{ type: 'error', message: 'Free tier allows up to 10 accounts. Buy credits for more.' }])
        return
      }
    }

    // If user has their own keys, always use them (BYOK saves platform costs).
    // If no own keys but has credits, use managed server keys.
    // If no own keys and no credits, prompt for keys.
    const hasBYOK = engine.bothKeys()
    if (!hasBYOK && !hasCredits) { openSettings('api'); return; }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setBusy(true)
    setNotices([])
    setStatus({ text: '', animate: true, showDownload: false })
    setFilters({ category: null, ticker: null })

    if (customAccounts.length) {
      engine.addToRecents(customAccounts)
      setRecents(engine.getRecents())
    }

    const days = RANGES[range].days
    // Use server API (managed keys) only when user has credits but no own keys
    const useManaged = !!hasCredits && !hasBYOK

    // ── Pre-scan credit reservation (prevents API drain) ──
    // For managed-key users, we reserve credits BEFORE the scan starts.
    // This ensures users can't consume expensive API calls without enough credits.
    let reservationId: string | undefined
    if (useManaged && isAuthenticated) {
      try {
        setStatus({ text: 'Checking credits…', animate: true, showDownload: false })
        const reservation = await api.reserveCredits(accounts.length, days, engine.getModel())
        if (!reservation.ok) {
          setBusy(false)
          setPricingOpen(true)
          setNotices([{ type: 'error', message: reservation.error || 'Not enough credits.' }])
          setStatus(null)
          return
        }
        reservationId = reservation.reservation_id

        // Low-credit warning: if remaining balance after scan would be < 20% of current
        if (reservation.credits_balance && reservation.credits_needed) {
          const remaining = reservation.credits_balance - reservation.credits_needed
          if (remaining > 0 && remaining < reservation.credits_balance * 0.2) {
            setNotices(prev => [...prev, { type: 'warning', message: `Low credits: ~${remaining.toLocaleString()} will remain after this scan.` }])
          }
        }
      } catch (e: any) {
        setBusy(false)
        // If reservation fails due to insufficient credits, show pricing
        if (e.message?.includes('credits') || e.message?.includes('free scan')) {
          setPricingOpen(true)
        }
        setNotices([{ type: 'error', message: e.message || 'Failed to reserve credits.' }])
        setStatus(null)
        return
      }
    }

    engine.setUseServerApi(useManaged)
    try {
      // If resuming, use pre-fetched tweets to skip the fetch phase
      const prefetched = pendingTweetsRef.current || undefined
      pendingTweetsRef.current = null

      const result = await engine.runScan(
        accounts, days, abortRef.current.signal,
        (text, animate) => setStatus({ text, animate: !!animate, showDownload: false }),
        (type, msg) => setNotices(prev => [...prev, { type, message: msg }]),
        analysts,
        prefetched
      )

      if (result) {
        result.range = RANGES[range].label
        engine.saveScan(result)
        // Load from localStorage to get tweetMeta (built by saveScan)
        setScanResult(engine.loadCurrentScan() || result)
        setScanHistory(engine.getScanHistory())

        const d = new Date()
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        setStatus({
          text: `${dateStr} · ${accounts.length} accounts · ${result.totalTweets} tweets · ${result.signals.length} signals`,
          animate: false, showDownload: true
        })

        // Fetch prices for all tickers
        const allSymbols = new Set<string>()
        result.signals.forEach(s => (s.tickers || []).forEach(t => {
          const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase()
          if (sym) allSymbols.add(sym)
        }))
        if (allSymbols.size) fetchPrices([...allSymbols])

        // Save to server and refresh profile + history
        // If BYOK, tell server to skip credit deduction
        if (isAuthenticated) {
          api.saveScanToServer({
            accounts,
            range_label: RANGES[range].label,
            range_days: days,
            total_tweets: result.totalTweets,
            signal_count: result.signals.length,
            signals: result.signals,
            tweet_meta: engine.loadCurrentScan()?.tweetMeta || {},
            prompt_hash: engine.getPromptHash(analysts),
            byok: !useManaged,
            reservation_id: reservationId,
            model: engine.getModel(),
          }).then((saveResult) => {
            refreshProfile()
            loadServerHistory()
            // Show remaining credit balance after deduction
            if (useManaged && saveResult?.credits_balance !== undefined) {
              const bal = saveResult.credits_balance
              if (bal <= 0) {
                setNotices(prev => [...prev, { type: 'error', message: 'Credits depleted. Buy more to keep scanning.' }])
              } else if (bal < 500) {
                setNotices(prev => [...prev, { type: 'warning', message: `${bal.toLocaleString()} credits remaining. Consider topping up.` }])
              }
            }
          }).catch(e => console.warn('Failed to save scan to server:', e))
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        engine.clearPendingScan()
        setStatus({ text: 'Scan cancelled', animate: false, showDownload: false })
      } else {
        setStatus(null)
        setNotices(prev => [...prev, { type: 'error', message: e.message }])
      }
    } finally {
      engine.setUseServerApi(false)
      setBusy(false)
      abortRef.current = null
      setCacheSize(Object.keys(engine.loadAnalysisCache().entries || {}).length)
    }
  }, [getAllAccounts, busy, customAccounts, range, analysts, openSettings, fetchPrices, isAuthenticated, profile, refreshProfile, loadServerHistory])

  const cancelScan = useCallback(() => {
    abortRef.current?.abort()
    setBusy(false)
    setStatus(null)
  }, [])

  const resumeScan = useCallback(async () => {
    const pending = engine.loadPendingScan()
    setHasPendingScan(false)
    engine.clearPendingScan()
    // Re-use the already-fetched tweets so we skip straight to analysis
    if (pending?.accountTweets?.length) {
      pendingTweetsRef.current = pending.accountTweets
    }
    await scan()
  }, [scan])

  const dismissResumeBanner = useCallback(() => {
    engine.clearPendingScan()
    setHasPendingScan(false)
  }, [])

  const setFilter = useCallback((category: string | null) => {
    setFilters(prev => ({ ...prev, category: prev.category === category ? null : category }))
  }, [])

  const setTickerFilter = useCallback((ticker: string | null) => {
    setFilters(prev => ({ ...prev, ticker: prev.ticker === ticker ? null : ticker }))
  }, [])

  const deleteHistoryScanHandler = useCallback((index: number) => {
    // Capture entry at current index before any state changes
    setScanHistory(prev => {
      if (index < 0 || index >= prev.length) return prev
      const entry = prev[index]
      // Delete from server if it has a server ID
      if (entry?.id && isAuthenticated) {
        api.deleteScanFromServer(entry.id).catch(e => console.warn('Failed to delete from server:', e))
      }
      // Remove from localStorage
      engine.deleteHistoryScan(index)
      // Remove from state
      return prev.filter((_, i) => i !== index)
    })
  }, [isAuthenticated])

  const refreshHistory = useCallback(() => {
    if (isAuthenticated) {
      loadServerHistory()
    } else {
      setScanHistory(engine.getScanHistory())
    }
  }, [isAuthenticated, loadServerHistory])

  // Load saved scan range on init
  useEffect(() => {
    if (scanResult?.range) {
      const idx = RANGES.findIndex(r => r.label === scanResult.range)
      if (idx !== -1) setRange(idx)
    }
    // Fetch prices for saved scan
    if (scanResult?.signals) {
      const allSymbols = new Set<string>()
      scanResult.signals.forEach(s => (s.tickers || []).forEach(t => {
        const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase()
        if (sym) allSymbols.add(sym)
      }))
      if (allSymbols.size) fetchPrices([...allSymbols])
    }
  }, []) // eslint-disable-line

  // Re-read all display settings from engine/localStorage (avoids page reload)
  const applySettings = useCallback(() => {
    setFinanceProvider(engine.getFinanceProvider())
    setModelState(engine.getModel())
    setFont(engine.getFont())
    setFontSize(engine.getFontSize())
    setShowTickerPrice(engine.getShowTickerPrice())
    setIconSet(engine.getIconSet())
    setLiveEnabledState(engine.isLiveEnabled())
  }, [])

  // ── Scheduled Scans (server-side) ─────────────────────────────────────────
  const [schedules, setSchedules] = useState<ScheduledScan[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [nextScheduleLabel, setNextScheduleLabel] = useState('')

  const loadSchedules = useCallback(async () => {
    if (!isAuthenticated) { setSchedules([]); return }
    setSchedulesLoading(true)
    try {
      const data = await api.getSchedules()
      // Treat "running" scans older than 5 min as timed out (server will reset on next cron)
      const STALE_MS = 5 * 60_000
      const now = Date.now()
      const normalized = (data || []).map(s => {
        if (s.last_run_status === 'running' && s.last_run_at) {
          const elapsed = now - new Date(s.last_run_at).getTime()
          if (elapsed > STALE_MS) {
            return { ...s, last_run_status: 'error' as const, last_run_message: 'Scan timed out' }
          }
        }
        return s
      })
      setSchedules(normalized)
    } catch (e) {
      console.warn('Failed to load schedules:', e)
    } finally {
      setSchedulesLoading(false)
    }
  }, [isAuthenticated])

  // Load schedules when auth state changes
  useEffect(() => { loadSchedules() }, [loadSchedules])

  const addScheduleHandler = useCallback(async (data: { time: string; label: string; range_days: number; preset_id?: string | null; accounts: string[] }) => {
    if (!isAuthenticated) return
    try {
      // Auto-populate accounts from user's current active accounts if none specified
      const accounts = data.accounts?.length ? data.accounts : getAllAccounts()
      if (!accounts.length) {
        console.warn('Cannot create schedule: no accounts. Add accounts or presets first.')
        return
      }
      await api.saveSchedule({
        label: data.label,
        time: data.time,
        range_days: data.range_days,
        preset_id: data.preset_id || null,
        accounts,
        timezone: engine.getBrowserTimezone(),
        days: [],
        enabled: true,
      })
      await loadSchedules()
    } catch (e: any) {
      console.warn('Failed to add schedule:', e.message)
    }
  }, [isAuthenticated, loadSchedules, getAllAccounts])

  const updateScheduleHandler = useCallback(async (id: string, updates: Partial<ScheduledScan>) => {
    if (!isAuthenticated) return
    // Read current schedule from state BEFORE optimistic update (avoids stale closure)
    let fullPayload: Parameters<typeof api.saveSchedule>[0] | null = null
    setSchedules(prev => {
      const schedule = prev.find(s => s.id === id)
      if (schedule) {
        fullPayload = {
          id,
          label: updates.label ?? schedule.label,
          time: updates.time ?? schedule.time,
          timezone: updates.timezone ?? schedule.timezone ?? engine.getBrowserTimezone(),
          days: updates.days ?? schedule.days,
          range_days: updates.range_days ?? schedule.range_days,
          preset_id: updates.preset_id !== undefined ? updates.preset_id : schedule.preset_id,
          accounts: updates.accounts ?? schedule.accounts,
          enabled: updates.enabled !== undefined ? updates.enabled : schedule.enabled,
        }
      }
      return prev.map(s => s.id === id ? { ...s, ...updates } : s)
    })
    if (!fullPayload) return
    try {
      await api.saveSchedule(fullPayload)
      loadSchedules()
    } catch (e: any) {
      console.warn('Failed to update schedule:', e.message)
      loadSchedules() // revert on error
    }
  }, [isAuthenticated, loadSchedules])

  const deleteScheduleHandler = useCallback(async (id: string) => {
    if (!isAuthenticated) return
    // Optimistic update
    setSchedules(prev => prev.filter(s => s.id !== id))
    try {
      await api.deleteScheduleFromServer(id)
    } catch (e: any) {
      console.warn('Failed to delete schedule:', e.message)
      loadSchedules() // revert on error
    }
  }, [isAuthenticated, loadSchedules])

  // Update "next schedule" label
  const updateNextScheduleLabel = useCallback(() => {
    const next = engine.getNextScheduleTime(schedules)
    if (!next) { setNextScheduleLabel(''); return }
    const now = new Date()
    const diffMs = next.date.getTime() - now.getTime()
    const diffMin = Math.round(diffMs / 60000)
    if (diffMin < 1) {
      setNextScheduleLabel('now')
    } else if (diffMin < 60) {
      setNextScheduleLabel(`in ${diffMin}m`)
    } else if (diffMin < 1440) {
      const h = Math.floor(diffMin / 60)
      const m = diffMin % 60
      setNextScheduleLabel(m > 0 ? `in ${h}h ${m}m` : `in ${h}h`)
    } else {
      setNextScheduleLabel(engine.formatScheduleTime(next.schedule.time))
    }
  }, [schedules])

  // ── Polling: detect schedule state changes + update "next" label ─────────
  // Scans run server-side — the UI polls to detect start/completion.
  //   Running scan:     poll every 5s   (pick up completion fast)
  //   Scan due soon:    poll every 15s  (catch the start quickly)
  //   Active schedules: poll every 60s  (background check)
  //   No schedules:     update label every 60s
  const hasRunningSchedule = schedules.some(s => s.last_run_status === 'running')
  const hasActiveSchedules = schedules.some(s => s.enabled)
  const wasRunningRef = useRef(false)

  // When a running scan completes, also refresh history to show the new results
  useEffect(() => {
    if (wasRunningRef.current && !hasRunningSchedule) {
      // Transition: running → not running — scan just completed
      loadServerHistory()
    }
    wasRunningRef.current = hasRunningSchedule
  }, [hasRunningSchedule, loadServerHistory])

  useEffect(() => {
    updateNextScheduleLabel()

    // Compute imminent inside the effect (avoids stale computation)
    const next = engine.getNextScheduleTime(schedules)
    const isScanImminent = next ? (next.date.getTime() - Date.now() < 3 * 60_000) : false

    const pollMs = hasRunningSchedule ? 5_000
      : isScanImminent ? 15_000
      : hasActiveSchedules ? 60_000
      : 60_000

    const interval = setInterval(() => {
      updateNextScheduleLabel()
      if (hasActiveSchedules || hasRunningSchedule) {
        loadSchedules()
      }
    }, pollMs)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        updateNextScheduleLabel()
        loadSchedules()
        loadServerHistory()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [updateNextScheduleLabel, loadSchedules, loadServerHistory, hasRunningSchedule, hasActiveSchedules, schedules])

  // ── Dev: load mock signals ─────────────────────────────────────────────────
  const loadMockSignals = useCallback(() => {
    const now = new Date()
    const mockSignals: Signal[] = [
      {
        title: 'BTC breaks above $100k resistance with strong volume',
        summary: 'Bitcoin surged past the $100,000 level for the first time, driven by institutional inflows and ETF demand. Multiple analysts are raising their year-end targets.',
        category: 'Trade',
        source: 'CryptoCapo_',
        tickers: [
          { symbol: '$BTC', action: 'buy' },
          { symbol: '$ETH', action: 'watch' },
        ],
        tweet_url: 'https://x.com/CryptoCapo_/status/1234567890',
        links: ['https://coindesk.com/bitcoin-100k-breakout'],
        tweet_time: new Date(now.getTime() - 15 * 60000).toISOString(),
      },
      {
        title: 'NVIDIA announces next-gen AI chip, stock gaps up 8%',
        summary: 'NVIDIA unveiled Blackwell Ultra at GTC with 3x inference throughput vs H100. Supply constraints expected through Q3. AMD and custom silicon plays may benefit from overflow demand.',
        category: 'Trade',
        source: 'unusual_whales',
        tickers: [
          { symbol: '$NVDA', action: 'buy' },
          { symbol: '$AMD', action: 'buy' },
          { symbol: '$INTC', action: 'sell' },
        ],
        tweet_url: 'https://x.com/unusual_whales/status/1234567891',
        links: ['https://nvidia.com/gtc', 'https://reuters.com/nvidia-blackwell'],
        tweet_time: new Date(now.getTime() - 45 * 60000).toISOString(),
      },
      {
        title: 'Fed signals potential rate cut in March meeting minutes',
        summary: 'FOMC minutes reveal growing consensus for easing. Bond yields falling, growth stocks rally. Markets pricing in 85% probability of 25bp cut.',
        category: 'Insight',
        source: 'zaborowskigz',
        tickers: [
          { symbol: '$SPY', action: 'watch' },
          { symbol: '$TLT', action: 'buy' },
          { symbol: '$QQQ', action: 'buy' },
        ],
        tweet_url: 'https://x.com/zaborowskigz/status/1234567892',
        links: ['https://federalreserve.gov/minutes'],
        tweet_time: new Date(now.getTime() - 2 * 3600000).toISOString(),
      },
      {
        title: 'Solana DeFi TVL hits new ATH as memecoin season heats up',
        summary: 'Total value locked in Solana DeFi protocols surpassed $20B. Raydium and Jupiter seeing record volumes. New token launches driving network fees to all-time highs.',
        category: 'Insight',
        source: 'DefiIgnas',
        tickers: [
          { symbol: '$SOL', action: 'buy' },
          { symbol: '$RAY', action: 'watch' },
          { symbol: '$JUP', action: 'hold' },
        ],
        tweet_url: 'https://x.com/DefiIgnas/status/1234567893',
        links: ['https://defillama.com/chain/Solana'],
        tweet_time: new Date(now.getTime() - 5 * 3600000).toISOString(),
      },
      {
        title: 'Apple reportedly in talks to acquire AI startup for $6B',
        summary: 'Sources say Apple is negotiating to buy an enterprise AI company to bolster its on-device ML capabilities. Deal could close within weeks.',
        category: 'Trade',
        source: 'gaborGurbacs',
        tickers: [
          { symbol: '$AAPL', action: 'buy' },
          { symbol: '$MSFT', action: 'hold' },
        ],
        tweet_url: 'https://x.com/gaborGurbacs/status/1234567894',
        links: ['https://bloomberg.com/apple-ai-acquisition', 'https://theverge.com/apple-ai-deal'],
        tweet_time: new Date(now.getTime() - 8 * 3600000).toISOString(),
      },
      {
        title: 'New on-chain analytics tool for tracking whale wallets',
        summary: 'Arkham Intelligence launched a new dashboard for real-time whale tracking with alert capabilities. Free tier available with premium features for power users.',
        category: 'Tool',
        source: 'lookonchain',
        tickers: [
          { symbol: '$BTC', action: 'watch' },
          { symbol: '$ETH', action: 'watch' },
        ],
        tweet_url: 'https://x.com/lookonchain/status/1234567895',
        links: ['https://arkham.com/whale-tracker'],
        tweet_time: new Date(now.getTime() - 12 * 3600000).toISOString(),
      },
      {
        title: 'Comprehensive guide to reading order flow in crypto markets',
        summary: 'Detailed thread covering bid/ask imbalances, liquidation clusters, and open interest divergences. Includes examples from recent BTC and ETH price action.',
        category: 'Resource',
        source: 'EmperorBTC',
        tickers: [
          { symbol: '$BTC', action: 'watch' },
        ],
        tweet_url: 'https://x.com/EmperorBTC/status/1234567896',
        links: ['https://medium.com/order-flow-guide'],
        tweet_time: new Date(now.getTime() - 24 * 3600000).toISOString(),
      },
      {
        title: 'TSLA earnings beat expectations, robotaxi timeline moved up',
        summary: 'Tesla reported Q4 earnings above consensus with improved margins. Musk confirmed robotaxi launch in Austin by Q2. Short interest declining rapidly.',
        category: 'Trade',
        source: 'gaborGurbacs',
        tickers: [
          { symbol: '$TSLA', action: 'buy' },
          { symbol: '$UBER', action: 'sell' },
          { symbol: '$LYFT', action: 'sell' },
        ],
        tweet_url: 'https://x.com/gaborGurbacs/status/1234567897',
        links: [],
        tweet_time: new Date(now.getTime() - 30 * 60000).toISOString(),
      },
    ]

    const tweetMeta: Record<string, import('@/lib/types').TweetMeta> = {
      'https://x.com/CryptoCapo_/status/1234567890': {
        text: '🚀 $BTC just broke $100k! This is the moment we\'ve been waiting for. Institutional demand is insane right now.\n\nETF inflows hit $2.4B this week alone. $ETH looking ready to follow.\n\nTargets: $120k by EOY is very realistic.',
        author: 'CryptoCapo_',
        time: new Date(now.getTime() - 15 * 60000).toISOString(),
      },
      'https://x.com/unusual_whales/status/1234567891': {
        text: 'BREAKING: $NVDA announces Blackwell Ultra at GTC\n\n- 3x inference throughput vs H100\n- 2x training performance\n- Available Q2 2025\n\n$AMD also moving on the news. $INTC looking like it\'s falling further behind.\n\nhttps://nvidia.com/gtc',
        author: 'unusual_whales',
        time: new Date(now.getTime() - 45 * 60000).toISOString(),
      },
      'https://x.com/zaborowskigz/status/1234567892': {
        text: 'Just read through the full FOMC minutes.\n\nKey takeaway: "Several participants noted that a reduction in the target range could be appropriate if inflation continued to move down."\n\nThis is as dovish as we\'ve seen in a while. $SPY $QQQ $TLT all responding.\n\nhttps://federalreserve.gov/minutes',
        author: 'zaborowskigz',
        time: new Date(now.getTime() - 2 * 3600000).toISOString(),
      },
      'https://x.com/DefiIgnas/status/1234567893': {
        text: 'Solana DeFi is absolutely cooking 🔥\n\nTVL: $20B+ (new ATH)\nRaydium: $8.2B daily volume\nJupiter: $5.1B daily volume\n\n$SOL ecosystem is pulling ahead. $RAY and $JUP are the picks.\n\nhttps://defillama.com/chain/Solana',
        author: 'DefiIgnas',
        time: new Date(now.getTime() - 5 * 3600000).toISOString(),
      },
      'https://x.com/gaborGurbacs/status/1234567894': {
        text: 'SCOOP: Apple ($AAPL) in advanced talks to acquire an enterprise AI startup for ~$6B.\n\nThis would be Apple\'s largest AI acquisition ever. On-device ML is clearly the priority.\n\n$MSFT has been leading in cloud AI, but Apple is betting on edge computing.\n\nhttps://bloomberg.com/apple-ai-acquisition',
        author: 'gaborGurbacs',
        time: new Date(now.getTime() - 8 * 3600000).toISOString(),
      },
      'https://x.com/lookonchain/status/1234567895': {
        text: 'New tool alert 🛠️\n\nArkham Intelligence just launched a whale tracking dashboard with real-time alerts.\n\nFeatures:\n- Track top 1000 wallets\n- Liquidation alerts\n- Portfolio mirroring\n- Free tier available\n\nhttps://arkham.com/whale-tracker',
        author: 'lookonchain',
        time: new Date(now.getTime() - 12 * 3600000).toISOString(),
      },
      'https://x.com/EmperorBTC/status/1234567896': {
        text: '🧵 Thread: How to read order flow in crypto markets\n\n1/ Order flow is the study of buy/sell pressure in real-time. Here\'s everything you need to know...\n\nCovering: bid/ask imbalances, liquidation clusters, OI divergences, and practical examples from $BTC.\n\nhttps://medium.com/order-flow-guide',
        author: 'EmperorBTC',
        time: new Date(now.getTime() - 24 * 3600000).toISOString(),
      },
      'https://x.com/gaborGurbacs/status/1234567897': {
        text: '$TSLA Q4 Earnings:\n\n✅ EPS: $1.12 vs $0.95 expected\n✅ Revenue: $28.4B vs $27.1B expected\n✅ Margins improved 200bps QoQ\n\nMusk on the call: "Robotaxi launching in Austin by end of Q2"\n\n$UBER and $LYFT selling off hard on the news.',
        author: 'gaborGurbacs',
        time: new Date(now.getTime() - 30 * 60000).toISOString(),
      },
    }

    const mockScanResult: ScanResult = {
      date: now.toISOString(),
      range: '24h',
      days: 1,
      accounts: ['CryptoCapo_', 'unusual_whales', 'zaborowskigz', 'DefiIgnas', 'gaborGurbacs', 'lookonchain', 'EmperorBTC'],
      totalTweets: 42,
      signals: mockSignals,
      tweetMeta,
    }

    setScanResult(mockScanResult)
  }, [])

  const value: SentryStore = {
    theme, toggleTheme,
    customAccounts, loadedPresets, presets,
    addAccount, removeAccount, togglePreset, clearAllAccounts,
    savePreset, deletePreset, togglePresetVisibility,
    recents, addFromRecents, clearRecents: clearRecentsHandler,
    range, setRange, busy, scanResult, status, notices,
    scan, cancelScan, resumeScan, dismissResumeBanner,
    hasPendingScan, pendingScanInfo,
    filters, setFilter, setTickerFilter,
    scanHistory, deleteHistoryScan: deleteHistoryScanHandler, refreshHistory,
    settingsOpen, settingsTab, setSettingsTab, openSettings, closeSettings,
    presetDialogOpen, editingPreset, openPresetDialog, closePresetDialog,
    analysts, activeAnalystId,
    setActiveAnalystId: setActiveAnalystIdHandler,
    saveAnalysts: saveAnalystsHandler,
    createAnalyst, deleteAnalyst: deleteAnalystHandler, duplicateAnalyst,
    financeProvider, font, fontSize, showTickerPrice, iconSet,
    liveEnabled, isLiveMode, toggleLive,
    shareSignal, downloadScan, isSharedView, sharedSignal,
    exportData: exportDataFn, importBackup, clearCache, cacheSize,
    priceCache: engine.priceCache, fetchPrices,
    onboardingDone, completeOnboarding, resetOnboarding,
    // V3: Auth-related UI state
    authDialogOpen, setAuthDialogOpen,
    authDialogTab,
    pricingOpen, setPricingOpen,
    model,
    applySettings,
    // Scheduled scans (server-side)
    schedules,
    schedulesLoading,
    addSchedule: addScheduleHandler,
    updateSchedule: updateScheduleHandler,
    deleteSchedule: deleteScheduleHandler,
    refreshSchedules: loadSchedules,
    nextScheduleLabel,
    loadMockSignals,
  }

  return <SentryContext.Provider value={value}>{children}</SentryContext.Provider>
}
