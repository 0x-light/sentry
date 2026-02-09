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
    presets, customAccounts,
  } = useSentry()

  const { isAuthenticated, user, profile, signOut } = useAuth()

  const [twKey, setTwKey] = useState('')
  const [anKey, setAnKey] = useState('')
  const [model, setModel] = useState(() => engine.getModel())
  const [expandedAnalyst, setExpandedAnalyst] = useState<string | null>(null)
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null)
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
      <SheetContent side="right" className="settings-dialog sm:max-w-[29rem] w-full">
        <div className="settings-header px-6 pt-6 pb-4 shrink-0">
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
          <TabsContent value="account" className="settings-account space-y-4 pb-4">
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
          <TabsContent value="api" className="settings-api space-y-4 pb-4">
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
              API keys are stored securely on your device — they're never shared.
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
          <TabsContent value="schedule" className="settings-schedule space-y-3 pb-4">
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
                {schedules.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed text-center space-y-3">
                    <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Schedule scans and results will be ready when you open the app.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '07:00', label: 'Morning', range_days: 1, accounts: [] })}>
                        + 7 am
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '12:00', label: 'Midday', range_days: 1, accounts: [] })}>
                        + 12 pm
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addScheduleAction({ time: '18:00', label: 'Evening', range_days: 1, accounts: [] })}>
                        + 6 pm
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {schedules.map(schedule => {
                      const isExpanded = expandedSchedule === schedule.id
                      const lastRunDate = schedule.last_run_at ? new Date(schedule.last_run_at) : null
                      const lastRunStr = lastRunDate
                        ? lastRunDate.toLocaleDateString() + ' ' + lastRunDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        : null
                      const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
                      const DAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                      const daysLabel = schedule.days.length === 0
                        ? 'Every day'
                        : schedule.days.length === 5 && !schedule.days.includes(0) && !schedule.days.includes(6)
                          ? 'Weekdays'
                          : schedule.days.map(d => DAY_FULL[d]).join(', ')

                      // Derive which presets are "selected" based on the schedule's accounts
                      const schedAccounts = new Set(schedule.accounts || [])
                      const visiblePresets = presets.filter(p => !p.hidden && p.accounts.length > 0)
                      const selectedPresets = visiblePresets.filter(p => p.accounts.every(a => schedAccounts.has(a)))
                      const accountCount = schedule.accounts?.length || 0
                      const listsLabel = selectedPresets.length
                        ? selectedPresets.map(p => p.name).join(', ')
                        : accountCount > 0 ? `${accountCount} accounts` : 'No accounts'

                      return (
                        <div key={schedule.id} className="schedule-item border rounded-lg">
                          {/* Collapsed header — always visible */}
                          <div
                            className="schedule-header flex items-center gap-2.5 p-3 cursor-pointer"
                            onClick={() => setExpandedSchedule(isExpanded ? null : schedule.id)}
                          >
                            <Switch
                              checked={schedule.enabled}
                              onCheckedChange={(checked) => { updateScheduleAction(schedule.id, { enabled: checked }) }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-sm font-medium truncate", !schedule.enabled && "text-muted-foreground")}>
                                  {schedule.label}
                                </span>
                                <span className={cn("text-sm tabular-nums shrink-0", !schedule.enabled ? "text-muted-foreground/50" : "text-muted-foreground")}>
                                  {engine.formatScheduleTime(schedule.time)}
                                </span>
                                {schedule.last_run_status === 'running' && (
                                  <Loader2 className="h-3 w-3 animate-spin text-signal-blue shrink-0" />
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                <span className="text-xs text-muted-foreground/60 truncate shrink-0">{daysLabel}</span>
                                <span className="text-xs text-muted-foreground/40">·</span>
                                <span className="text-xs text-muted-foreground/60 truncate">{listsLabel}</span>
                                {lastRunStr && (
                                  <>
                                    <span className="text-xs text-muted-foreground/40">·</span>
                                    <span className="text-xs text-muted-foreground/60">
                                      {lastRunStr}
                                      {schedule.last_run_status === 'error' && (
                                        <span className="text-destructive ml-0.5" title={schedule.last_run_message || ''}>✕</span>
                                      )}
                                      {schedule.last_run_status === 'success' && <span className="text-signal-green ml-0.5">✓</span>}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          </div>

                          {/* Expanded settings */}
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-3">
                              <Separator />
                              <div className="flex flex-wrap gap-2">
                                <div className="space-y-1 flex-1 min-w-[120px]">
                                  <Label className="text-xs text-muted-foreground">Time</Label>
                                  <Input
                                    type="time"
                                    value={schedule.time}
                                    onChange={e => updateScheduleAction(schedule.id, { time: e.target.value })}
                                    className="h-8 text-sm min-w-0 [&::-webkit-datetime-edit]:text-sm"
                                  />
                                </div>
                                <div className="space-y-1 flex-1 min-w-[120px]">
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
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Days</Label>
                                <div className="flex gap-0.5">
                                  {DAY_LABELS.map((day, i) => {
                                    const isActive = schedule.days.length === 0 || schedule.days.includes(i)
                                    const isAllDays = schedule.days.length === 0
                                    return (
                                      <button
                                        key={i}
                                        className={cn(
                                          "flex-1 py-1.5 text-xs rounded-md transition-all font-medium",
                                          isActive
                                            ? isAllDays
                                              ? "bg-primary/10 text-primary"
                                              : "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground/40 hover:text-muted-foreground"
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
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Lists</Label>
                                {visiblePresets.length === 0 ? (
                                  <p className="text-xs text-muted-foreground/60">No lists yet — create one from the main screen.</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {visiblePresets.map(preset => {
                                      const isSelected = preset.accounts.every(a => schedAccounts.has(a))
                                      return (
                                        <button
                                          key={preset.name}
                                          className={cn(
                                            "px-2.5 py-1 text-xs rounded-md transition-all font-medium",
                                            isSelected
                                              ? "bg-primary text-primary-foreground"
                                              : "bg-muted text-muted-foreground/60 hover:text-muted-foreground"
                                          )}
                                          onClick={() => {
                                            let next: string[]
                                            if (isSelected) {
                                              // Remove this preset's accounts (keep accounts that belong to other selected presets)
                                              const otherAccounts = new Set<string>()
                                              visiblePresets.forEach(p => {
                                                if (p.name !== preset.name && p.accounts.every(a => schedAccounts.has(a))) {
                                                  p.accounts.forEach(a => otherAccounts.add(a))
                                                }
                                              })
                                              next = schedule.accounts.filter(a => otherAccounts.has(a))
                                            } else {
                                              // Add this preset's accounts
                                              next = [...new Set([...schedule.accounts, ...preset.accounts])]
                                            }
                                            updateScheduleAction(schedule.id, { accounts: next })
                                          }}
                                        >
                                          {preset.name}
                                          <span className="ml-1 opacity-50">{preset.accounts.length}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {accountCount > 0 && (
                                  <p className="text-xs text-muted-foreground/50">{accountCount} account{accountCount !== 1 ? 's' : ''} total</p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Label</Label>
                                <Input
                                  value={schedule.label}
                                  onChange={e => updateScheduleAction(schedule.id, { label: e.target.value })}
                                  placeholder="Schedule name"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive w-full"
                                onClick={() => deleteScheduleAction(schedule.id)}
                              >
                                <Trash2 className="h-3 w-3 mr-1.5" />Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => addScheduleAction({ time: '09:00', label: 'New scan', range_days: 1, accounts: [] })}
                    >
                      <Plus className="h-3 w-3 mr-1.5" />Add schedule
                    </Button>
                  </>
                )}

                <p className="text-xs text-muted-foreground/60 text-center">
                  Runs in the background — no need to keep the app open.
                </p>
              </>
            )}
          </TabsContent>

          {/* Analyst Tab */}
          <TabsContent value="analyst" className="settings-analyst space-y-4 pb-4">
            {analysts.map(a => (
              <div key={a.id} className="analyst-item border rounded-lg">
                <div
                  className="analyst-header flex items-center gap-2 p-3 cursor-pointer"
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
          <TabsContent value="display" className="settings-display space-y-4 pb-4">
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
          <TabsContent value="data" className="settings-data space-y-4 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Live feed</Label>
                <Badge variant="outline" className="text-xs">beta</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Passively monitor accounts for new posts. Uses ~3× more API credits.
                </span>
                <Switch checked={localLiveEnabled} onCheckedChange={setLocalLiveEnabled} className="shrink-0" />
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
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label>Cache</Label>
                <p className="text-sm text-muted-foreground">{cacheSize} entries</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { if (confirm('Clear all cached analysis results?')) clearCache() }}>Clear cache</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label>Onboarding</Label>
                <p className="text-sm text-muted-foreground">Show the welcome wizard again.</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => { resetOnboarding(); closeSettings(); }}>
                Restart
              </Button>
            </div>
          </TabsContent>
          </Tabs>
        </div>

        {/* Save/Cancel — only show for tabs that need explicit save */}
        {settingsTab !== 'account' && settingsTab !== 'schedule' && (
          <div className="settings-footer px-6 py-4 shrink-0 border-t">
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
