import { useState, useRef, useMemo } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { RANGES } from '@/lib/constants'
import { calculateScanCredits } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Plus, X, Pencil, Search, Loader2 } from '@/components/icons'

export function Controls() {
  const {
    customAccounts, loadedPresets, presets,
    addAccount, removeAccount, togglePreset, clearAllAccounts,
    recents, addFromRecents, clearRecents,
    range, setRange, busy, scan, cancelScan,
    openPresetDialog, model,
  } = useSentry()
  const { isAuthenticated, profile } = useAuth()

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

  // Calculate total account count (same logic as getAllAccounts in use-sentry)
  const totalAccounts = useMemo(() => {
    const all = new Set(customAccounts)
    for (const name of loadedPresets) {
      const p = presets.find(p => p.name === name)
      if (p) p.accounts.forEach(a => all.add(a))
    }
    return all.size
  }, [customAccounts, loadedPresets, presets])

  // Show estimated credit cost for managed-key users
  const hasCredits = isAuthenticated && profile?.has_credits
  const freeScanAvailable = isAuthenticated && !hasCredits && profile?.free_scan_available
  const freeScanUsed = isAuthenticated && !hasCredits && profile?.free_scan_available === false
  const estimatedCredits = useMemo(() => {
    if (!hasCredits || !totalAccounts) return 0
    return calculateScanCredits(totalAccounts, RANGES[range].days, model)
  }, [hasCredits, totalAccounts, range, model])

  return (
    <div className="controls border-b">
      {/* Input row */}
      <div className="controls-input flex items-center gap-2 px-4 py-3">
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
      <div className="controls-presets flex flex-wrap items-center gap-1.5 px-4">
        {presets.filter(p => !p.hidden).map(p => (
          <Badge
            key={p.name}
            variant={loadedPresets.includes(p.name) ? "default" : "outline"}
            className="preset-badge cursor-pointer select-none"
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
            className="account-badge cursor-pointer select-none gap-1"
          >
            @{a}
            <X className="h-3 w-3 opacity-50 hover:opacity-100 transition-opacity" onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeAccount(a) }} />
          </Badge>
        ))}

        <Button variant="ghost" size="icon" className="controls-edit-presets h-6 w-6 rounded-md" onClick={() => openPresetDialog()}>
          <Pencil className="h-3 w-3" />
        </Button>

        {hasAccounts && (
          <Button variant="ghost" size="icon" className="controls-clear h-6 w-6 rounded-md" onClick={clearAllAccounts}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Recents */}
      {recents.length > 0 && !hasAccounts && (
        <>
          <Separator />
          <div className="controls-recents flex flex-wrap items-center gap-1.5 px-4 py-3">
            <span className="text-sm text-muted-foreground font-normal mr-1">Recent</span>
            {recents.map(s => (
              <Badge
                key={s}
                variant="outline"
                className="recent-badge cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
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
      <div className="controls-actions flex items-center gap-2 px-4 py-4">
        <div className="range-picker flex items-center gap-0.5 bg-muted rounded-lg p-[3px]">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              className={cn(
                "range-option px-3 py-1 text-sm rounded-md transition-all font-normal",
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

        <div className="controls-scan ml-auto flex gap-2">
          {busy && (
            <Button variant="outline" size="sm" onClick={cancelScan} className="hidden sm:inline-flex">
              Cancel
            </Button>
          )}
          {busy ? (
            <>
              {/* Mobile: single Cancel button replaces Scan */}
              <Button variant="outline" size="sm" onClick={cancelScan} className="sm:hidden">
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              {/* Desktop: keep the scanning indicator button */}
              <Button size="sm" disabled className="hidden sm:inline-flex">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {estimatedCredits > 0 && (
                <span className="credit-estimate text-xs text-muted-foreground whitespace-nowrap">
                  ~{estimatedCredits.toLocaleString()} cr
                </span>
              )}
              {freeScanAvailable && (
                <span className="text-xs text-signal-green whitespace-nowrap">
                  1 free scan today
                </span>
              )}
              {freeScanUsed && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Free scan used
                </span>
              )}
              <Button size="sm" onClick={scan} disabled={!hasAccounts} className="button-scan">
                <Search className="h-3.5 w-3.5" />
                Scan
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
