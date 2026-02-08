import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

function icon(children: React.ReactNode, name: string) {
  const Icon = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = 24, className, strokeWidth = 1.5, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        {children}
      </svg>
    )
  )
  Icon.displayName = name
  return Icon
}

// ── Navigation ──────────────────────────────────────────────────────────────

/** SF: chevron.down */
export const ChevronDown = icon(
  <path d="m6 9 6 6 6-6" />,
  'ChevronDown'
)

/** SF: chevron.up */
export const ChevronUp = icon(
  <path d="m6 15 6-6 6 6" />,
  'ChevronUp'
)

/** SF: chevron.right */
export const ChevronRight = icon(
  <path d="m9 6 6 6-6 6" />,
  'ChevronRight'
)

// ── Actions ─────────────────────────────────────────────────────────────────

/** SF: plus */
export const Plus = icon(
  <path d="M12 5v14M5 12h14" />,
  'Plus'
)

/** SF: xmark */
export const X = icon(
  <path d="M18 6 6 18M6 6l12 12" />,
  'X'
)

/** SF: checkmark */
export const Check = icon(
  <path d="m5 12 5 5L20 7" />,
  'Check'
)

/** SF: magnifyingglass */
export const Search = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m16.5 16.5 4 4" />
  </>,
  'Search'
)

// ── Document ────────────────────────────────────────────────────────────────

/** SF: doc.on.doc */
export const Copy = icon(
  <>
    <rect x="9" y="2" width="11" height="13" rx="2" />
    <path d="M5 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
  </>,
  'Copy'
)

/** SF: clipboard */
export const ClipboardPaste = icon(
  <>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </>,
  'ClipboardPaste'
)

// ── Transfer ────────────────────────────────────────────────────────────────

/** SF: arrow.down.to.line */
export const Download = icon(
  <>
    <path d="M12 3v13" />
    <path d="m7 12 5 5 5-5" />
    <path d="M5 20h14" />
  </>,
  'Download'
)

/** SF: arrow.up.right.square */
export const ExternalLink = icon(
  <>
    <path d="M15 3h6v6" />
    <path d="M21 3 10 14" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
  'ExternalLink'
)

// ── Edit ────────────────────────────────────────────────────────────────────

/** SF: pencil */
export const Pencil = icon(
  <>
    <path d="M13.5 6.5 17 3l4 4-3.5 3.5" />
    <path d="M13.5 6.5 4 16v4h4l9.5-9.5" />
  </>,
  'Pencil'
)

/** SF: trash */
export const Trash2 = icon(
  <>
    <path d="M4 7h16" />
    <path d="m9 3.5 0 0h6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v5" />
    <path d="M14 11v5" />
  </>,
  'Trash2'
)

// ── System ──────────────────────────────────────────────────────────────────

/** SF: gearshape */
export const Settings = icon(
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  'Settings'
)

/** SF: sun.max */
export const Sun = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>,
  'Sun'
)

/** SF: moon */
export const Moon = icon(
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  'Moon'
)

// ── Status ──────────────────────────────────────────────────────────────────

/** SF: dot.radiowaves.left.and.right */
export const Radio = icon(
  <>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
    <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
  </>,
  'Radio'
)

/** SF: progress.indicator (spinning arc) */
export const Loader2 = icon(
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  'Loader2'
)

/** SF: eye */
export const Eye = icon(
  <>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </>,
  'Eye'
)

/** SF: eye.slash */
export const EyeOff = icon(
  <>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </>,
  'EyeOff'
)
