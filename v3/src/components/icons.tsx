import React, { createContext, useContext } from 'react'
import * as sf from './icons-sf'
import {
  Plus as LPlus, X as LX, Check as LCheck, Search as LSearch,
  ChevronDown as LChevronDown, ChevronUp as LChevronUp, ChevronRight as LChevronRight,
  Copy as LCopy, ClipboardPaste as LClipboardPaste,
  Download as LDownload, ExternalLink as LExternalLink,
  Pencil as LPencil, Trash2 as LTrash2,
  Settings as LSettings, Sun as LSun, Moon as LMoon, Radio as LRadio,
  Loader2 as LLoader2, Eye as LEye, EyeOff as LEyeOff,
  Clock as LClock, Bell as LBell, CalendarClock as LCalendarClock,
} from 'lucide-react'

// ── Context ─────────────────────────────────────────────────────────────────

export type IconSet = 'sf' | 'geist'

const IconSetContext = createContext<IconSet>('sf')

export function IconSetProvider({ value, children }: { value: IconSet; children: React.ReactNode }) {
  return <IconSetContext.Provider value={value}>{children}</IconSetContext.Provider>
}

export function useIconSet() {
  return useContext(IconSetContext)
}

// ── Switching wrapper ───────────────────────────────────────────────────────

function dual(
  SFIcon: React.ForwardRefExoticComponent<any>,
  GeistIcon: React.ForwardRefExoticComponent<any>,
  name: string,
) {
  const Icon = React.forwardRef<SVGSVGElement, any>((props, ref) => {
    const set = useContext(IconSetContext)
    const C = set === 'geist' ? GeistIcon : SFIcon
    return <C ref={ref} {...props} />
  })
  Icon.displayName = name
  return Icon
}

// ── Exports (same names as lucide-react for drop-in compatibility) ──────────

export const Plus = dual(sf.Plus, LPlus, 'Plus')
export const X = dual(sf.X, LX, 'X')
export const Check = dual(sf.Check, LCheck, 'Check')
export const Search = dual(sf.Search, LSearch, 'Search')
export const ChevronDown = dual(sf.ChevronDown, LChevronDown, 'ChevronDown')
export const ChevronUp = dual(sf.ChevronUp, LChevronUp, 'ChevronUp')
export const ChevronRight = dual(sf.ChevronRight, LChevronRight, 'ChevronRight')
export const Copy = dual(sf.Copy, LCopy, 'Copy')
export const ClipboardPaste = dual(sf.ClipboardPaste, LClipboardPaste, 'ClipboardPaste')
export const Download = dual(sf.Download, LDownload, 'Download')
export const ExternalLink = dual(sf.ExternalLink, LExternalLink, 'ExternalLink')
export const Pencil = dual(sf.Pencil, LPencil, 'Pencil')
export const Trash2 = dual(sf.Trash2, LTrash2, 'Trash2')
export const Settings = dual(sf.Settings, LSettings, 'Settings')
export const Sun = dual(sf.Sun, LSun, 'Sun')
export const Moon = dual(sf.Moon, LMoon, 'Moon')
export const Radio = dual(sf.Radio, LRadio, 'Radio')
export const Loader2 = dual(sf.Loader2, LLoader2, 'Loader2')
export const Eye = dual(sf.Eye, LEye, 'Eye')
export const EyeOff = dual(sf.EyeOff, LEyeOff, 'EyeOff')
export const Clock = dual(sf.Clock, LClock, 'Clock')
export const Bell = dual(sf.Bell, LBell, 'Bell')
export const CalendarClock = dual(sf.CalendarClock, LCalendarClock, 'CalendarClock')