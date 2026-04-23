'use client'

import { AlertTriangle } from 'lucide-react'
import type { CycleData, CycleStage, FedPolicy } from '@/lib/types'

interface CyclePanelProps {
  data: CycleData | undefined
}

const STAGE_CONFIG: Record<CycleStage, { label: string; color: string; bg: string; border: string }> = {
  Expansion: { label: '擴張', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: '#22c55e' },
  Retracement: { label: '趨緩', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: '#f59e0b' },
  Recession:   { label: '衰退', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: '#ef4444' },
  Recovery:    { label: '復甦', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: '#60a5fa' },
}

const POLICY_CONFIG: Record<FedPolicy, { label: string; color: string }> = {
  QE: { label: 'QE 寬鬆', color: '#22c55e' },
  QN: { label: 'QN 中性', color: '#94a3b8' },
  QT: { label: 'QT 緊縮', color: '#ef4444' },
}

function StageBadge({ stage }: { stage: CycleStage | null }) {
  if (!stage) return <span className="text-terminal-dim text-[10px]">--</span>
  const cfg = STAGE_CONFIG[stage]
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      {stage} {cfg.label}
    </span>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day}`
  } catch { return iso }
}

export function CyclePanel({ data }: CyclePanelProps) {
  return (
    <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px] lg:col-span-2">
      <div className="flex items-center justify-between">
        <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
          景氣循環模型 (富邦三指標)
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-terminal-dim">Quarterly</span>
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
          {/* Final Stage — prominent display */}
          <div className="flex items-center gap-3 py-1">
            <span className="text-[10px] text-terminal-dim uppercase">最終景氣階段</span>
            {data?.finalStage ? (
              <span
                className="text-lg font-bold px-2 py-0.5 rounded border"
                style={{
                  color: STAGE_CONFIG[data.finalStage].color,
                  background: STAGE_CONFIG[data.finalStage].bg,
                  borderColor: STAGE_CONFIG[data.finalStage].border,
                }}
              >
                {data.finalStage} &nbsp;{STAGE_CONFIG[data.finalStage].label}
              </span>
            ) : (
              <span className="text-terminal-dim text-sm">--</span>
            )}
            {data?.designatedStage && data.designatedStage !== data.finalStage && (
              <span className="text-[9px] text-terminal-dim">
                (判定: {data.designatedStage} → Fed調整)
              </span>
            )}
          </div>

          {/* Three indicator rows */}
          <div className="grid grid-cols-3 gap-2 mt-1">
            {/* OECD CLI */}
            <div className="border border-terminal-border/50 rounded p-2 flex flex-col gap-1">
              <span className="text-[9px] text-terminal-dim uppercase font-bold">OECD CLI</span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {data?.oecdCli != null ? data.oecdCli.toFixed(2) : '--'}
              </span>
              <div className="flex items-center gap-1">
                {data?.oecdCliDirection && (
                  <span className={`text-[10px] ${data.oecdCliDirection === 'rising' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {data.oecdCliDirection === 'rising' ? '▲ 上升' : '▼ 下降'}
                  </span>
                )}
              </div>
              <div className="text-[9px] text-terminal-dim">NAFTA CLI vs 基準100</div>
              <StageBadge stage={data?.oecdCliStage ?? null} />
            </div>

            {/* Yield Spread */}
            <div className="border border-terminal-border/50 rounded p-2 flex flex-col gap-1">
              <span className="text-[9px] text-terminal-dim uppercase font-bold">殖利率利差</span>
              <span className={`text-sm font-bold tabular-nums ${
                data?.yieldSpread != null
                  ? data.yieldSpread >= 0 ? 'text-terminal-green' : 'text-terminal-red'
                  : 'text-foreground'
              }`}>
                {data?.yieldSpread != null ? `${data.yieldSpread.toFixed(2)}%` : '--'}
              </span>
              {data?.yieldSpreadAvg != null && (
                <div className="text-[9px] text-terminal-dim">
                  10Y avg: {data.yieldSpreadAvg.toFixed(2)}%
                </div>
              )}
              <div className="text-[9px] text-terminal-dim">10Y − 3M</div>
              <StageBadge stage={data?.yieldSpreadStage ?? null} />
            </div>

            {/* Fed Policy */}
            <div className="border border-terminal-border/50 rounded p-2 flex flex-col gap-1">
              <span className="text-[9px] text-terminal-dim uppercase font-bold">Fed 政策</span>
              {data?.fedPolicy ? (
                <span
                  className="text-sm font-bold"
                  style={{ color: POLICY_CONFIG[data.fedPolicy].color }}
                >
                  {POLICY_CONFIG[data.fedPolicy].label}
                </span>
              ) : (
                <span className="text-sm font-bold text-terminal-dim">--</span>
              )}
              {data?.fedAssetsChangeQoQ != null && (
                <div className="text-[9px] text-terminal-dim">
                  季增: {data.fedAssetsChangeQoQ >= 0 ? '+' : ''}{data.fedAssetsChangeQoQ.toFixed(2)}%
                </div>
              )}
              <div className="text-[9px] text-terminal-dim">Fed 總資產 QoQ</div>
              <span className="text-[9px] text-terminal-dim mt-auto">最終修正因子</span>
            </div>
          </div>

          {/* Footer */}
          {data?.lastUpdated && (
            <div className="flex items-center justify-between text-[9px] text-terminal-dim pt-1 border-t border-terminal-border/50">
              <span>{formatTimestamp(data.lastUpdated)}</span>
              {data?.dataSource && <span>via {data.dataSource}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
