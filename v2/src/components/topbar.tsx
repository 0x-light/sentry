import { useSentry } from '@/hooks/use-sentry'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Settings, Sun, Moon, Radio } from 'lucide-react'

export function Topbar() {
  const { theme, toggleTheme, liveEnabled, isLiveMode, toggleLive, openSettings, busy } = useSentry()

  return (
    <div className="flex items-center justify-between px-4 h-14 border-b">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-2 h-5 bg-foreground rounded-[2px] transition-opacity",
            busy && "animate-blink"
          )}
        />
        <span className="font-normal text-sm tracking-tight">sentry</span>
        <span className="text-xs text-muted-foreground font-normal">v2</span>
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
            <span className="text-xs font-normal">Live</span>
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
