'use client'

interface FearGreedGaugeProps {
  score: number | null
  classification?: string
}

function getGaugeColor(score: number): string {
  if (score <= 25) return '#ff3b3b' // Extreme Fear - red
  if (score <= 45) return '#ff8c00' // Fear - orange
  if (score <= 55) return '#d4a843' // Neutral - gold
  if (score <= 75) return '#4fc3f7' // Greed - cyan
  return '#00c853' // Extreme Greed - green
}

export function FearGreedGauge({ score, classification }: FearGreedGaugeProps) {
  if (score === null) return null

  const color = getGaugeColor(score)
  const percentage = Math.min(Math.max(score, 0), 100)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Gauge bar */}
      <div className="relative h-2 w-full bg-terminal-border rounded-sm overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-all duration-500"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
        {/* Marker lines at 25, 50, 75 */}
        <div className="absolute inset-y-0 left-1/4 w-px bg-terminal-dim opacity-50" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-terminal-dim opacity-50" />
        <div className="absolute inset-y-0 left-3/4 w-px bg-terminal-dim opacity-50" />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[9px]">
        <span className="text-terminal-red">Extreme Fear</span>
        {classification && (
          <span className="font-bold" style={{ color }}>
            {classification}
          </span>
        )}
        <span className="text-terminal-green">Extreme Greed</span>
      </div>
    </div>
  )
}
