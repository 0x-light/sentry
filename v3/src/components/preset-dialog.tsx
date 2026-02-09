import { useState, useEffect, useRef } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
    <Dialog open={presetDialogOpen} onOpenChange={(open) => { if (!open) { handleCancelImport(); closePresetDialog() } }}>
      <DialogContent className="preset-dialog sm:max-w-md w-full">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle>{editingPreset ? 'Edit preset' : 'Manage presets'}</DialogTitle>
            <DialogDescription>Create lists of accounts for quick scanning.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Import from Twitter following */}
          {!editingPreset && (
            <>
              <div className="preset-import space-y-2">
                <Label>Import from Twitter</Label>
                <p className="text-xs text-muted-foreground">
                  Enter a Twitter username to import the accounts they follow as a preset.
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
                    placeholder="@ username"
                    className="flex-1 h-9"
                    onKeyDown={e => { if (e.key === 'Enter') handleImportFollowing() }}
                    disabled={importing}
                  />
                  {importing ? (
                    <Button variant="outline" onClick={handleCancelImport} size="sm" className="h-9">
                      Cancel
                    </Button>
                  ) : (
                    <Button onClick={handleImportFollowing} size="sm" disabled={!importUsername.trim()} className="h-9">
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

          <div className="preset-form space-y-2">
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

          {presets.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="preset-list space-y-2">
                <Label>Existing presets</Label>
                {presets.map(p => (
                  <div key={p.name} className="preset-item flex items-center gap-2 p-2 rounded-md border text-sm">
                    <span className={`flex-1 font-normal ${p.hidden ? 'text-muted-foreground' : ''}`}>{p.name}</span>
                    <span className="text-muted-foreground">{p.accounts.length}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePresetVisibility(p.name)}>
                      {p.hidden ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <Eye className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPresetDialog(p.name)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm(`Delete preset "${p.name}"?`)) deletePreset(p.name) }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
