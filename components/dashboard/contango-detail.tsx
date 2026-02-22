'use client'

interface ContangoDetailProps {
  f1: number | null | undefined
  f2: number | null | undefined
  spread: number | null | undefined
}

export function ContangoDetail({ f1, f2, spread }: ContangoDetailProps) {
  if (f1 == null && f2 == null) return null

  return (
    <div className="grid grid-cols-3 gap-1 text-[10px]">
      <div className="flex flex-col">
        <span className="text-terminal-dim">VIX(F1)</span>
        <span className="text-foreground font-bold tabular-nums">
          {f1 != null ? f1.toFixed(2) : '--'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-terminal-dim">VIX(F2)</span>
        <span className="text-foreground font-bold tabular-nums">
          {f2 != null ? f2.toFixed(2) : '--'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-terminal-dim">Spread</span>
        <span className="text-foreground font-bold tabular-nums">
          {spread != null ? spread.toFixed(2) : '--'}
        </span>
      </div>
    </div>
  )
}
