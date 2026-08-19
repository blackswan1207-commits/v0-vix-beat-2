/**
 * Simple in-memory cache for server-side data.
 * Data is cached for 2 hours to minimize API calls.
 * Historical data is accumulated over time (up to 10 trading days).
 */

import type { HistoricalPoint } from './types'

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

const CACHE_DURATION = 2 * 60 * 60 * 1000 // 2 hours in milliseconds

// 上游偶發失敗導致的「降級 payload」只快取 5 分鐘。
// 2026-08-19 教訓：Gist relay 抓不到時整片欄位變 null，卻照樣進 2 小時快取，
// 一次幾秒的抽風就讓全網看到壞資料最久 3 小時（CDN 再疊一層），
// 隔天早上健檢撞上就發假警報。短 TTL 讓它自己快速痊癒。
export const DEGRADED_CACHE_DURATION = 5 * 60 * 1000

const cache = new Map<string, CacheEntry<unknown>>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCache<T>(key: string, data: T, ttlMs: number = CACHE_DURATION): void {
  cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs })
}

/**
 * 最後一份「好資料」，不設過期。
 * 用途：上游單次抓取失敗時拿來墊檔，避免面板整片空白 —— 月更資料沿用上一份
 * 完全不影響判讀，總比顯示空白、再讓健檢半夜發假警報好。
 * 注意：serverless 實例回收後會清空，所以它是「減災」不是「保證」，
 * 真正讓系統自癒的是上面的 DEGRADED_CACHE_DURATION。
 */
const lastGoodStore = new Map<string, unknown>()

export function setLastGood<T>(key: string, data: T): void {
  lastGoodStore.set(key, data)
}

export function getLastGood<T>(key: string): T | null {
  return (lastGoodStore.get(key) as T | undefined) ?? null
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
