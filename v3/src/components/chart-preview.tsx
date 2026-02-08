import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSentry } from '@/hooks/use-sentry'
import * as engine from '@/lib/engine'

interface PreviewState {
  symbol: string
  x: number
  y: number
}

const WIDTH = 320
const HEIGHT = 200

export function useChartPreview() {
  const [state, setState] = useState<PreviewState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((symbol: string, e: React.MouseEvent) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setState({ symbol, x: e.clientX, y: e.clientY })
    }, 350)
  }, [])

  const move = useCallback((e: React.MouseEvent) => {
    setState(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
  }, [])

  const hide = useCallback(() => {
    clearTimeout(timerRef.current)
    setState(null)
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { chartPreview: state, showChart: show, moveChart: move, hideChart: hide }
}

export function ChartPreview({ symbol, x, y }: PreviewState) {
  const { theme } = useSentry()
  const clean = symbol.replace(/^\$/, '').toUpperCase()
  const isCrypto = engine.isCrypto(clean)

  // TradingView symbol format
  const tvSymbol = isCrypto ? engine.getTvSymbol(clean) : clean
  const colorTheme = theme === 'dark' ? 'dark' : 'light'

  // Clamp position to viewport
  const left = Math.min(x + 16, window.innerWidth - WIDTH - 16)
  const top = Math.min(Math.max(y - HEIGHT / 2, 16), window.innerHeight - HEIGHT - 16)

  const config = JSON.stringify({
    symbol: tvSymbol,
    width: WIDTH,
    height: HEIGHT,
    dateRange: '1M',
    colorTheme,
    isTransparent: true,
    autosize: false,
    largeChartUrl: '',
  })

  const src = `https://s.tradingview.com/embed-widget/mini-symbol-overview/?locale=en#${encodeURIComponent(config)}`

  return createPortal(
    <div
      className="fixed z-[100] pointer-events-none rounded-lg border bg-card shadow-xl overflow-hidden hidden sm:block"
      style={{ left, top, width: WIDTH, height: HEIGHT }}
    >
      <iframe
        src={src}
        className="w-full h-full border-0"
        style={{ pointerEvents: 'none' }}
        loading="lazy"
      />
    </div>,
    document.body
  )
}
