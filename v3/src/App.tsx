import React from 'react'
import { SentryProvider, useSentry } from '@/hooks/use-sentry'
import { AuthProvider } from '@/hooks/use-auth'
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
import { Onboarding } from '@/components/onboarding'
import { AuthDialog } from '@/components/auth-dialog'
import { PricingDialog } from '@/components/pricing-dialog'
import { DevToolbar } from '@/components/dev-toolbar'
import { TosPage } from '@/components/tos-page'
import { Download } from '@/components/icons'
import { IconSetProvider, type IconSet } from '@/components/icons'

const isDev = import.meta.env.DEV

// ---------------------------------------------------------------------------
// Error boundary — catches uncaught React errors and shows a recovery UI
// instead of a blank screen.
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Sentry ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
          <Card className="max-w-md w-full p-6 space-y-4 text-center">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Reload page
              </Button>
            </div>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

function AppContent() {
  const {
    busy, status, notices, scanResult, hasPendingScan, pendingScanInfo,
    resumeScan, dismissResumeBanner, downloadScan, isSharedView, sharedSignal,
    authDialogOpen, setAuthDialogOpen, authDialogTab,
    pricingOpen, setPricingOpen,
    openSettings,
    onboardingDone,
  } = useSentry()

  // Show onboarding for new users (unless viewing a shared signal)
  if (!onboardingDone && !isSharedView) {
    return <Onboarding />
  }

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
    <div className={`min-h-screen bg-background ${isDev ? 'pb-10' : ''}`}>
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
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Not financial advice
            </div>
          ) : null}
        </Card>
      </div>

      <SettingsDialog />
      <PresetDialog />
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={authDialogTab}
      />
      <PricingDialog
        open={pricingOpen}
        onOpenChange={setPricingOpen}
      />

      {/* Dev toolbar — only in development */}
      {isDev && <DevToolbar />}
    </div>
  )
}

function IconSetWrapper({ children }: { children: React.ReactNode }) {
  const { iconSet } = useSentry()
  return <IconSetProvider value={iconSet as IconSet}>{children}</IconSetProvider>
}

export default function App() {
  if (window.location.pathname === '/tos') {
    return <TosPage />
  }

  return (
    <ErrorBoundary>
      <AuthProvider mockMode={isDev}>
        <SentryProvider>
          <IconSetWrapper>
            <TooltipProvider>
              <AppContent />
            </TooltipProvider>
          </IconSetWrapper>
        </SentryProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
