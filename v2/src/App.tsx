import { SentryProvider, useSentry } from '@/hooks/use-sentry'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Topbar } from '@/components/topbar'
import { Controls } from '@/components/controls'
import { TickerBar } from '@/components/ticker-bar'
import { SignalList } from '@/components/signal-list'
import { HistorySection } from '@/components/history-section'
import { SettingsDialog } from '@/components/settings-dialog'
import { PresetDialog } from '@/components/preset-dialog'
import { Download } from 'lucide-react'

function AppContent() {
  const {
    busy, status, notices, scanResult, hasPendingScan, pendingScanInfo,
    resumeScan, dismissResumeBanner, downloadScan, isSharedView, sharedSignal,
  } = useSentry()

  if (isSharedView && sharedSignal) {
    return (
      <div className="min-h-screen bg-background">
        <Topbar />
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="text-sm font-normal text-signal-blue">Shared signal</span>
          <a href={location.pathname} className="text-sm text-muted-foreground hover:text-foreground transition-colors">← back to sentry</a>
        </div>
        <SignalList />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl">
        <Card className="min-h-screen sm:min-h-0 sm:my-8 border-0 sm:border shadow-none sm:shadow-sm rounded-none sm:rounded-xl overflow-hidden [&>*:last-child]:border-b-0">
          <Topbar />
          <Controls />

          {/* Notices */}
          {notices.length > 0 && (
            <div>
              {notices.map((n, i) => (
                <div
                  key={i}
                  className={`px-4 py-2.5 text-sm border-b ${
                    n.type === 'error'
                      ? 'text-destructive bg-destructive/5'
                      : 'text-muted-foreground'
                  }`}
                >
                  {n.message}
                </div>
              ))}
            </div>
          )}

          {/* Resume banner */}
          {hasPendingScan && (
            <div className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap text-sm bg-accent">
              <span className="text-accent-foreground font-normal">Interrupted scan detected</span>
              <span className="text-muted-foreground">{pendingScanInfo}</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={resumeScan}>Resume</Button>
                <Button variant="ghost" size="sm" onClick={dismissResumeBanner}>✕</Button>
              </div>
            </div>
          )}

          {/* Status line */}
          {status?.text && (
            <div className="px-4 py-2.5 text-sm text-muted-foreground border-b flex items-center gap-3">
              <span>
                {status.text}
                {status.animate && <span className="dots" />}
              </span>
              {status.showDownload && (
                <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={downloadScan}>
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              )}
            </div>
          )}

          <TickerBar />
          <SignalList />
          <HistorySection />

          {scanResult?.signals?.length ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Not financial advice
            </div>
          ) : null}
        </Card>
      </div>

      <SettingsDialog />
      <PresetDialog />
    </div>
  )
}

export default function App() {
  return (
    <SentryProvider>
      <TooltipProvider>
        <AppContent />
      </TooltipProvider>
    </SentryProvider>
  )
}
