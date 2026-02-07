import { useState, useEffect } from 'react'
import { useSentry } from '@/hooks/use-sentry'
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
import { Trash2, Copy, Check, ChevronDown, ChevronRight, ExternalLink, ClipboardPaste, Download } from 'lucide-react'

export function SettingsDialog() {
  const {
    settingsOpen, settingsTab, closeSettings,
    analysts, activeAnalystId, setActiveAnalystId, saveAnalysts,
    createAnalyst, deleteAnalyst, duplicateAnalyst,
    financeProvider, font, fontSize, textCase, showTickerPrice,
    liveEnabled,
    exportData, importBackup, clearCache, cacheSize,
  } = useSentry()

  const [twKey, setTwKey] = useState('')
  const [anKey, setAnKey] = useState('')
  const [model, setModel] = useState(() => engine.getModel())
  const [expandedAnalyst, setExpandedAnalyst] = useState<string | null>(null)
  const [localFinance, setLocalFinance] = useState(financeProvider)
  const [localFont, setLocalFont] = useState(font)
  const [localFontSize, setLocalFontSize] = useState(fontSize)
  const [localCase, setLocalCase] = useState(textCase)
  const [localLiveEnabled, setLocalLiveEnabled] = useState(liveEnabled)
  const [localShowTickerPrice, setLocalShowTickerPrice] = useState(showTickerPrice)

  useEffect(() => {
    if (settingsOpen) {
      setTwKey(engine.getTwKey())
      setAnKey(engine.getAnKey())
      setModel(engine.getModel())
      setLocalFinance(engine.getFinanceProvider())
      setLocalFont(engine.getFont())
      setLocalFontSize(engine.getFontSize())
      setLocalCase(engine.getCase())
      setLocalLiveEnabled(engine.isLiveEnabled())
      setLocalShowTickerPrice(engine.getShowTickerPrice())
    }
  }, [settingsOpen])

  const handleSave = () => {
    if (twKey.trim()) localStorage.setItem('signal_twitter_key', twKey.trim())
    if (anKey.trim()) localStorage.setItem('signal_anthropic_key', anKey.trim())
    localStorage.setItem('signal_model', model)
    localStorage.setItem('signal_finance_provider', localFinance)
    engine.setFont(localFont)
    engine.setFontSize(localFontSize)
    engine.setCase(localCase)
    engine.setLiveEnabled(localLiveEnabled)
    engine.setShowTickerPrice(localShowTickerPrice)
    closeSettings()
    window.location.reload()
  }

  const handleClearKeys = () => {
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
        window.location.reload()
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

  return (
    <Sheet open={settingsOpen} onOpenChange={(open) => { if (!open) closeSettings() }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg w-full">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Configure your API keys, analysts, and display preferences.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue={settingsTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="api">API</TabsTrigger>
            <TabsTrigger value="analyst">Analyst</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          {/* API Tab */}
          <TabsContent value="api" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Your API keys are stored locally and only sent to their respective APIs.
            </p>
            <div className="space-y-2">
              <Label>X/Twitter API key</Label>
              <Input
                type="password"
                value={twKey}
                onChange={e => setTwKey(e.target.value)}
                placeholder="Your twitterapi.io key"
              />
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
                  <SelectItem value="claude-haiku-3-5-20241022">Claude Haiku 3.5</SelectItem>
                  <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{engine.formatModelCost(model)}</p>
            </div>
          </TabsContent>

          {/* Analyst Tab */}
          <TabsContent value="analyst" className="space-y-4 mt-4">
            {analysts.map(a => (
              <div key={a.id} className="border rounded-lg">
                <div
                  className="flex items-center gap-2 p-3 cursor-pointer"
                  onClick={() => setExpandedAnalyst(expandedAnalyst === a.id ? null : a.id)}
                >
                  {expandedAnalyst === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm font-normal flex-1">{a.name}</span>
                  {activeAnalystId === a.id ? (
                    <Badge variant="default" className="text-xs">Active</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setActiveAnalystId(a.id) }}>
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
                        <Button variant="destructive" size="sm" onClick={() => deleteAnalyst(a.id)}>
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
          <TabsContent value="display" className="space-y-4 mt-4">
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
                  <SelectItem value="mono">Monospace</SelectItem>
                  <SelectItem value="system">System</SelectItem>
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
              <Label>Text style</Label>
              <Select value={localCase} onValueChange={setLocalCase}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lower">lowercase</SelectItem>
                  <SelectItem value="sentence">Sentence case</SelectItem>
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
          <TabsContent value="data" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Live feed</Label>
                <Badge variant="outline" className="text-xs">beta</Badge>
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
              <p className="text-xs text-muted-foreground">Export copies your settings to clipboard. Import reads from clipboard.</p>
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
                <Button variant="outline" size="sm" onClick={clearCache}>Clear cache</Button>
                <span className="text-sm text-muted-foreground">{cacheSize} entries</span>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="destructive" size="sm" onClick={handleClearKeys}>
            Clear all
          </Button>
          <Button variant="outline" size="sm" onClick={closeSettings}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
