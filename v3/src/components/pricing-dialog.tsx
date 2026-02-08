import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from '@/components/icons'
import * as api from '@/lib/api'

// Plans with features — matches backend schema
const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    description: 'Try Sentry with your own API keys',
    amount: 0,
    interval: 'month',
    features: [
      'Bring your own API keys',
      'Up to 3 scans per month',
      'Up to 10 accounts per scan',
      'Basic analysis cache',
    ],
    scansPerMonth: 3,
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    description: 'For active traders who scan daily',
    amount: 1900,
    interval: 'month',
    features: [
      'Managed API keys (no setup)',
      '100 scans per month',
      'Unlimited accounts per scan',
      'Live feed mode',
      'All models including Opus',
      'Custom analysts',
      '30-day scan history',
    ],
    scansPerMonth: 100,
    recommended: true,
  },
  {
    id: 'ultra' as const,
    name: 'Ultra',
    description: 'For power users and teams',
    amount: 4900,
    interval: 'month',
    features: [
      'Everything in Pro',
      'Unlimited scans',
      'Scheduled scans',
      'API access',
      'Unlimited scan history',
      'Priority analysis queue',
      'Priority support',
    ],
    scansPerMonth: 'unlimited' as const,
  },
]

interface PricingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PricingDialog({ open, onOpenChange }: PricingDialogProps) {
  const { isAuthenticated, profile } = useAuth()
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubscribe = async (planId: 'pro' | 'ultra') => {
    if (!isAuthenticated) return
    setLoadingPlan(planId)
    setError(null)
    try {
      const { url } = await api.createCheckoutSession({
        plan: planId,
        successUrl: window.location.origin + '/?billing=success',
        cancelUrl: window.location.origin + '/?billing=cancel',
      })
      if (url) {
        window.location.href = url
      }
    } catch (err: any) {
      console.error('Checkout error:', err)
      setError(err.message || 'Failed to start checkout')
    } finally {
      setLoadingPlan(null)
    }
  }

  const handleManageBilling = async () => {
    if (!isAuthenticated) return
    setLoadingPlan('portal')
    setError(null)
    try {
      const { url } = await api.getBillingPortalUrl()
      if (url) {
        window.location.href = url
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open billing portal')
    } finally {
      setLoadingPlan(null)
    }
  }

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'usd',
      minimumFractionDigits: 0,
    }).format(amount / 100)
  }

  const currentPlan = profile?.subscription_status === 'active'
    ? (profile as any)?.plan || 'pro'
    : 'free'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg w-full">
        <SheetHeader>
          <SheetTitle>Pricing</SheetTitle>
          <SheetDescription>Choose a plan that fits your trading needs.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {PLANS.map(plan => {
            const isCurrent = currentPlan === plan.id
            const isFree = plan.amount === 0

            return (
              <div
                key={plan.id}
                className={cn(
                  "p-4 rounded-lg border space-y-3",
                  plan.recommended && "border-primary ring-1 ring-primary"
                )}
              >
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{plan.name}</h4>
                  {plan.recommended && (
                    <Badge variant="default" className="text-xs">Recommended</Badge>
                  )}
                  {isCurrent && (
                    <Badge variant="outline" className="text-xs text-signal-green">Current</Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">{plan.description}</p>

                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold">
                    {isFree ? 'Free' : formatPrice(plan.amount)}
                  </span>
                  {!isFree && (
                    <span className="text-sm text-muted-foreground">/{plan.interval}</span>
                  )}
                </div>

                <ul className="space-y-1.5">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="h-3.5 w-3.5 text-signal-green mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {!isFree && !isCurrent && (
                  <Button
                    className="w-full"
                    variant={plan.recommended ? 'default' : 'outline'}
                    onClick={() => handleSubscribe(plan.id as 'pro' | 'ultra')}
                    disabled={!!loadingPlan || !isAuthenticated}
                  >
                    {loadingPlan === plan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Subscribe'
                    )}
                  </Button>
                )}

                {isCurrent && !isFree && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={handleManageBilling}
                    disabled={!!loadingPlan}
                  >
                    {loadingPlan === 'portal' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Manage subscription'
                    )}
                  </Button>
                )}
              </div>
            )
          })}

          {!isAuthenticated && (
            <>
              <Separator />
              <p className="text-sm text-muted-foreground text-center">
                Sign in to subscribe or start your free plan.
              </p>
            </>
          )}

          {/* Payment methods info */}
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
