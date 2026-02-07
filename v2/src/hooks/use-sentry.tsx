import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Signal, Analyst, ScanResult, ScanHistoryEntry, Preset } from '@/lib/types'
import { RANGES } from '@/lib/constants'
import * as engine from '@/lib/engine'

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
  filters: { category: string | null };
  setFilter: (category: string | null) => void;

  // History
  scanHistory: ScanHistoryEntry[];
  deleteHistoryScan: (index: number) => void;
  refreshHistory: () => void;

  // Settings
  settingsOpen: boolean;
  settingsTab: string;
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
  textCase: string;
  showTickerPrice: boolean;

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
}

const SentryContext = createContext<SentryStore | null>(null)

export function useSentry(): SentryStore {
  const ctx = useContext(SentryContext)
  if (!ctx) throw new Error('useSentry must be used within SentryProvider')
  return ctx
}

export function SentryProvider({ children }: { children: React.ReactNode }) {
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
      return next
    })
  }, [])

  const removeAccount = useCallback((account: string) => {
    setCustomAccounts(prev => {
      const next = prev.filter(a => a !== account)
      engine.saveAccounts(next)
      return next
    })
  }, [])

  const togglePreset = useCallback((name: string) => {
    setLoadedPresets(prev => {
      const next = prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
      engine.saveLoadedPresets(next)
      return next
    })
  }, [])

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
    if (editingName) p = p.filter(x => x.name !== editingName)
    p = p.filter(x => x.name !== name)
    p.push({ name, accounts })
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

  // Scanning
  const [range, setRange] = useState(0)
  const [busy, setBusy] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(() => engine.loadCurrentScan())
  const [status, setStatus] = useState<Status | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [filters, setFilters] = useState<{ category: string | null }>({ category: null })
  const [scanHistory, setScanHistory] = useState(() => engine.getScanHistory())
  const abortRef = useRef<AbortController | null>(null)

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
  const [font, setFont] = useState(() => engine.getFont())
  const [fontSize, setFontSize] = useState(() => engine.getFontSize())
  const [textCase, setTextCase] = useState(() => engine.getCase())
  const [showTickerPrice, setShowTickerPrice] = useState(() => engine.getShowTickerPrice())

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('api')
  const openSettings = useCallback((tab?: string) => {
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

  // Live feed
  const [liveEnabled, setLiveEnabledState] = useState(() => engine.isLiveEnabled())
  const [isLiveMode, setIsLiveMode] = useState(false)
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seenTweetUrlsRef = useRef(new Set<string>())

  const toggleLive = useCallback(() => {
    if (!liveEnabled) { openSettings('data'); return; }
    if (isLiveMode) {
      setIsLiveMode(false)
      if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
    } else {
      if (!engine.bothKeys()) { openSettings('api'); return; }
      setIsLiveMode(true)
      // Initialize seen tweets
      if (scanResult?.rawTweets) {
        scanResult.rawTweets.forEach(a => a.tweets.forEach(tw => seenTweetUrlsRef.current.add(engine.getTweetUrl(tw))))
      }
    }
  }, [liveEnabled, isLiveMode, scanResult, openSettings])

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
    await navigator.clipboard.writeText(url)
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
    const data = engine.importData(encoded)
    if (!data.v && !data.version) throw new Error('Invalid backup format')
    if (data.settings) {
      if (data.settings.theme) { engine.setTheme(data.settings.theme); setThemeState(data.settings.theme); }
      if (data.settings.font) { engine.setFont(data.settings.font); setFont(data.settings.font); }
      if (data.settings.fontSize) { engine.setFontSize(data.settings.fontSize); setFontSize(data.settings.fontSize); }
      if (data.settings.financeProvider) localStorage.setItem('signal_finance_provider', data.settings.financeProvider)
      if (data.settings.model) localStorage.setItem('signal_model', data.settings.model)
    }
    if (data.analysts) { engine.saveAnalysts(data.analysts); setAnalysts(data.analysts); }
    if (data.activeAnalyst) { engine.setActiveAnalystId(data.activeAnalyst); setActiveAnalystIdState(data.activeAnalyst); }
    if (data.keys?.twitter) localStorage.setItem('signal_twitter_key', data.keys.twitter)
    if (data.keys?.anthropic) localStorage.setItem('signal_anthropic_key', data.keys.anthropic)
    if (data.presets) { engine.savePresetsData(data.presets); setPresets(data.presets); }
    if (data.accounts) { engine.saveAccounts(data.accounts); setCustomAccounts(data.accounts); }
    if (data.loadedPresets) { engine.saveLoadedPresets(data.loadedPresets); setLoadedPresets(data.loadedPresets); }
    if (data.recents) { localStorage.setItem('signal_recent_accounts', JSON.stringify(data.recents)); setRecents(data.recents); }
  }, [])

  // Scan
  const scan = useCallback(async () => {
    const accounts = getAllAccounts()
    if (!accounts.length || busy) return
    if (!engine.bothKeys()) { openSettings('api'); return; }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setBusy(true)
    setNotices([])
    setStatus({ text: '', animate: true, showDownload: false })
    setFilters({ category: null })

    if (customAccounts.length) {
      engine.addToRecents(customAccounts)
      setRecents(engine.getRecents())
    }

    const days = RANGES[range].days
    try {
      const result = await engine.runScan(
        accounts, days, abortRef.current.signal,
        (text, animate) => setStatus({ text, animate: !!animate, showDownload: false }),
        (type, msg) => setNotices(prev => [...prev, { type, message: msg }]),
        analysts
      )

      if (result) {
        result.range = RANGES[range].label
        engine.saveScan(result)
        setScanResult(result)
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
      setBusy(false)
      abortRef.current = null
      setCacheSize(Object.keys(engine.loadAnalysisCache().entries || {}).length)
    }
  }, [getAllAccounts, busy, customAccounts, range, analysts, openSettings, fetchPrices])

  const cancelScan = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const resumeScan = useCallback(async () => {
    // Simplified resume - just re-run the scan
    setHasPendingScan(false)
    engine.clearPendingScan()
    await scan()
  }, [scan])

  const dismissResumeBanner = useCallback(() => {
    engine.clearPendingScan()
    setHasPendingScan(false)
  }, [])

  const setFilter = useCallback((category: string | null) => {
    setFilters(prev => ({ category: prev.category === category ? null : category }))
  }, [])

  const deleteHistoryScanHandler = useCallback((index: number) => {
    engine.deleteHistoryScan(index)
    setScanHistory(engine.getScanHistory())
  }, [])

  const refreshHistory = useCallback(() => {
    setScanHistory(engine.getScanHistory())
  }, [])

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

  const value: SentryStore = {
    theme, toggleTheme,
    customAccounts, loadedPresets, presets,
    addAccount, removeAccount, togglePreset, clearAllAccounts,
    savePreset, deletePreset,
    recents, addFromRecents, clearRecents: clearRecentsHandler,
    range, setRange, busy, scanResult, status, notices,
    scan, cancelScan, resumeScan, dismissResumeBanner,
    hasPendingScan, pendingScanInfo,
    filters, setFilter,
    scanHistory, deleteHistoryScan: deleteHistoryScanHandler, refreshHistory,
    settingsOpen, settingsTab, openSettings, closeSettings,
    presetDialogOpen, editingPreset, openPresetDialog, closePresetDialog,
    analysts, activeAnalystId,
    setActiveAnalystId: setActiveAnalystIdHandler,
    saveAnalysts: saveAnalystsHandler,
    createAnalyst, deleteAnalyst: deleteAnalystHandler, duplicateAnalyst,
    financeProvider, font, fontSize, textCase, showTickerPrice,
    liveEnabled, isLiveMode, toggleLive,
    shareSignal, downloadScan, isSharedView, sharedSignal,
    exportData: exportDataFn, importBackup, clearCache, cacheSize,
    priceCache: engine.priceCache, fetchPrices,
  }

  return <SentryContext.Provider value={value}>{children}</SentryContext.Provider>
}
