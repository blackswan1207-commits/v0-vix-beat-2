/**
 * Simple in-memory cache for server-side data.
 * Data is cached for 2 hours to minimize API calls.
 * Historical data is accumulated over time (up to 10 trading days).
 */

import type { HistoricalPoint } from './types'

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const CACHE_DURATION = 2 * 60 * 60 * 1000 // 2 hours in milliseconds

const cache = new Map<string, CacheEntry<unknown>>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_DURATION) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

/**
 * Accumulated historical data store.
 * We store up to 10 data points per indicator.
 * New data points are appended daily (by date key) to avoid duplicates.
 */
const historyStore = new Map<string, HistoricalPoint[]>()

export function appendHistory(key: string, point: HistoricalPoint): HistoricalPoint[] {
  const existing = historyStore.get(key) || []
  // Avoid duplicate dates
  const alreadyExists = existing.some((p) => p.date === point.date)
  if (!alreadyExists) {
    existing.push(point)
  }
  // Keep only the last 10 data points
  const trimmed = existing.slice(-10)
  historyStore.set(key, trimmed)
  return trimmed
}

export function getHistory(key: string): HistoricalPoint[] {
  return historyStore.get(key) || []
}

/**
 * Get count of accumulated history data points
 */
export function getHistoryCount(): number {
  // Return the count from any indicator (they all accumulate at the same rate)
  const keys = Array.from(historyStore.keys())
  if (keys.length === 0) return 0
  const firstHistory = historyStore.get(keys[0]) || []
  return firstHistory.length
}
