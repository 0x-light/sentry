import { useAuth } from '@/hooks/use-auth'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Settings, ExternalLink } from '@/components/icons'

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

  const subscriptionLabel = profile?.subscription_status === 'active'
    ? 'Active'
    : profile?.subscription_status === 'trialing'
      ? 'Trial'
      : 'Free'

  const subscriptionColor = profile?.subscription_status === 'active'
    ? 'text-signal-green bg-signal-green-bg'
    : profile?.subscription_status === 'trialing'
      ? 'text-signal-blue bg-signal-blue-bg'
      : 'text-muted-foreground bg-muted'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-sm w-full">
        <SheetHeader>
          <SheetTitle>Account</SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Credits & Subscription */}
          <div className="p-4 rounded-lg border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Scans remaining</span>
              <span className="text-sm font-medium">
                {profile?.scans_remaining === -1
                  ? 'Unlimited'
                  : profile?.scans_remaining ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge variant="outline" className={subscriptionColor}>
                {subscriptionLabel}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">This month</span>
              <span className="text-sm text-muted-foreground">
                {profile?.scans_this_month ?? 0} scans used
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => { onOpenChange(false); onOpenPricing() }}
            >
              <span className="flex-1 text-left">
                {profile?.subscription_status === 'active' ? 'Manage subscription' : 'Upgrade plan'}
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>

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
      </SheetContent>
    </Sheet>
  )
}
