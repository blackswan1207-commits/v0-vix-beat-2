'use client'

import { AlertTriangle } from 'lucide-react'
import type { HistoricalPoint } from '@/lib/types'
import { Sparkline } from './sparkline'

interface MetricPanelProps {
  title: string
  value: number | null
  change?: number | null
  unit?: string
  history: HistoricalPoint[]
  error?: string
  subtitle?: string
  extraInfo?: React.ReactNode
  sparklineColor?: string
  /** If true, positive = red (up), negative = green (down). If false, reversed. */
  invertColor?: boolean
}

function formatValue(value: number | null, unit?: string): string {
  if (value === null) return '--'
  const formatted = Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)
  return unit === '%' ? `${formatted}%` : formatted
}

function getChangeColor(change: number | null, invert: boolean): string {
  if (change === null || change === 0) return 'text-foreground'
  // Default: positive = red (up arrow), negative = green (down)
  // For Fear & Greed or AAII where positive is "bullish", we might invert
  if (invert) {
    return change > 0 ? 'text-terminal-green' : 'text-terminal-red'
  }
  return change > 0 ? 'text-terminal-red' : 'text-terminal-green'
}

function getChangeArrow(change: number | null): string {
  if (change === null || change === 0) return ''
  return change > 0 ? '\u25B2' : '\u25BC'
}

export function MetricPanel({
  title,
  value,
  change,
  unit,
  history,
  error,
  subtitle,
  extraInfo,
  sparklineColor = '#ff8c00',
  invertColor = false,
}: MetricPanelProps) {
  return (
    <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
          {title}
        </h3>
        <div className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-blink-dot" aria-hidden="true" />
      </div>

      {/* Error State */}
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle className="h-5 w-5 text-terminal-red" />
          <p className="text-terminal-red text-[10px] leading-tight">{error}</p>
        </div>
      ) : (
        <>
          {/* Value */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tabular-nums animate-pulse-glow">
              {formatValue(value, unit)}
            </span>
            {change !== undefined && change !== null && (
              <span className={`text-xs font-bold tabular-nums ${getChangeColor(change, invertColor)}`}>
                {getChangeArrow(change)} {Math.abs(change).toFixed(2)}
              </span>
            )}
          </div>

          {/* Subtitle / extra info */}
          {subtitle && (
            <p className="text-terminal-dim text-[10px]">{subtitle}</p>
          )}
          {extraInfo}

          {/* Sparkline */}
          <div className="mt-auto">
            <Sparkline data={history} color={sparklineColor} height={36} />
          </div>
        </>
      )}
    </div>
  )
}
