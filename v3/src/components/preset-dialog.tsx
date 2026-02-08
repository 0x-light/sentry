import { useState, useEffect, useRef } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Trash2, Pencil, Eye, EyeOff, Download, Loader2 } from '@/components/icons'
import * as engine from '@/lib/engine'

export function PresetDialog() {
  const {
    presetDialogOpen, closePresetDialog, editingPreset,
    presets, savePreset, deletePreset, openPresetDialog, togglePresetVisibility,
  } = useSentry()

  const [name, setName] = useState('')
  const [accountsText, setAccountsText] = useState('')

  // Import following state
  const [importUsername, setImportUsername] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importError, setImportError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (presetDialogOpen && editingPreset) {
      const p = presets.find(p => p.name === editingPreset)
      if (p) {
        setName(p.name)
        setAccountsText(p.accounts.join(', '))
      }
    } else if (presetDialogOpen) {
      setName('')
      setAccountsText('')
    }
    // Reset import state when dialog opens/closes
    setImportUsername('')
    setImporting(false)
    setImportProgress('')
    setImportError('')
  }, [presetDialogOpen, editingPreset, presets])

  const handleSave = () => {
    if (!name.trim()) return
    const accounts = accountsText
      .split(',')
      .map(s => s.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean)
    if (!accounts.length) return
    savePreset(name.trim(), accounts, editingPreset)
    closePresetDialog()
  }

  const handleImportFollowing = async () => {
    const username = importUsername.trim().replace(/^@/, '').toLowerCase()
    if (!username || importing) return

    setImporting(true)
    setImportError('')
    setImportProgress('Fetching following list...')
    abortRef.current = new AbortController()

    try {
      const accounts = await engine.fetchFollowing(
        username,
        (msg) => setImportProgress(msg),
        abortRef.current.signal
      )
      if (accounts.length === 0) {
        setImportError('No accounts found. The user may have a private following list.')
        return
      }
      // Set the name to the username if empty
      if (!name.trim()) setName(`${username}'s following`)
      // Set the accounts
      setAccountsText(accounts.join(', '))
      setImportProgress(`Imported ${accounts.length} accounts`)
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setImportProgress('Cancelled')
      } else {
        setImportError(e.message)
      }
    } finally {
      setImporting(false)
      abortRef.current = null
    }
  }

  const handleCancelImport = () => {
    abortRef.current?.abort()
  }

  return (
    <Sheet open={presetDialogOpen} onOpenChange={(open) => { if (!open) { handleCancelImport(); closePresetDialog() } }}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editingPreset ? 'Edit preset' : 'Manage presets'}</SheetTitle>
          <SheetDescription>Create lists of accounts for quick scanning.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          {/* Import from Twitter following */}
          {!editingPreset && (
            <>
              <div className="space-y-2">
                <Label>Import from Twitter</Label>
                <p className="text-xs text-muted-foreground">
                  Enter a Twitter username to import the accounts they follow as a preset.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={importUsername}
                    onChange={e => setImportUsername(e.target.value)}
                    placeholder="@ username"
                    className="flex-1"
                    onKeyDown={e => { if (e.key === 'Enter') handleImportFollowing() }}
                    disabled={importing}
                  />
                  {importing ? (
                    <Button variant="outline" onClick={handleCancelImport} size="sm">
                      Cancel
                    </Button>
                  ) : (
                    <Button onClick={handleImportFollowing} size="sm" disabled={!importUsername.trim()}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Import
                    </Button>
                  )}
                </div>
                {importing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{importProgress}</span>
                  </div>
                )}
                {importError && (
                  <p className="text-xs text-destructive">{importError}</p>
                )}
                {!importing && !importError && importProgress && importProgress.startsWith('Imported') && (
                  <p className="text-xs text-signal-green">{importProgress}</p>
                )}
              </div>
              <Separator />
            </>
          )}

          <div className="space-y-2">
            <Label>Preset name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="E.g. Commodities"
            />
          </div>

          <div className="space-y-2">
            <Label>Accounts (comma-separated)</Label>
            <Textarea
              value={accountsText}
              onChange={e => setAccountsText(e.target.value)}
              placeholder="account1, account2, account3"
              className="min-h-[120px]"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={closePresetDialog}>Cancel</Button>
            <Button onClick={handleSave}>
              {editingPreset ? 'Update preset' : 'Save preset'}
            </Button>
          </div>
        </div>

        {presets.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2">
              <Label>Existing presets</Label>
              {presets.map(p => (
                <div key={p.name} className="flex items-center gap-2 p-2 rounded-md border text-sm">
                  <span className={`flex-1 font-normal ${p.hidden ? 'text-muted-foreground' : ''}`}>{p.name}</span>
                  <span className="text-muted-foreground">{p.accounts.length}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePresetVisibility(p.name)}>
                    {p.hidden ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPresetDialog(p.name)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePreset(p.name)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
