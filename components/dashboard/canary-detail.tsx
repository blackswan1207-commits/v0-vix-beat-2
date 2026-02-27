'use client'

interface CanaryDetailProps {
  vwoMomentum: number | null | undefined
  bndMomentum: number | null | undefined
  n: number | undefined
  vwoReturns?: {
    m1: number | null
    m3: number | null
    m6: number | null
    m12: number | null
  }
  bndReturns?: {
    m1: number | null
    m3: number | null
    m6: number | null
    m12: number | null
  }
}

function formatPercent(val: number | null | undefined): string {
  if (val == null) return '--'
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
}

function formatMomentum(val: number | null | undefined): string {
  if (val == null) return '--'
  return val.toFixed(4)
}

export function CanaryDetail({
  vwoMomentum,
  bndMomentum,
  n,
  vwoReturns,
  bndReturns,
}: CanaryDetailProps) {
  const vwoPositive = vwoMomentum != null && vwoMomentum > 0
  const bndPositive = bndMomentum != null && bndMomentum > 0

  return (
    <div className="space-y-2 text-[10px]">
      {/* Momentum Summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-terminal-dim">VWO(M)</span>
          <span
            className={`font-bold tabular-nums ${
              vwoPositive ? 'text-terminal-green' : 'text-terminal-red'
            }`}
          >
            {formatMomentum(vwoMomentum)}
            <span className="text-[8px] ml-1">{vwoPositive ? '>0' : '<=0'}</span>
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-terminal-dim">BND(M)</span>
          <span
            className={`font-bold tabular-nums ${
              bndPositive ? 'text-terminal-green' : 'text-terminal-red'
            }`}
          >
            {formatMomentum(bndMomentum)}
            <span className="text-[8px] ml-1">{bndPositive ? '>0' : '<=0'}</span>
          </span>
        </div>
      </div>

      {/* N value */}
      <div className="flex items-center gap-2 text-terminal-dim">
        <span>N (positive count) =</span>
        <span className="text-foreground font-bold">{n ?? '--'}</span>
      </div>

      {/* Returns breakdown (collapsible details) */}
      <details className="text-[9px]">
        <summary className="cursor-pointer text-terminal-dim hover:text-foreground">
          View Return Breakdown
        </summary>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 pl-2 border-l border-terminal-border">
          <div className="text-terminal-dim">VWO 1M:</div>
          <div className={`tabular-nums ${(vwoReturns?.m1 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(vwoReturns?.m1)}
          </div>
          <div className="text-terminal-dim">VWO 3M:</div>
          <div className={`tabular-nums ${(vwoReturns?.m3 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(vwoReturns?.m3)}
          </div>
          <div className="text-terminal-dim">VWO 6M:</div>
          <div className={`tabular-nums ${(vwoReturns?.m6 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(vwoReturns?.m6)}
          </div>
          <div className="text-terminal-dim">VWO 12M:</div>
          <div className={`tabular-nums ${(vwoReturns?.m12 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(vwoReturns?.m12)}
          </div>
          <div className="col-span-2 h-px bg-terminal-border/50 my-0.5" />
          <div className="text-terminal-dim">BND 1M:</div>
          <div className={`tabular-nums ${(bndReturns?.m1 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(bndReturns?.m1)}
          </div>
          <div className="text-terminal-dim">BND 3M:</div>
          <div className={`tabular-nums ${(bndReturns?.m3 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(bndReturns?.m3)}
          </div>
          <div className="text-terminal-dim">BND 6M:</div>
          <div className={`tabular-nums ${(bndReturns?.m6 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(bndReturns?.m6)}
          </div>
          <div className="text-terminal-dim">BND 12M:</div>
          <div className={`tabular-nums ${(bndReturns?.m12 ?? 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatPercent(bndReturns?.m12)}
          </div>
        </div>
      </details>
    </div>
  )
}
