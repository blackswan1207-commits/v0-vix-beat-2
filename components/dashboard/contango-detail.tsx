'use client'

interface ContangoDetailProps {
  f1: number | null | undefined
  f2: number | null | undefined
  f1Symbol?: string
  f2Symbol?: string
  spread: number | null | undefined
}

export function ContangoDetail({ f1, f2, f1Symbol, f2Symbol, spread }: ContangoDetailProps) {
  if (f1 == null && f2 == null) return null

  const f1Label = f1Symbol || 'VIX(F1)'
  const f2Label = f2Symbol || 'VIX(F2)'

  return (
    <div className="grid grid-cols-3 gap-1 text-[10px]">
      <div className="flex flex-col">
        <span className="text-terminal-dim truncate" title={f1Label}>{f1Label}</span>
        <span className="text-foreground font-bold tabular-nums">
          {f1 != null ? f1.toFixed(3) : '--'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-terminal-dim truncate" title={f2Label}>{f2Label}</span>
        <span className="text-foreground font-bold tabular-nums">
          {f2 != null ? f2.toFixed(3) : '--'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-terminal-dim">Spread</span>
        <span className="text-foreground font-bold tabular-nums">
          {spread != null ? spread.toFixed(3) : '--'}
        </span>
      </div>
    </div>
  )
}
