import { useSentry } from '@/hooks/use-sentry'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Settings, Sun, Moon, Radio } from '@/components/icons'

export function Topbar() {
  const { theme, toggleTheme, liveEnabled, isLiveMode, toggleLive, openSettings, busy } = useSentry()
  const { isAuthenticated, user, profile } = useAuth()

  return (
    <div className="flex items-center justify-between px-4 h-14 border-b">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-2 h-3 bg-foreground rounded-[2px] transition-opacity",
            busy && "animate-blink"
          )}
        />
        <span className="font-normal text-sm tracking-tight">sentry</span>
      </div>
      <div className="flex items-center gap-1">
        {liveEnabled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLive}
            className={cn(
              "gap-1.5",
              isLiveMode && "text-signal-green"
            )}
          >
            <Radio className={cn("h-3.5 w-3.5", isLiveMode && "animate-pulse")} />
            <span className="text-sm font-normal">Live</span>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {isAuthenticated ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => openSettings('account')}
          >
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs text-primary font-medium">
                  {(user?.email?.[0] || '?').toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-normal hidden sm:inline max-w-[120px] truncate">
                {profile?.scans_remaining != null
                  ? profile.scans_remaining === -1
                    ? '∞ scans'
                    : `${profile.scans_remaining} scans`
                  : ''}
              </span>
            </div>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openSettings('auth')}
          >
            <span className="text-sm font-normal">Sign in</span>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => openSettings()}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
