import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Loader2 } from '@/components/icons'

interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: 'login' | 'signup'
}

export function AuthDialog({ open, onOpenChange, defaultTab = 'login' }: AuthDialogProps) {
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth()

  const [tab, setTab] = useState<string>(defaultTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password')
      return
    }
    setError('')
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      onOpenChange(false)
      setEmail('')
      setPassword('')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setError('')
    setLoading(true)
    try {
      await signUp(email.trim(), password)
      setMessage('Check your email for a confirmation link!')
      setError('')
    } catch (err: any) {
      setError(err.message || 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError('')
    setLoading(true)
    try {
      await signInWithGoogle()
    } catch (err: any) {
      setError(err.message || 'Google login failed')
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('Please enter your email first')
      return
    }
    setError('')
    setLoading(true)
    try {
      await resetPassword(email.trim())
      setMessage('Password reset email sent!')
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md w-full">
        <SheetHeader>
          <SheetTitle>Welcome to Sentry</SheetTitle>
          <SheetDescription>Sign in to sync your data, unlock scans, and manage your subscription.</SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Log in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>

          {/* Login Tab */}
          <TabsContent value="login" className="space-y-4 mt-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-signal-green">{message}</p>}

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin() }}
                placeholder="you@email.com"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin() }}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleLogin} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log in'}
              </Button>
            </div>

            <button
              onClick={handleResetPassword}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </button>

            <Separator />

            <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading}>
              Continue with Google
            </Button>
          </TabsContent>

          {/* Sign Up Tab */}
          <TabsContent value="signup" className="space-y-4 mt-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-signal-green">{message}</p>}

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSignUp() }}
                placeholder="you@email.com"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSignUp() }}
                placeholder="Min 6 characters"
                disabled={loading}
              />
            </div>

            <Button className="w-full" onClick={handleSignUp} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create account'}
            </Button>

            <Separator />

            <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading}>
              Continue with Google
            </Button>

            <p className="text-sm text-muted-foreground text-center">
              By signing up, you agree to our Terms of Service.
            </p>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
