import { useState, useMemo } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import * as engine from '@/lib/engine'
import { ACT_COLORS, CAT_COLORS } from '@/lib/constants'
import { ExternalLink, Copy, Check, ChevronDown, ChevronUp } from '@/components/icons'
import { useChartPreview, ChartPreview } from '@/components/chart-preview'

function formatTime(dateStr?: string): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    const now = Date.now()
    const diff = now - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return null }
}

function SignalCard({ signal, index }: { signal: import('@/lib/types').Signal; index: number }) {
  const { shareSignal, scanResult, priceCache, showTickerPrice } = useSentry()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { chartPreview, showChart, moveChart, hideChart } = useChartPreview()

  const cat = engine.normCat(signal.category)
  const catColors = CAT_COLORS[cat] || CAT_COLORS.Trade
  const tweetMeta = scanResult?.tweetMeta?.[signal.tweet_url]
  const timeStr = formatTime(signal.tweet_time || tweetMeta?.time)

  const handleCopy = async () => {
    await shareSignal(index)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="signal-card border-b last:border-b-0 animate-slide-in">
      <div className="px-4 py-3">
        {/* Header: Category + Source + Post link */}
        <div className="signal-header flex items-center gap-2 mb-1">
          <span className={cn("signal-category text-sm font-normal", catColors.text)}>{cat}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <a
            href={`https://x.com/${signal.source}`}
            target="_blank"
            rel="noopener"
            className="signal-source text-sm text-muted-foreground hover:text-foreground"
          >
            @{signal.source}
          </a>
          {timeStr && (
            <>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="signal-time text-sm text-muted-foreground">{timeStr}</span>
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="signal-share inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Share'}
            </button>
            {signal.tweet_url && (
              <a
                href={signal.tweet_url}
                target="_blank"
                rel="noopener"
                className="signal-post-link inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Post
              </a>
            )}
          </span>
        </div>

        {/* Title */}
        <h3 className="signal-title text-sm font-normal leading-snug mb-1">{signal.title}</h3>

        {/* Summary */}
        <p className="signal-summary text-sm text-muted-foreground leading-relaxed mb-2">{signal.summary}</p>

        {/* Tickers */}
        {signal.tickers?.length > 0 && (
          <div className="signal-tickers flex flex-wrap items-center gap-1.5 mb-2">
            {signal.tickers.map((t, i) => {
              const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase()
              const price = priceCache[sym]
              const colors = ACT_COLORS[t.action] || ACT_COLORS.watch
              const url = engine.tickerUrl(t.symbol)

              return (
                <a
                  key={`${t.symbol}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noopener"
                  onMouseEnter={e => showChart(t.symbol, e)}
                  onMouseMove={moveChart}
                  onMouseLeave={hideChart}
                  className={cn(
                    "ticker inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm",
                    colors.bg, colors.text,
                    "hover:opacity-80 transition-opacity"
                  )}
                >
                  <span className="font-normal">{t.symbol}</span>
                  <span className="opacity-70">{t.action.charAt(0).toUpperCase() + t.action.slice(1)}</span>
                  {showTickerPrice && price && (
                    <span className="opacity-60">{engine.formatPrice(price.price)}</span>
                  )}
                  {price && price.change !== 0 && (
                    <span className={cn(
                      "font-normal",
                      price.change > 0 ? "text-signal-green" : "text-signal-red"
                    )}>
                      {engine.formatChange(price.change)}
                    </span>
                  )}
                </a>
              )
            })}
          </div>
        )}

        {/* Post text (expandable) */}
        {tweetMeta && (
          <div className="post-preview mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="post-preview-toggle flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Original post
            </button>
            {expanded && (
              <p className="post-preview-text mt-1 text-sm text-muted-foreground p-2 bg-muted rounded-md whitespace-pre-wrap">
                {tweetMeta.text}
              </p>
            )}
          </div>
        )}

        {/* Links */}
        {signal.links?.length > 0 && (
          <div className="signal-links flex items-center gap-2 mt-2">
            {signal.links.map((link, i) => (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {(() => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return link } })()}
              </a>
            ))}
          </div>
        )}
        {chartPreview && <ChartPreview {...chartPreview} />}
      </div>
    </div>
  )
}

export function SignalList() {
  const { scanResult, filters, isSharedView, sharedSignal } = useSentry()

  // useMemo MUST be called before any early returns (Rules of Hooks)
  const signals = useMemo(() => {
    if (!scanResult?.signals) return []
    let result = scanResult.signals
    if (filters.category) {
      result = result.filter(s => engine.normCat(s.category) === filters.category)
    }
    if (filters.ticker) {
      result = result.filter(s =>
        (s.tickers || []).some(t => (t.symbol || '').replace(/^\$/, '').toUpperCase() === filters.ticker)
      )
    }
    return result
  }, [scanResult, filters])

  // For shared signal view
  if (isSharedView && sharedSignal) {
    return (
      <div>
        <SignalCard signal={sharedSignal} index={0} />
      </div>
    )
  }

  if (!signals.length) {
    if (scanResult?.signals?.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No signals found. Try different accounts or a longer time range.
        </div>
      )
    }
    return null
  }

  return (
    <div className="signal-list">
      {/* Signal count */}
      {scanResult && (
        <div className="signal-count px-4 py-2 text-sm text-muted-foreground border-b">
          {filters.category || filters.ticker
            ? `${signals.length} of ${scanResult.signals.length} signals`
            : `${signals.length} signals`}
        </div>
      )}

      {signals.map((signal, i) => (
        <SignalCard key={`${signal.tweet_url || signal.title}-${i}`} signal={signal} index={i} />
      ))}
    </div>
  )
}
