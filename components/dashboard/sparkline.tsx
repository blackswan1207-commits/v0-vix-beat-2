'use client'

import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip } from 'recharts'
import type { HistoricalPoint } from '@/lib/types'

interface SparklineProps {
  data: HistoricalPoint[]
  color?: string
  height?: number
}

export function Sparkline({ data, color = '#ff8c00', height = 40 }: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center text-terminal-dim text-[10px]" style={{ height }}>
        Accumulating data...
      </div>
    )
  }

  const first = data[0]?.value ?? 0
  const last = data[data.length - 1]?.value ?? 0
  const trendColor = last >= first ? '#ff3b3b' : '#00c853'
  const lineColor = color === 'auto' ? trendColor : color

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <YAxis domain={['auto', 'auto']} hide />
        <Tooltip
          contentStyle={{
            background: '#0a0a0a',
            border: '1px solid #2a2a2a',
            borderRadius: '2px',
            fontSize: '10px',
            color: '#c8c8c8',
          }}
          formatter={(value: number) => [value.toFixed(2), '']}
          labelFormatter={(label: string) => label}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2, fill: lineColor }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
