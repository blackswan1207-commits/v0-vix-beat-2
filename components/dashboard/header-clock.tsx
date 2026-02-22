'use client'

import { useEffect, useState } from 'react'

function formatDateTime(locale: string, tz: string): { date: string; time: string; dayOfWeek: string } {
  const now = new Date()
  const dateStr = now.toLocaleDateString(locale, {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeStr = now.toLocaleTimeString(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const dayOfWeek = now.toLocaleDateString(locale === 'zh-TW' ? 'zh-TW' : 'en-US', {
    timeZone: tz,
    weekday: locale === 'zh-TW' ? 'narrow' : 'short',
  })
  return { date: dateStr, time: timeStr, dayOfWeek }
}

export function HeaderClock() {
  const [tw, setTw] = useState({ date: '--', time: '--:--:--', dayOfWeek: '--' })
  const [us, setUs] = useState({ date: '--', time: '--:--:--', dayOfWeek: '--' })

  useEffect(() => {
    function tick() {
      setTw(formatDateTime('zh-TW', 'Asia/Taipei'))
      setUs(formatDateTime('en-US', 'America/New_York'))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-6 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-terminal-gold font-bold">TPE</span>
        <span className="text-foreground">{tw.date}</span>
        <span className="text-terminal-dim">{tw.dayOfWeek}</span>
        <span className="text-terminal-green font-bold tabular-nums">{tw.time}</span>
      </div>
      <div className="h-3 w-px bg-terminal-border" />
      <div className="flex items-center gap-2">
        <span className="text-terminal-gold font-bold">NYC</span>
        <span className="text-foreground">{us.date}</span>
        <span className="text-terminal-dim">{us.dayOfWeek}</span>
        <span className="text-terminal-green font-bold tabular-nums">{us.time}</span>
      </div>
    </div>
  )
}
