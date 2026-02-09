import { useAuth } from '@/hooks/use-auth'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Settings, ExternalLink } from '@/components/icons'
import { cn } from '@/lib/utils'

interface UserMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: (tab?: string) => void
  onOpenPricing: () => void
}

export function UserMenu({ open, onOpenChange, onOpenSettings, onOpenPricing }: UserMenuProps) {
  const { user, profile, signOut, isAuthenticated } = useAuth()

  if (!isAuthenticated || !user) return null

  const handleSignOut = async () => {
    await signOut()
    onOpenChange(false)
  }

  const credits = profile?.credits_balance || 0
  const hasCredits = credits > 0
  const hasSubscription = profile?.subscription_status === 'active'

  // Progress bar: show relative to a "typical" balance for visual feedback
  // We cap the visual at 100% — the number itself is always accurate
  const maxVisual = 15000 // Standard pack
  const barPercent = Math.min((credits / maxVisual) * 100, 100)

  const barColor = credits > 5000
    ? 'bg-signal-green'
    : credits > 1000
      ? 'bg-signal-yellow'
      : credits > 0
        ? 'bg-signal-red'
        : 'bg-muted-foreground/30'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="user-menu sm:max-w-sm w-full">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle>Account</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Credit Balance */}
          <div className="user-credits p-4 rounded-lg border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Credits</span>
              <span className="text-sm font-medium">
                {credits.toLocaleString()}
              </span>
            </div>

            {/* Progress bar */}
            <div className="credit-bar h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("credit-bar-fill h-full rounded-full transition-all duration-500", barColor)}
                style={{ width: `${barPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {hasCredits ? 'Managed API keys active' : 'No credits — BYOK mode'}
              </span>
              {hasSubscription && (
                <Badge variant="outline" className="text-xs text-signal-green bg-signal-green-bg">
                  Auto-refill
                </Badge>
              )}
            </div>

            {/* Buy credits button */}
            <Button
              variant={hasCredits ? 'outline' : 'default'}
              className="w-full"
              onClick={() => { onOpenChange(false); onOpenPricing() }}
            >
              {hasCredits ? 'Buy more credits' : 'Buy credits'}
            </Button>
          </div>

          {/* Free tier info */}
          {!hasCredits && (
            <div className="p-3 rounded-lg bg-muted/30 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Free tier: <span className="text-foreground font-medium">1 scan per day</span>, up to 10 accounts.
              </p>
              {profile?.free_scan_available ? (
                <p className="text-xs text-signal-green font-medium">
                  ✓ Free scan available today
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ✗ Free scan used today — resets tomorrow
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            {hasSubscription && (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={async () => {
                  onOpenChange(false)
                  try {
                    const { url } = await import('@/lib/api').then(m => m.getBillingPortalUrl())
                    if (url) window.location.href = url
                  } catch (e) { console.error(e) }
                }}
              >
                <span className="flex-1 text-left">Manage subscription</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => { onOpenChange(false); onOpenSettings('api') }}
            >
              <span className="flex-1 text-left">API keys</span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => { onOpenChange(false); onOpenSettings('analyst') }}
            >
              <span className="flex-1 text-left">Analysts</span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => { onOpenChange(false); onOpenSettings('display') }}
            >
              <span className="flex-1 text-left">Display settings</span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>

          <Separator />

          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
