import { useState, useRef } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { RANGES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { Plus, X, Pencil, Search, Loader2 } from '@/components/icons'

export function Controls() {
  const {
    customAccounts, loadedPresets, presets,
    addAccount, removeAccount, togglePreset, clearAllAccounts,
    recents, addFromRecents, clearRecents,
    range, setRange, busy, scan, cancelScan,
    openPresetDialog,
  } = useSentry()

  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const val = inputValue.trim().replace(/^@/, '')
    if (val) {
      val.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).forEach(addAccount)
      setInputValue('')
    }
  }

  const hasAccounts = customAccounts.length > 0 || loadedPresets.length > 0

  return (
    <div className="border-b">
      {/* Input row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex items-center flex-1">
          {inputValue && <span className="text-sm text-muted-foreground select-none">@</span>}
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value.replace(/^@/, ''))}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="@ add account"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={handleAdd} className={cn(!inputValue.trim() && "invisible")}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {/* Presets + custom accounts */}
      <div className="flex flex-wrap items-center gap-1.5 px-4">
        {presets.filter(p => !p.hidden).map(p => (
          <Badge
            key={p.name}
            variant={loadedPresets.includes(p.name) ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => togglePreset(p.name)}
          >
            {p.name}
            <span className="ml-1 opacity-60">{p.accounts.length}</span>
          </Badge>
        ))}

        {customAccounts.map(a => (
          <Badge
            key={a}
            variant="secondary"
            className="cursor-pointer select-none gap-1"
          >
            @{a}
            <X className="h-3 w-3 opacity-50 hover:opacity-100 transition-opacity" onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeAccount(a) }} />
          </Badge>
        ))}

        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md" onClick={() => openPresetDialog()}>
          <Plus className="h-3 w-3" />
        </Button>

        {presets.length > 0 && (
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md" onClick={() => openPresetDialog()}>
            <Pencil className="h-3 w-3" />
          </Button>
        )}

        {hasAccounts && (
          <Button variant="ghost" size="sm" className="h-6 text-sm text-muted-foreground" onClick={clearAllAccounts}>
            Clear
          </Button>
        )}
      </div>

      {/* Recents */}
      {recents.length > 0 && !hasAccounts && (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
            <span className="text-sm text-muted-foreground font-normal mr-1">Recent</span>
            {recents.map(s => (
              <Badge
                key={s}
                variant="outline"
                className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => addFromRecents(s)}
              >
                @{s}
              </Badge>
            ))}
            <Button variant="ghost" size="icon" className="h-5 w-5 rounded-md" onClick={clearRecents}>
              <X className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        </>
      )}

      {/* Range + Scan */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-[3px]">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              className={cn(
                "px-3 py-1 text-sm rounded-md transition-all font-normal",
                range === i
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setRange(i)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          {busy && (
            <Button variant="outline" size="sm" onClick={cancelScan}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={scan} disabled={busy || !hasAccounts}>
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                Scan
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
