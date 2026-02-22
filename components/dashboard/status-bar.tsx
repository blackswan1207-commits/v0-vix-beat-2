'use client'

import { RefreshCw } from 'lucide-react'

interface StatusBarProps {
  lastUpdated: string | null
  isLoading: boolean
  onRefresh: () => void
  errorCount: number
}

export function StatusBar({ lastUpdated, isLoading, onRefresh, errorCount }: StatusBarProps) {
  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Taipei',
      })
    : '--:--:--'

  return (
    <div className="flex items-center justify-between border-t border-terminal-border bg-terminal-panel px-4 py-1.5 text-[10px]">
      <div className="flex items-center gap-4">
        <span className="text-terminal-dim">
          LAST UPDATE: <span className="text-foreground tabular-nums">{formattedTime} TPE</span>
        </span>
        <span className="text-terminal-dim">
          REFRESH: <span className="text-terminal-gold">2H INTERVAL</span>
        </span>
        {errorCount > 0 && (
          <span className="text-terminal-red">
            {errorCount} SOURCE{errorCount > 1 ? 'S' : ''} OFFLINE
          </span>
        )}
      </div>
      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="flex items-center gap-1 text-terminal-dim hover:text-terminal-orange transition-colors disabled:opacity-50"
        aria-label="Refresh data"
      >
        <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        <span>REFRESH</span>
      </button>
    </div>
  )
}
