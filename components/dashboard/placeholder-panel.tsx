'use client'

import { Plus } from 'lucide-react'

export function PlaceholderPanel() {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-terminal-border bg-terminal-panel p-3 min-h-[160px] gap-2 cursor-pointer hover:border-terminal-orange transition-colors group">
      <div className="h-10 w-10 rounded-full border border-terminal-dim flex items-center justify-center group-hover:border-terminal-orange transition-colors">
        <Plus className="h-5 w-5 text-terminal-dim group-hover:text-terminal-orange transition-colors" />
      </div>
      <p className="text-terminal-dim text-[10px] uppercase tracking-wider group-hover:text-terminal-orange transition-colors">
        Add Indicator
      </p>
      <p className="text-terminal-dim text-[9px]">Phase 2 Expansion</p>
    </div>
  )
}
