import { useState } from 'react'
import { useSentry } from '@/hooks/use-sentry'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Trash2, Download } from 'lucide-react'
import * as engine from '@/lib/engine'

export function HistorySection() {
  const { scanHistory, deleteHistoryScan } = useSentry()
  const [expanded, setExpanded] = useState(false)
  const [expandedScan, setExpandedScan] = useState<number | null>(null)

  if (!scanHistory.length) return null

  const handleDownload = (index: number) => {
    const entry = scanHistory[index]
    if (!entry) return
    const scan = {
      date: entry.date,
      range: entry.range,
      days: 0,
      accounts: [],
      totalTweets: entry.totalTweets,
      signals: entry.signals,
    }
    engine.downloadScanAsMarkdown(scan as any)
  }

  return (
    <div className="border-t">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        History
        <span className="text-xs opacity-60">{scanHistory.length}</span>
      </button>

      {expanded && (
        <div>
          {scanHistory.map((entry, i) => {
            const d = new Date(entry.date)
            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const isExpanded = expandedScan === i

            return (
              <div key={entry.date} className="border-t">
                <div
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedScan(isExpanded ? null : i)}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="text-sm flex-1">{dateStr}</span>
                  <span className="text-xs text-muted-foreground">{entry.range}</span>
                  <span className="text-xs text-muted-foreground">{entry.accounts} accts</span>
                  <span className="text-xs text-muted-foreground">{entry.signalCount} signals</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); handleDownload(i) }}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteHistoryScan(i) }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {isExpanded && entry.signals && (
                  <div className="px-4 pb-3">
                    {entry.signals.map((s, j) => (
                      <div key={j} className="py-2 border-t first:border-t-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs text-muted-foreground">{engine.normCat(s.category)}</span>
                          <span className="text-xs text-muted-foreground">@{s.source}</span>
                        </div>
                        <p className="text-sm font-normal">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.summary}</p>
                        {s.tickers?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {s.tickers.map((t, k) => (
                              <span key={k} className="text-xs text-muted-foreground">{t.symbol} ({t.action})</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
