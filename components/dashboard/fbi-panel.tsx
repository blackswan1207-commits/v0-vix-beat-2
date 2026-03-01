'use client'

import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import type { FbiData } from '@/lib/types'

interface FbiPanelProps {
  data: FbiData | undefined
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return iso
  }
}

export function FbiPanel({ data }: FbiPanelProps) {
  return (
    <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px] lg:col-span-2">
      <div className="flex items-center justify-between">
        <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
          FBI股票排行 (Fund Bias Index)
        </h3>
        <div className="flex items-center gap-2">
          {data?.dataDate && (
            <span className="text-[9px] text-terminal-dim">淨值日期: {data.dataDate}</span>
          )}
          <div className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-blink-dot" aria-hidden="true" />
        </div>
      </div>

      {data?.error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle className="h-5 w-5 text-terminal-red" />
          <p className="text-terminal-red text-[10px] leading-tight">{data.error}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 flex-1">
            {/* Negative Bias Column */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown className="h-3 w-3 text-terminal-red" />
                <span className="text-terminal-red text-[10px] font-bold uppercase">負乖離 Top 5</span>
              </div>
              {data?.negativeBias && data.negativeBias.length > 0 ? (
                <div className="space-y-1">
                  {data.negativeBias.map((item, idx) => (
                    <div
                      key={`neg-${idx}`}
                      className="flex items-center justify-between text-[11px] py-0.5 border-b border-terminal-border/30 last:border-b-0"
                    >
                      <span className="text-foreground truncate max-w-[120px]" title={item.name}>
                        {idx + 1}. {item.name}
                      </span>
                      <span className="text-terminal-red font-bold tabular-nums">
                        {item.value.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-terminal-dim text-[10px]">無資料</p>
              )}
            </div>

            {/* Positive Bias Column */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3 text-terminal-green" />
                <span className="text-terminal-green text-[10px] font-bold uppercase">正乖離 Top 5</span>
              </div>
              {data?.positiveBias && data.positiveBias.length > 0 ? (
                <div className="space-y-1">
                  {data.positiveBias.map((item, idx) => (
                    <div
                      key={`pos-${idx}`}
                      className="flex items-center justify-between text-[11px] py-0.5 border-b border-terminal-border/30 last:border-b-0"
                    >
                      <span className="text-foreground truncate max-w-[120px]" title={item.name}>
                        {idx + 1}. {item.name}
                      </span>
                      <span className="text-terminal-green font-bold tabular-nums">
                        +{item.value.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-terminal-dim text-[10px]">無資料</p>
              )}
            </div>
          </div>

          {/* Footer */}
          {(data?.lastUpdated || data?.dataSource) && (
            <div className="flex items-center justify-between text-[9px] text-terminal-dim pt-1 border-t border-terminal-border/50">
              {data?.lastUpdated && <span>{formatTimestamp(data.lastUpdated)}</span>}
              {data?.dataSource && <span>via {data.dataSource}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
