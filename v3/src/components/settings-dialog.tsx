import { useState, useEffect } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { useAuth } from '@/hooks/use-auth'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import * as engine from '@/lib/engine'
import { DEFAULT_PROMPT } from '@/lib/constants'
import { Trash2, Copy, Check, ChevronDown, ChevronRight, ExternalLink, ClipboardPaste, Download, Settings, Loader2, Clock, Plus, X, CalendarClock } from '@/components/icons'
import { RANGES } from '@/lib/constants'
import type { ScheduledScan } from '@/lib/types'

export function SettingsDialog() {
  const {
    settingsOpen, settingsTab, setSettingsTab, closeSettings,
    analysts, activeAnalystId, setActiveAnalystId, saveAnalysts,
    createAnalyst, deleteAnalyst, duplicateAnalyst,
    financeProvider, font, fontSize, showTickerPrice, iconSet,
    liveEnabled,
    exportData, importBackup, clearCache, cacheSize,
    resetOnboarding,
    pricingOpen, setPricingOpen,
    authDialogOpen, setAuthDialogOpen,
    applySettings,
    schedules,
    addSchedule: addScheduleAction,
    updateSchedule: updateScheduleAction,
    deleteSchedule: deleteScheduleAction,
  } = useSentry()

  const { isAuthenticated, user, profile, signOut } = useAuth()

  const [twKey, setTwKey] = useState('')
  const [anKey, setAnKey] = useState('')
  const [model, setModel] = useState(() => engine.getModel())
  const [expandedAnalyst, setExpandedAnalyst] = useState<string | null>(null)
  const [localFinance, setLocalFinance] = useState(financeProvider)
  const [localFont, setLocalFont] = useState(font)
  const [localFontSize, setLocalFontSize] = useState(fontSize)
  const [localLiveEnabled, setLocalLiveEnabled] = useState(liveEnabled)
  const [localShowTickerPrice, setLocalShowTickerPrice] = useState(showTickerPrice)
  const [localIconSet, setLocalIconSet] = useState(iconSet)

  useEffect(() => {
    if (settingsOpen) {
      setTwKey(engine.getTwKey())
      setAnKey(engine.getAnKey())
      setModel(engine.getModel())
      setLocalFinance(engine.getFinanceProvider())
      setLocalFont(engine.getFont())
      setLocalFontSize(engine.getFontSize())
      setLocalLiveEnabled(engine.isLiveEnabled())
      setLocalShowTickerPrice(engine.getShowTickerPrice())
      setLocalIconSet(engine.getIconSet())
    }
  }, [settingsOpen])

  const handleSave = () => {
    if (twKey.trim()) localStorage.setItem('signal_twitter_key', twKey.trim())
    if (anKey.trim()) localStorage.setItem('signal_anthropic_key', anKey.trim())
    localStorage.setItem('signal_model', model)
    localStorage.setItem('signal_finance_provider', localFinance)
    engine.setFont(localFont)
    engine.setFontSize(localFontSize)
    engine.setLiveEnabled(localLiveEnabled)
    engine.setShowTickerPrice(localShowTickerPrice)
    engine.setIconSet(localIconSet)
    closeSettings()
    applySettings()
  }

  const handleClearKeys = () => {
    if (!confirm('Remove all API keys? You will need to re-enter them.')) return
    localStorage.removeItem('signal_twitter_key')
    localStorage.removeItem('signal_anthropic_key')
    setTwKey('')
    setAnKey('')
  }

  const [exportStatus, setExportStatus] = useState<'idle' | 'copied'>('idle')
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleExport = async () => {
    const encoded = await exportData()
    await navigator.clipboard.writeText(encoded)
    setExportStatus('copied')
    setTimeout(() => setExportStatus('idle'), 1500)
  }

  const handleImport = async () => {
    try {
      const encoded = await navigator.clipboard.readText()
      importBackup(encoded.trim())
      setImportStatus('success')
      setTimeout(() => {
        closeSettings()
        applySettings()
      }, 500)
    } catch {
      setImportStatus('error')
      setTimeout(() => setImportStatus('idle'), 2000)
    }
  }

  const handleAnalystPromptChange = (id: string, prompt: string) => {
    const updated = analysts.map(a => a.id === id ? { ...a, prompt } : a)
    saveAnalysts(updated)
  }

  const handleAnalystNameChange = (id: string, name: string) => {
    const updated = analysts.map(a => a.id === id ? { ...a, name } : a)
    saveAnalysts(updated)
  }

  const handleSignOut = async () => {
    await signOut()
    closeSettings()
  }

  // Determine if user has credits — they use server-side API keys
  const hasCredits = isAuthenticated && (profile?.credits_balance || 0) > 0

  const statusLabel = hasCredits
    ? `${(profile?.credits_balance || 0).toLocaleString()} credits`
    : 'Free (BYOK)'

  const statusColor = hasCredits
    ? 'text-signal-green bg-signal-green-bg'
    : 'text-muted-foreground bg-muted'

  return (
    <Sheet open={settingsOpen} onOpenChange={(open) => { if (!open) closeSettings() }}>
      <SheetContent side="right" className="sm:max-w-[29rem] w-full">
        <div className="px-6 pt-6 pb-4 shrink-0">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>
              {isAuthenticated ? user?.email : 'Configure your API keys, analysts, and preferences.'}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          <Tabs value={settingsTab} onValueChange={setSettingsTab} className="h-full">
            <div className="sticky top-0 bg-background pb-4 -mx-6 px-6 z-10 overflow-x-auto scrollbar-hide">
              <TabsList className="inline-flex w-auto min-w-full">
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="api">API</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
                <TabsTrigger value="analyst">Analyst</TabsTrigger>
                <TabsTrigger value="display">Display</TabsTrigger>
                <TabsTrigger value="data">Data</TabsTrigger>
              </TabsList>
            </div>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-4 pb-4">
            {isAuthenticated ? (
              <>
                {/* Credits & Status */}
                <div className="p-4 rounded-lg border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant="outline" className={statusColor}>
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">API keys</span>
                    <span className="text-sm font-medium">
                      {hasCredits ? 'Managed (included)' : 'Bring your own'}
                    </span>
                  </div>
                  {profile?.subscription_status === 'active' && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Auto-refill</span>
                      <Badge variant="outline" className="text-signal-green bg-signal-green-bg">Active</Badge>
                    </div>
                  )}
                </div>

                {/* Buy credits / Manage */}
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => { closeSettings(); setPricingOpen(true) }}
                >
                  <span className="flex-1 text-left">
                    {hasCredits ? 'Buy more credits' : 'Buy credits'}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>

                <Separator />

                {/* Sign out */}
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={handleSignOut}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Sign in to unlock more</h3>
                  <p className="text-sm text-muted-foreground">
                    Sync your data across devices, get managed API keys, and access premium features.
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => { closeSettings(); setAuthDialogOpen(true) }}
                >
                  Sign in
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { closeSettings(); setPricingOpen(true) }}
                >
                  Buy credits
                </Button>
              </div>
            )}
          </TabsContent>

          {/* API Tab */}
          <TabsContent value="api" className="space-y-4 pb-4">
            {hasCredits && (
              <div className="p-3 rounded-lg bg-accent/50 border space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-signal-green" />
                  <span className="text-sm font-medium">Managed API keys active</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Scans use our platform keys by default. Add your own keys below to use them instead — your credits won't be consumed.
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              API keys are stored locally in your browser — never sent to our servers.
            </p>

            <div className="space-y-2">
              <Label>X/Twitter API key</Label>
              <Input
                type="password"
                value={twKey}
                onChange={e => setTwKey(e.target.value)}
                placeholder="Your twitterapi.io key"
              />
              <p className="text-sm text-muted-foreground">
                Get one at{' '}
                <a href="https://twitterapi.io" target="_blank" className="underline">twitterapi.io</a>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Anthropic API key</Label>
              <Input
                type="password"
                value={anKey}
                onChange={e => setAnKey(e.target.value)}
                placeholder="sk-ant-..."
              />
              <p className="text-sm text-muted-foreground">
                Get one at{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" className="underline">console.anthropic.com</a>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                  <SelectItem value="claude-3-5-sonnet-20241022">Claude Sonnet 3.5 v2</SelectItem>
                  <SelectItem value="claude-3-5-haiku-20241022">Claude Haiku 3.5</SelectItem>
                  <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{engine.formatModelCost(model)}</p>
            </div>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-4 pb-4">
            {!isAuthenticated ? (
              <div className="p-4 rounded-lg border border-dashed text-center space-y-3">
                <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Sign in to set up scheduled scans</p>
                <Button size="sm" onClick={() => { closeSettings(); setAuthDialogOpen(true) }}>
                  Sign in
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Set recurring scans so results are ready when you need them.
                  </p>
                </div>

                {schedules.length === 0 && (
                  <div className="p-4 rounded-lg border border-dashed text-center space-y-3">
                    <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No scheduled scans yet</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '07:00', label: 'Morning', range_days: 1, accounts: [] })}>
                        + Morning (7am)
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '12:00', label: 'Midday', range_days: 1, accounts: [] })}>
                        + Midday (12pm)
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '18:00', label: 'Evening', range_days: 1, accounts: [] })}>
                        + Evening (6pm)
                      </Button>
                    </div>
                  </div>
                )}

                {schedules.map(schedule => {
                  const lastRunDate = schedule.last_run_at ? new Date(schedule.last_run_at) : null
                  const lastRunStr = lastRunDate
                    ? lastRunDate.toLocaleDateString() + ' ' + lastRunDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                    : null
                  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

                  return (
                    <div key={schedule.id} className="border rounded-lg">
                      {/* Header row */}
                      <div className="flex items-center gap-3 p-3">
                        <Switch
                          checked={schedule.enabled}
                          onCheckedChange={(checked) => updateScheduleAction(schedule.id, { enabled: checked })}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", !schedule.enabled && "text-muted-foreground")}>
                              {schedule.label}
                            </span>
                            <span className={cn("text-sm", !schedule.enabled ? "text-muted-foreground/60" : "text-muted-foreground")}>
                              {engine.formatScheduleTime(schedule.time)}
                            </span>
                            {schedule.last_run_status === 'running' && (
                              <Loader2 className="h-3 w-3 animate-spin text-signal-blue" />
                            )}
                          </div>
                          {lastRunStr && (
                            <p className="text-xs text-muted-foreground/70 mt-0.5">
                              Last: {lastRunStr}
                              {schedule.last_run_status === 'error' && (
                                <span className="text-destructive ml-1" title={schedule.last_run_message || ''}>· failed</span>
                              )}
                              {schedule.last_run_status === 'success' && <span className="text-signal-green ml-1">· ok</span>}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteScheduleAction(schedule.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* Settings row */}
                      <div className="px-3 pb-3 space-y-3">
                        <Separator />
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Time</Label>
                            <Input
                              type="time"
                              value={schedule.time}
                              onChange={e => updateScheduleAction(schedule.id, { time: e.target.value })}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Range</Label>
                            <Select
                              value={String(schedule.range_days)}
                              onValueChange={v => updateScheduleAction(schedule.id, { range_days: Number(v) })}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {RANGES.map(r => (
                                  <SelectItem key={r.days} value={String(r.days)}>{r.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Days</Label>
                          <div className="flex gap-1">
                            {DAY_LABELS.map((day, i) => {
                              const isActive = schedule.days.length === 0 || schedule.days.includes(i)
                              const isAllDays = schedule.days.length === 0
                              return (
                                <button
                                  key={day}
                                  className={cn(
                                    "flex-1 py-1 text-xs rounded-md transition-all font-medium",
                                    isActive
                                      ? isAllDays
                                        ? "bg-primary/10 text-primary"
                                        : "bg-primary text-primary-foreground"
                                      : "bg-muted text-muted-foreground/50 hover:text-muted-foreground"
                                  )}
                                  onClick={() => {
                                    let newDays: number[]
                                    if (schedule.days.length === 0) {
                                      newDays = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== i)
                                    } else if (schedule.days.includes(i)) {
                                      newDays = schedule.days.filter(d => d !== i)
                                      if (newDays.length === 0) newDays = []
                                    } else {
                                      newDays = [...schedule.days, i].sort()
                                      if (newDays.length === 7) newDays = []
                                    }
                                    updateScheduleAction(schedule.id, { days: newDays })
                                  }}
                                >
                                  {day}
                                </button>
                              )
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground/70">
                            {schedule.days.length === 0 ? 'Every day' : schedule.days.map(d => DAY_LABELS[d]).join(', ')}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Label</Label>
                          <Input
                            value={schedule.label}
                            onChange={e => updateScheduleAction(schedule.id, { label: e.target.value })}
                            placeholder="Schedule name"
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}

                {schedules.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '07:00', label: 'Morning', range_days: 1, accounts: [] })}>
                        <Plus className="h-3 w-3 mr-1" />Morning
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '12:00', label: 'Midday', range_days: 1, accounts: [] })}>
                        <Plus className="h-3 w-3 mr-1" />Midday
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '18:00', label: 'Evening', range_days: 1, accounts: [] })}>
                        <Plus className="h-3 w-3 mr-1" />Evening
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '09:00', label: 'Custom', range_days: 1, accounts: [] })}>
                        <Plus className="h-3 w-3 mr-1" />Custom
                      </Button>
                    </div>

                    <div className="p-3 rounded-lg bg-accent/50 border">
                      <p className="text-xs text-muted-foreground">
                        <strong className="font-medium text-foreground/80">How it works:</strong>{' '}
                        Scans run automatically on our servers at scheduled times — no need to keep your browser open.
                        Results will be waiting when you open Sentry. Uses your currently active accounts and presets.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* Analyst Tab */}
          <TabsContent value="analyst" className="space-y-4 pb-4">
            {analysts.map(a => (
              <div key={a.id} className="border rounded-lg">
                <div
                  className="flex items-center gap-2 p-3 cursor-pointer"
                  onClick={() => setExpandedAnalyst(expandedAnalyst === a.id ? null : a.id)}
                >
                  {expandedAnalyst === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm font-normal flex-1">{a.name}</span>
                  {activeAnalystId === a.id ? (
                    <Badge variant="default" className="text-sm">Active</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 text-sm" onClick={(e) => { e.stopPropagation(); setActiveAnalystId(a.id) }}>
                      Use
                    </Button>
                  )}
                </div>
                {expandedAnalyst === a.id && (
                  <div className="px-3 pb-3 space-y-3">
                    <Separator />
                    {!a.isDefault && (
                      <Input
                        value={a.name}
                        onChange={e => handleAnalystNameChange(a.id, e.target.value)}
                        placeholder="Analyst name"
                        className="h-9"
                      />
                    )}
                    <Textarea
                      value={a.prompt}
                      onChange={e => handleAnalystPromptChange(a.id, e.target.value)}
                      className="min-h-[200px] text-sm"
                    />
                    <div className="flex gap-2">
                      {a.isDefault && (
                        <Button variant="outline" size="sm" onClick={() => handleAnalystPromptChange(a.id, DEFAULT_PROMPT)}>
                          Reset
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => duplicateAnalyst(a.id)}>
                        <Copy className="h-3 w-3 mr-1" />Duplicate
                      </Button>
                      {!a.isDefault && (
                        <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete analyst "${a.name}"?`)) deleteAnalyst(a.id) }}>
                          <Trash2 className="h-3 w-3 mr-1" />Delete
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={() => createAnalyst('New Analyst', DEFAULT_PROMPT)}>
              + New Analyst
            </Button>
          </TabsContent>

          {/* Display Tab */}
          <TabsContent value="display" className="space-y-4 pb-4">
            <div className="space-y-2">
              <Label>Charts</Label>
              <Select value={localFinance} onValueChange={setLocalFinance}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tradingview">TradingView</SelectItem>
                  <SelectItem value="yahoo">Yahoo Finance</SelectItem>
                  <SelectItem value="google">Google Finance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Font</Label>
              <Select value={localFont} onValueChange={setLocalFont}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="geist">Geist</SelectItem>
                  <SelectItem value="mono">Monospace</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Font size</Label>
              <Select value={localFontSize} onValueChange={setLocalFontSize}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="xsmall">Extra Small</SelectItem>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                  <SelectItem value="xlarge">Extra Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Icons</Label>
              <Select value={localIconSet} onValueChange={setLocalIconSet}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sf">SF Symbols</SelectItem>
                  <SelectItem value="geist">Geist</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ticker price</Label>
              <div className="flex items-center gap-3">
                <Switch checked={localShowTickerPrice} onCheckedChange={setLocalShowTickerPrice} />
                <span className="text-sm text-muted-foreground">
                  Show price next to ticker symbols
                </span>
              </div>
            </div>
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data" className="space-y-4 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Live feed</Label>
                <Badge variant="outline" className="text-sm">beta</Badge>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={localLiveEnabled} onCheckedChange={setLocalLiveEnabled} />
                <span className="text-sm text-muted-foreground">
                  Passively monitor accounts for new posts. Uses ~3× more API credits.
                </span>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Backup</Label>
              <p className="text-sm text-muted-foreground">Export copies your settings to clipboard. Import reads from clipboard.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport}>
                  {exportStatus === 'copied' ? (
                    <><Check className="h-3 w-3 mr-1" />Copied</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" />Export</>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={handleImport}>
                  {importStatus === 'success' ? (
                    <><Check className="h-3 w-3 mr-1 text-signal-green" />Imported</>
                  ) : importStatus === 'error' ? (
                    <>Clipboard error</>
                  ) : (
                    <><ClipboardPaste className="h-3 w-3 mr-1" />Import</>
                  )}
                </Button>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Cache</Label>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => { if (confirm('Clear all cached analysis results?')) clearCache() }}>Clear cache</Button>
                <span className="text-sm text-muted-foreground">{cacheSize} entries</span>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Onboarding</Label>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => { resetOnboarding(); closeSettings(); }}>
                  Restart onboarding
                </Button>
                <span className="text-sm text-muted-foreground">
                  Show the welcome wizard again.
                </span>
              </div>
            </div>
          </TabsContent>
          </Tabs>
        </div>

        {/* Save/Cancel — only show for tabs that need explicit save */}
        {settingsTab !== 'account' && settingsTab !== 'schedule' && (
          <div className="px-6 pb-6 pt-4 shrink-0 border-t">
            <div className="flex flex-wrap gap-2 justify-end">
              {settingsTab === 'api' && (
                <Button variant="destructive" size="sm" onClick={handleClearKeys} className="mr-auto">
                  Clear keys
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={closeSettings}>Cancel</Button>
              <Button size="sm" onClick={handleSave}>Save</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
