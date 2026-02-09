import { useMemo } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import * as engine from '@/lib/engine'
import { ACT_COLORS, CAT_COLORS } from '@/lib/constants'
import { useChartPreview, ChartPreview } from '@/components/chart-preview'

export function TickerBar() {
  const { scanResult, priceCache, filters, setFilter, setTickerFilter, showTickerPrice } = useSentry()
  const { chartPreview, showChart, moveChart, hideChart } = useChartPreview()

  const tickers = useMemo(() => {
    if (!scanResult?.signals) return []
    const tickerMap = new Map<string, { symbol: string; action: string; count: number }>()
    scanResult.signals.forEach(s => {
      (s.tickers || []).forEach(t => {
        const sym = (t.symbol || '').toUpperCase()
        if (!sym) return
        const existing = tickerMap.get(sym)
        if (existing) {
          existing.count++
          // Keep most common action or "mixed" if different
          if (existing.action !== t.action && existing.action !== 'mixed') existing.action = 'mixed'
        } else {
          tickerMap.set(sym, { symbol: sym, action: t.action, count: 1 })
        }
      })
    })
    return [...tickerMap.values()]
      .sort((a, b) => b.count - a.count)
  }, [scanResult])

  const categories = useMemo(() => {
    if (!scanResult?.signals) return []
    const catMap = new Map<string, number>()
    scanResult.signals.forEach(s => {
      const cat = engine.normCat(s.category)
      catMap.set(cat, (catMap.get(cat) || 0) + 1)
    })
    return [...catMap.entries()].sort((a, b) => b[1] - a[1])
  }, [scanResult])

  if (!tickers.length && !categories.length) return null

  return (
    <div className="ticker-bar border-b">
      {/* Ticker bar */}
      {tickers.length > 0 && (
        <div className="ticker-list flex flex-wrap items-center gap-2 px-4 py-2.5">
          {tickers.map(t => {
            const sym = t.symbol.replace(/^\$/, '').toUpperCase()
            const price = priceCache[sym]
            const colors = ACT_COLORS[t.action] || ACT_COLORS.watch
            const isActive = filters.ticker === sym

            return (
              <button
                key={t.symbol}
                onClick={() => setTickerFilter(sym)}
                onMouseEnter={e => showChart(t.symbol, e)}
                onMouseMove={moveChart}
                onMouseLeave={hideChart}
                className={cn(
                  "ticker inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm whitespace-nowrap cursor-pointer transition-all",
                  colors.bg, colors.text,
                  isActive
                    ? "active ring-1 ring-current ring-opacity-50 opacity-100"
                    : "hover:opacity-80"
                )}
              >
                <span className="font-normal">
                  {t.symbol}
                </span>
                {t.count > 1 && (
                  <span className="opacity-70">×{t.count}</span>
                )}
                {showTickerPrice && price && (
                  <span className="opacity-60">{engine.formatPrice(price.price)}</span>
                )}
                {price && price.change !== 0 && (
                  <span className={cn(
                    "font-normal",
                    price.change >= 0 ? "text-signal-green" : "text-signal-red"
                  )}>
                    {engine.formatChange(price.change)}
                  </span>
                )}
              </button>
            )
          })}
          {filters.ticker && (
            <button
              onClick={() => setTickerFilter(null)}
              className="ticker-clear text-sm text-muted-foreground hover:text-foreground ml-1"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      {categories.length > 0 && (
        <div className="filter-bar flex items-center gap-2 px-4 py-2 border-t">
          <span className="text-sm text-muted-foreground mr-1">Filter</span>
          {categories.map(([cat, count]) => {
            const isActive = filters.category === cat
            const colors = CAT_COLORS[cat] || CAT_COLORS.Trade
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "filter-option inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-normal transition-all",
                  isActive
                    ? `active ${colors.text} ${colors.bg} ring-1 ring-current ring-opacity-30`
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {cat}
                <span className="opacity-60">{count}</span>
              </button>
            )
          })}
          {filters.category && (
            <button
              onClick={() => setFilter(null)}
              className="filter-clear text-sm text-muted-foreground hover:text-foreground ml-1"
            >
              ✕
            </button>
          )}
        </div>
      )}
      {chartPreview && <ChartPreview {...chartPreview} />}
    </div>
  )
}
