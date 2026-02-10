import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Loader2, ChevronDown } from '@/components/icons'
import * as api from '@/lib/api'
import type { CreditPack } from '@/lib/types'

// Credit packs — matches backend CREDIT_PACKS
const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 1000,
    price: 900,
    perCredit: 0.009,
    estimates: [
      { label: '~20 daily scans', count: 20 },
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    credits: 5000,
    price: 3900,
    perCredit: 0.0078,
    savings: '13%',
    recommended: true,
    estimates: [
      { label: '~100 daily scans', count: 100 },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 15000,
    price: 9900,
    perCredit: 0.0066,
    savings: '27%',
    estimates: [
      { label: '~300 daily scans', count: 300 },
    ],
  },
  {
    id: 'max',
    name: 'Max',
    credits: 40000,
    price: 19900,
    perCredit: 0.005,
    savings: '45%',
    estimates: [
      { label: '~800 daily scans', count: 800 },
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
  const [showFormula, setShowFormula] = useState(false)

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
      if (import.meta.env.DEV) console.error('Checkout error:', err)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pricing-dialog sm:max-w-lg w-full">
        <div className="px-6 pt-6 pb-6 space-y-5 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Credits</DialogTitle>
            <DialogDescription>
              {isAuthenticated && profile
                ? <>{(profile.credits_balance || 0).toLocaleString()} credits remaining</>
                : <>1 credit = 1 account scanned</>
              }
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {/* Credit packs — compact rows */}
          <div className="pricing-packs space-y-2">
            {CREDIT_PACKS.map(pack => (
              <button
                key={pack.id}
                className={cn(
                  "credit-pack w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                  "hover:border-foreground/20",
                  pack.recommended && "recommended border-primary/60 bg-primary/[0.03]"
                )}
                onClick={() => handleBuyCredits(pack.id)}
                disabled={!!loadingPack}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{pack.name}</span>
                    {pack.savings && (
                      <span className="text-[10px] text-muted-foreground/70">-{pack.savings}</span>
                    )}
                    {pack.recommended && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">Popular</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {pack.credits.toLocaleString()} credits
                    <span className="mx-1 opacity-40">·</span>
                    {pack.estimates[0]?.label}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  {loadingPack === pack.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPrice(pack.price)}
                      {recurring && <span className="text-xs font-normal text-muted-foreground">/mo</span>}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Auto-refill — subtle inline toggle */}
          <label className="flex items-center justify-between cursor-pointer py-1">
            <span className="text-sm text-muted-foreground">Auto-refill monthly</span>
            <Switch checked={recurring} onCheckedChange={setRecurring} />
          </label>

          {/* How credits work — collapsible */}
          <div className="space-y-2">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              onClick={() => setShowFormula(v => !v)}
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", !showFormula && "-rotate-90")} />
              How credits work
            </button>
            {showFormula && (
              <div className="text-xs text-muted-foreground/70 space-y-0.5 pl-4.5">
                <p>Credits = accounts × range × model</p>
                <p>Range: today ×1 · 3d ×2 · week ×3 · 2w ×5 · month ×8</p>
                <p>Model: Haiku ×0.25 · Sonnet ×1 · Opus ×5</p>
                <p className="pt-1 text-muted-foreground/50">Example: 200 accounts × today × Haiku = 50 credits</p>
              </div>
            )}
          </div>

          {/* Free tier — single line */}
          <p className="text-xs text-muted-foreground/50 text-center">
            Free tier: bring your own API keys for unlimited scans.
          </p>

          {/* Manage subscription */}
          {profile?.subscription_status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleManageBilling}
              disabled={!!loadingPack}
            >
              {loadingPack === 'portal' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Manage subscription'
              )}
            </Button>
          )}

          {!isAuthenticated && (
            <p className="text-sm text-muted-foreground text-center">
              Sign in to purchase credits.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground/40 text-center">
            Payments by Stripe. Apple Pay & Google Pay supported.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
