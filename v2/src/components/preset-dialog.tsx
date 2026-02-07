import { useState, useEffect } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Trash2, Pencil } from 'lucide-react'

export function PresetDialog() {
  const {
    presetDialogOpen, closePresetDialog, editingPreset,
    presets, savePreset, deletePreset, openPresetDialog,
  } = useSentry()

  const [name, setName] = useState('')
  const [accountsText, setAccountsText] = useState('')

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

  return (
    <Sheet open={presetDialogOpen} onOpenChange={(open) => { if (!open) closePresetDialog() }}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editingPreset ? 'Edit preset' : 'Manage presets'}</SheetTitle>
          <SheetDescription>Create lists of accounts for quick scanning.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
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
                  <span className="flex-1 font-normal">{p.name}</span>
                  <span className="text-muted-foreground">{p.accounts.length} accounts</span>
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
