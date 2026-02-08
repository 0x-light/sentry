import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from '@/components/icons'
import * as api from '@/lib/api'
import type { CreditPack } from '@/lib/types'

// Credit packs — matches backend CREDIT_PACKS
// Estimates all use the same "200 accounts, daily scan" baseline for easy comparison
const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 1000,
    price: 900,
    perCredit: 0.009,
    estimates: [
      { label: 'Scan 200 accounts ~5 times', count: 5 },
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    credits: 5000,
    price: 3900,
    perCredit: 0.0078,
    savings: '13% off',
    recommended: true,
    estimates: [
      { label: 'Scan 200 accounts ~25 times', count: 25 },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 15000,
    price: 9900,
    perCredit: 0.0066,
    savings: '27% off',
    estimates: [
      { label: 'Scan 200 accounts ~75 times', count: 75 },
    ],
  },
  {
    id: 'max',
    name: 'Max',
    credits: 40000,
    price: 19900,
    perCredit: 0.005,
    savings: '45% off',
    estimates: [
      { label: 'Scan 200 accounts ~200 times', count: 200 },
    ],
  },
]

interface PricingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PricingDialog({ open, onOpenChange }: PricingDialogProps) {
  const { isAuthenticated, profile } = useAuth()
  const [loadingPack, setLoadingPack] = useState<string | null>(null)
  const [recurring, setRecurring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBuyCredits = async (packId: string) => {
    if (!isAuthenticated) return
    setLoadingPack(packId)
    setError(null)
    try {
      const { url } = await api.buyCredits({
        packId,
        recurring,
        successUrl: window.location.origin + '/?billing=success',
        cancelUrl: window.location.origin + '/?billing=cancel',
      })
      if (url) {
        window.location.href = url
      } else {
        setError('No checkout URL returned. Please try again.')
      }
    } catch (err: any) {
      console.error('Checkout error:', err)
      setError(err.message || 'Failed to start checkout')
    } finally {
      setLoadingPack(null)
    }
  }

  const handleManageBilling = async () => {
    if (!isAuthenticated) return
    setLoadingPack('portal')
    setError(null)
    try {
      const { url } = await api.getBillingPortalUrl()
      if (url) {
        window.location.href = url
      } else {
        setError('No billing portal URL returned. Please try again.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open billing portal')
    } finally {
      setLoadingPack(null)
    }
  }

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'usd',
      minimumFractionDigits: 0,
    }).format(cents / 100)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg w-full">
        <SheetHeader>
          <SheetTitle>Buy Credits</SheetTitle>
          <SheetDescription>
            Credits are used for scans with managed API keys. 1 credit = 1 account per day.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {/* Current balance */}
          {isAuthenticated && profile && (
            <div className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Current balance</span>
              <span className="text-sm font-medium">
                {(profile.credits_balance || 0).toLocaleString()} credits
              </span>
            </div>
          )}

          {/* Recurring toggle */}
          <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:border-foreground/20 transition-colors">
            <input
              type="checkbox"
              checked={recurring}
              onChange={e => setRecurring(e.target.checked)}
              className="rounded border-border"
            />
            <div className="flex-1">
              <span className="text-sm">Auto-refill monthly</span>
              <p className="text-xs text-muted-foreground">Credits are added at the start of each billing cycle</p>
            </div>
          </label>

          {/* Credit packs */}
          {CREDIT_PACKS.map(pack => (
            <div
              key={pack.id}
              className={cn(
                "p-4 rounded-lg border space-y-3",
                pack.recommended && "border-primary ring-1 ring-primary"
              )}
            >
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{pack.name}</h4>
                {pack.savings && (
                  <Badge variant="secondary" className="text-xs">{pack.savings}</Badge>
                )}
                {pack.recommended && (
                  <Badge variant="default" className="text-xs">Popular</Badge>
                )}
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{formatPrice(pack.price)}</span>
                <span className="text-sm text-muted-foreground">
                  {pack.credits.toLocaleString()} credits
                </span>
                {recurring && <span className="text-xs text-muted-foreground">/mo</span>}
              </div>

              {/* Estimates */}
              <div className="space-y-1">
                {pack.estimates.map((est, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-3 w-3 text-signal-green shrink-0" />
                    <span>{est.label}</span>
                  </div>
                ))}
              </div>

              <Button
                className="w-full"
                variant={pack.recommended ? 'default' : 'outline'}
                onClick={() => handleBuyCredits(pack.id)}
                disabled={!!loadingPack || !isAuthenticated}
              >
                {loadingPack === pack.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  recurring ? `Subscribe — ${formatPrice(pack.price)}/mo` : `Buy — ${formatPrice(pack.price)}`
                )}
              </Button>
            </div>
          ))}

          {/* Free tier info */}
          <div className="p-4 rounded-lg border space-y-2">
            <h4 className="text-sm font-medium">Free (BYOK)</h4>
            <p className="text-sm text-muted-foreground">
              Use your own API keys for unlimited scans. 1 free scan/day with up to 10 accounts.
            </p>
          </div>

          {/* Credit formula */}
          <div className="p-3 rounded-lg bg-muted/30 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">How credits work</p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Credits = accounts × range multiplier</p>
              <p>Today = ×1 · 3 days = ×2 · Week = ×3 · 2 weeks = ×5 · Month = ×8</p>
              <p className="pt-1">Example: 200 accounts × today = 200 credits</p>
              <p>Example: 200 accounts × week = 600 credits</p>
            </div>
          </div>

          {/* Manage subscription */}
          {profile?.subscription_status === 'active' && (
            <>
              <Separator />
              <Button
                variant="outline"
                className="w-full"
                onClick={handleManageBilling}
                disabled={!!loadingPack}
              >
                {loadingPack === 'portal' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Manage subscription'
                )}
              </Button>
            </>
          )}

          {!isAuthenticated && (
            <>
              <Separator />
              <p className="text-sm text-muted-foreground text-center">
                Sign in to purchase credits.
              </p>
            </>
          )}

          <div className="text-center pt-2">
            <p className="text-xs text-muted-foreground">
              Payments processed securely by Stripe. Apple Pay & Google Pay supported.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
