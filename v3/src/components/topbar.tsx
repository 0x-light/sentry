import { useSentry } from '@/hooks/use-sentry'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Settings, Sun, Moon, Radio, Clock, Loader2 } from '@/components/icons'

export function Topbar() {
  const {
    theme, toggleTheme, liveEnabled, isLiveMode, toggleLive, openSettings, busy,
    schedules, nextScheduleLabel,
  } = useSentry()
  const { isAuthenticated, user, profile } = useAuth()

  const hasActiveSchedules = schedules.some(s => s.enabled)
  const isScheduleRunning = schedules.some(s => s.last_run_status === 'running')

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
        {(hasActiveSchedules || isScheduleRunning) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSettings('schedule')}
                className={cn(
                  "gap-1.5",
                  isScheduleRunning && "text-signal-blue"
                )}
              >
                {isScheduleRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-sm font-normal">Scanning…</span>
                  </>
                ) : (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    {nextScheduleLabel && (
                      <span className="text-sm font-normal hidden sm:inline">{nextScheduleLabel}</span>
                    )}
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isScheduleRunning ? 'Scheduled scan running…' : `Next scan ${nextScheduleLabel || 'scheduled'}`}</p>
            </TooltipContent>
          </Tooltip>
        )}
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
                {profile?.has_credits
                  ? `${(profile.credits_balance || 0).toLocaleString()} cr`
                  : 'free'}
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
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => openSettings()}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
