export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getCached, setCache, appendHistory, getHistory, getHistoryCount } from '@/lib/cache'
import type {
  SentimentPayload,
  IndicatorData,
  ContangoData,
  FearGreedData,
  CryptoFearGreedData,
  CanaryData,
  FbiData,
  FbiRankingItem,
  CycleData,
  CycleStage,
  FedPolicy,
  TaiwanCLIData,
} from '@/lib/types'
import { TAIWAN_CLI_HISTORY } from '@/lib/taiwan-cli-data'

const CACHE_KEY = 'sentiment-data'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function makeError(label: string, error: string): IndicatorData {
  return {
    label,
    value: null,
    change: null,
    history: getHistory(label),
    error,
    lastUpdated: new Date().toISOString(),
  }
}

// ── VIX / VVIX via Yahoo Finance v8 chart API ──
async function fetchYahooQuote(
  symbol: string
): Promise<{ price: number; previousClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`)
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) throw new Error('No meta in Yahoo response')
    return {
      price: meta.regularMarketPrice ?? meta.previousClose,
      previousClose: meta.chartPreviousClose ?? meta.previousClose,
    }
  } catch {
    return null
  }
}

async function fetchYahooWithHistory(
  symbol: string
): Promise<{ price: number; previousClose: number; history: HistoricalPoint[] } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=14d&interval=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`)
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) throw new Error('No result in Yahoo response')

    const meta = result.meta
    const timestamps: number[] = result.timestamp || []
    const closes: number[] = result.indicators?.quote?.[0]?.close || []

    const history: HistoricalPoint[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]
      const close = closes[i]
      if (ts == null || close == null || isNaN(close)) continue
      history.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), value: close })
    }

    return {
      price: meta.regularMarketPrice ?? meta.previousClose,
      previousClose: meta.chartPreviousClose ?? meta.previousClose,
      history,
    }
  } catch {
    return null
  }
}

async function fetchVIX(): Promise<IndicatorData> {
  const label = 'VIX'
  try {
    const result = await fetchYahooWithHistory('^VIX')
    if (!result) throw new Error('Yahoo Finance VIX request failed')

    const change = result.price - result.previousClose
    const history = result.history.length >= 2
      ? result.history
      : appendHistory(label, { date: todayStr(), value: result.price })

    return {
      label,
      value: result.price,
      change,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: 'Yahoo Finance',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return makeError(label, `Error: 無法取得真實連線 - ${msg}`)
  }
}

async function fetchVVIX(): Promise<IndicatorData> {
  const label = 'VVIX'
  try {
    const result = await fetchYahooWithHistory('^VVIX')
    if (!result) throw new Error('Yahoo Finance VVIX request failed')

    const change = result.price - result.previousClose
    const history = result.history.length >= 2
      ? result.history
      : appendHistory(label, { date: todayStr(), value: result.price })

    return {
      label,
      value: result.price,
      change,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: 'Yahoo Finance',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return makeError(label, `Error: 無法取得真實連線 - ${msg}`)
  }
}

// ── Contango: Dynamically discover F1/F2 from TradingView Scanner API ──

interface VixFuturesContract {
  symbol: string       // e.g. "VXH2026"
  price: number        // close price
  description: string  // e.g. "Cboe Volatility Index (VIX) Futures (Mar 2026)"
  expiration: number   // YYYYMMDD integer, e.g. 20260318
}

/**
 * Query TradingView Scanner API for all currently active VIX futures.
 * Filter for standard VIX contracts (exclude Mini VXM, exclude continuous VX1!).
 * Sort by expiration ascending. Return the full list.
 */
async function fetchActiveVixFutures(): Promise<VixFuturesContract[]> {
  const body = {
    columns: ['close', 'description', 'expiration'],
    filter: [
      { left: 'exchange', operation: 'equal', right: 'CBOE' },
      { left: 'name', operation: 'match', right: 'VX' },
    ],
    options: { lang: 'en' },
    range: [0, 50],
    sort: { sortBy: 'expiration', sortOrder: 'asc' },
    symbols: {},
  }

  const res = await fetch('https://scanner.tradingview.com/futures/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`TradingView Scanner HTTP ${res.status}`)

  const json = await res.json()
  const data = json?.data
  if (!Array.isArray(data)) throw new Error('Invalid TradingView Scanner response')

  const contracts: VixFuturesContract[] = []

  for (const item of data) {
    const fullSymbol: string = item.s // e.g. "CBOE:VXH2026"
    const [, symbol] = fullSymbol.split(':') // "VXH2026"

    // Only accept standard monthly VIX futures: VX + single month letter + 4-digit year
    // e.g. VXK2026 (May), VXM2026 (June), VXN2026 (July)
    // Rejects: VX1! (continuous), VX21K2026 (weekly), VXMK2026 (Mini VIX)
    // IMPORTANT: VXM2026 = June standard — must NOT be excluded despite starting with 'VXM'
    if (!/^VX[FGHJKMNQUVXZ]\d{4}$/.test(symbol)) continue

    const [close, description, expiration] = item.d
    if (typeof close !== 'number' || !expiration) continue

    contracts.push({
      symbol,
      price: close,
      description: description || symbol,
      expiration: expiration,
    })
  }

  // Sort by expiration date ascending (nearest first)
  contracts.sort((a, b) => a.expiration - b.expiration)

  return contracts
}

// ── Contango Gist history (persistent across serverless cold starts) ──
const CONTANGO_GIST_ID = '1a486a43e09009d5afc46ebdf15c8c95'
const CONTANGO_GIST_FILE = 'contango_history.json'

async function readContangoHistory(): Promise<HistoricalPoint[]> {
  try {
    const url = `https://gist.githubusercontent.com/blackswan1207-commits/${CONTANGO_GIST_ID}/raw/${CONTANGO_GIST_FILE}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json.data) ? json.data : []
  } catch {
    return []
  }
}

async function appendContangoHistory(point: HistoricalPoint): Promise<HistoricalPoint[]> {
  const existing = await readContangoHistory()
  const alreadyExists = existing.some(p => p.date === point.date)
  if (!alreadyExists) existing.push(point)
  const trimmed = existing.slice(-10)

  const token = process.env.GITHUB_TOKEN
  if (token) {
    try {
      await fetch(`https://api.github.com/gists/${CONTANGO_GIST_ID}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: {
            [CONTANGO_GIST_FILE]: {
              content: JSON.stringify({ updated_at: point.date, data: trimmed }),
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* write failed, return what we have */ }
  }

  return trimmed
}

async function fetchContango(): Promise<ContangoData> {
  const label = 'Contango'
  let f1Label = 'VIX(F1)'
  let f2Label = 'VIX(F2)'

  try {
    let f1: number | null = null
    let f2: number | null = null
    let source = ''

    // === Primary: TradingView Scanner — discover all active contracts dynamically ===
    try {
      const contracts = await fetchActiveVixFutures()

      if (contracts.length >= 2) {
        const front = contracts[0] // Nearest expiration = F1
        const second = contracts[1] // Second nearest = F2

        f1 = front.price
        f2 = second.price
        f1Label = `${front.symbol} (${front.description.match(/\(([^)]+)\)/)?.[1] || front.symbol})`
        f2Label = `${second.symbol} (${second.description.match(/\(([^)]+)\)/)?.[1] || second.symbol})`
        source = 'TradingView'
      }
    } catch {
      // TradingView scan failed, will fall through to Yahoo
    }

    // === Fallback: Yahoo Finance VIX futures ===
    if (f1 === null || f2 === null) {
      const [vf1, vf2] = await Promise.all([
        fetchYahooQuote('VX=F'),   // Front month VIX future
        fetchYahooQuote('VX2=F'),  // Second month
      ])
      if (vf1 && f1 === null) { f1 = vf1.price; f1Label = 'VX=F (F1)' }
      if (vf2 && f2 === null) { f2 = vf2.price; f2Label = 'VX2=F (F2)' }
      source = source || 'Yahoo Finance'
    }

    if (f1 && f2 && !isNaN(f1) && !isNaN(f2)) {
      const spread = f2 - f1
      const contango = (spread / f1) * 100
      const today = todayStr()
      const history = await appendContangoHistory({ date: today, value: contango })

      return {
        label,
        value: contango,
        f1,
        f2,
        f1Symbol: f1Label,
        f2Symbol: f2Label,
        spread,
        change: null,
        history,
        lastUpdated: new Date().toISOString(),
        dataSource: source,
      }
    }

    throw new Error('TradingView Scanner + Yahoo VIX futures 均無法取得 F1/F2 數據')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      ...makeError(label, `Error: 無法取��真實連線，需更換資料源 - ${msg}`),
      f1: null,
      f2: null,
      f1Symbol: f1Label,
      f2Symbol: f2Label,
      spread: null,
    }
  }
}

// ── CNN Fear & Greed Index ──
async function fetchFearGreed(): Promise<FearGreedData> {
  const label = 'CNN Fear & Greed'
  try {
    const res = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
          Referer: 'https://edition.cnn.com/',
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!res.ok) throw new Error(`CNN API HTTP ${res.status}`)

    const json = await res.json()
    const fgData = json?.fear_and_greed
    if (!fgData) throw new Error('No fear_and_greed data in CNN response')

    const score = fgData.score
    const previousClose = fgData.previous_close
    const classification = fgData.rating

    if (typeof score !== 'number') throw new Error('Invalid score from CNN')

    const change = typeof previousClose === 'number' ? score - previousClose : null

    // Parse historical data from the same response
    const histRaw: Array<{ x: number; y: number }> = json?.fear_and_greed_historical?.data ?? []
    let history: HistoricalPoint[]
    if (histRaw.length >= 2) {
      // Take last 10 entries, convert ms timestamp → YYYY-MM-DD
      history = histRaw.slice(-10).map(p => ({
        date: new Date(p.x).toISOString().slice(0, 10),
        value: p.y,
      }))
    } else {
      history = appendHistory(label, { date: todayStr(), value: score })
    }

    return {
      label,
      value: score,
      change,
      classification: classification || getClassification(score),
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: 'CNN',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      ...makeError(
        label,
        `Error: 無法取得真實連線，需更換資料源 - ${msg}`
      ),
      classification: undefined,
    }
  }
}

function getClassification(score: number): string {
  if (score <= 25) return 'Extreme Fear'
  if (score <= 45) return 'Fear'
  if (score <= 55) return 'Neutral'
  if (score <= 75) return 'Greed'
  return 'Extreme Greed'
}

// ── Crypto Fear & Greed Index (CoinGlass → alternative.me fallback) ──
function getCryptoClassification(score: number): string {
  if (score <= 10) return 'Extreme Fear'
  if (score <= 25) return 'Extreme Fear'
  if (score <= 45) return 'Fear'
  if (score <= 55) return 'Neutral'
  if (score <= 75) return 'Greed'
  return 'Extreme Greed'
}

async function fetchCryptoFearGreedFromCoinGlass(): Promise<{ value: number; classification: string } | null> {
  try {
    // CoinGlass renders client-side via JavaScript; server-side HTML has no data.
    // Try their public-facing page and look for embedded JSON data or meta tags
    const res = await fetch('https://www.coinglass.com/zh-TW/pro/i/FearGreedIndex', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // Try to find embedded data in script tags (Next.js __NEXT_DATA__ or similar)
    const nextDataMatch = html.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        const props = nextData?.props?.pageProps
        if (props) {
          const jsonStr = JSON.stringify(props)
          // Look for fear greed value pattern - must be 1-100
          const fgMatch = jsonStr.match(/"(?:fearGreed|fear_greed|fng|index)"\s*:\s*(\d+)/)
          if (fgMatch) {
            const val = parseInt(fgMatch[1], 10)
            if (val >= 1 && val <= 100) {
              return { value: val, classification: getCryptoClassification(val) }
            }
          }
        }
      } catch {
        // JSON parse failed
      }
    }

    // CoinGlass is an SPA - most data loaded via JS. Skip unreliable meta-tag scraping.
    return null
  } catch {
    return null
  }
}

async function fetchCryptoFearGreedFromAlternativeMe(): Promise<{ value: number; classification: string; previousValue: number | null; history: HistoricalPoint[] } | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=10', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = await res.json()

    if (json?.metadata?.error) return null
    const entries = json?.data
    if (!Array.isArray(entries) || entries.length === 0) return null

    const latest = entries[0]
    const value = parseInt(latest.value, 10)
    if (isNaN(value)) return null

    const classification = latest.value_classification || getCryptoClassification(value)
    const previousValue = entries.length > 1 ? parseInt(entries[1].value, 10) : null

    // entries are newest-first; reverse for chronological sparkline order
    const history: HistoricalPoint[] = [...entries]
      .reverse()
      .map(e => ({
        date: new Date(parseInt(e.timestamp, 10) * 1000).toISOString().slice(0, 10),
        value: parseInt(e.value, 10),
      }))
      .filter(p => !isNaN(p.value))

    return { value, classification, previousValue: isNaN(previousValue as number) ? null : previousValue, history }
  } catch {
    return null
  }
}

async function fetchCryptoFearGreed(): Promise<CryptoFearGreedData> {
  const label = 'Crypto Fear & Greed'
  try {
    let value: number | null = null
    let classification: string | undefined
    let change: number | null = null
    let source = ''
    let history: HistoricalPoint[] = []

    // === Primary: CoinGlass scraping (point-in-time only) ===
    const coinglassResult = await fetchCryptoFearGreedFromCoinGlass()
    if (coinglassResult) {
      value = coinglassResult.value
      classification = coinglassResult.classification
      source = 'CoinGlass'
    }

    // === Fallback: alternative.me free API (includes 10-day history) ===
    if (value === null) {
      const altResult = await fetchCryptoFearGreedFromAlternativeMe()
      if (altResult) {
        value = altResult.value
        classification = altResult.classification
        source = 'alternative.me'
        history = altResult.history
        if (altResult.previousValue !== null) {
          change = value - altResult.previousValue
        }
      }
    }

    if (value === null) {
      throw new Error('CoinGlass + alternative.me 均無法取得加密貨幣恐慌指數')
    }

    // If we got value from CoinGlass but no history, try alternative.me just for history
    if (history.length < 2) {
      const altResult = await fetchCryptoFearGreedFromAlternativeMe()
      if (altResult && altResult.history.length >= 2) {
        history = altResult.history
      } else {
        history = appendHistory(label, { date: todayStr(), value })
      }
    }

    return {
      label,
      value,
      change,
      classification,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: source,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      ...makeError(label, `Error: 無法取得真實連線，需更換資料源 - ${msg}`),
      classification: undefined,
    }
  }
}

// ── AAII Investor Sentiment (Bull-Bear Spread) ──
//
// 資料源改為 AAII 官網原始調查表（Bullish / Neutral / Bearish 三欄），
// Bull-Bear Spread = Bullish − Bearish，自行計算。
//
// 為什麼不再用 ycharts：ycharts 的 us_investor_sentiment_bull_bear_spread
// 序列已失真，回傳 -93.02%、881.1%、-277.8% 這類不可能的數值
// （AAII 實際區間約 ±40%），且頁面已無 .key-stat-value 元素可解析。
//
// AAII 表格同時提供近幾週歷史，故 sparkline 一次就有資料，不必累積。

const AAII_ROW =
  /<td[^>]*class="tableTxt"[^>]*>\s*([A-Z][a-z]{2})\s+(\d{1,2})\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*%\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*%\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*%\s*<\/td>/gi

const AAII_MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

interface AaiiWeek {
  date: string
  bullish: number
  neutral: number
  bearish: number
  spread: number
}

const AAII_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function aaiiHeaders() {
  return {
    'User-Agent': AAII_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
}

// 表格只有 "Jul 29" 沒有年份：先假設今年，若算出來是未來日期就退一年
function aaiiResolveDate(monthIdx: number, day: number): string {
  const now = new Date()
  let year = now.getUTCFullYear()
  let d = new Date(Date.UTC(year, monthIdx, day))
  if (d.getTime() - now.getTime() > 7 * 86400000) {
    year -= 1
    d = new Date(Date.UTC(year, monthIdx, day))
  }
  return d.toISOString().slice(0, 10)
}

function parseAaiiTable(html: string): AaiiWeek[] {
  const weeks: AaiiWeek[] = []
  let m: RegExpExecArray | null
  AAII_ROW.lastIndex = 0
  while ((m = AAII_ROW.exec(html)) !== null) {
    const monthIdx = AAII_MONTHS.indexOf(m[1].toLowerCase())
    if (monthIdx < 0) continue

    const day = parseInt(m[2], 10)
    const bullish = parseFloat(m[3])
    const neutral = parseFloat(m[4])
    const bearish = parseFloat(m[5])
    if (![bullish, neutral, bearish].every((v) => Number.isFinite(v))) continue

    // 三者相加應該接近 100%（AAII 會四捨五入，容許 ±1.5）
    if (Math.abs(bullish + neutral + bearish - 100) > 1.5) continue

    weeks.push({
      date: aaiiResolveDate(monthIdx, day),
      bullish,
      neutral,
      bearish,
      spread: Math.round((bullish - bearish) * 10) / 10,
    })
  }
  // 頁面由新到舊排列，取最近 10 週後轉成由舊到新供 sparkline 使用
  return weeks.slice(0, 10).reverse()
}

// 備援：AAII 的分析網站，數值寫在文章敘述裡
// 例：「The bull-bear spread narrowed to -11.1 points」
async function fetchAaiiFallbackSpread(): Promise<number | null> {
  const res = await fetch('https://sentiment.aaii.com/', {
    headers: aaiiHeaders(),
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`sentiment.aaii.com HTTP ${res.status}`)

  const text = await res.text()
  const m = text.match(/bull[-\s]?bear spread[^.]{0,60}?(-?\d+\.\d+)/i)
  if (!m) return null

  const value = parseFloat(m[1])
  // AAII 的 spread 實際上不可能超過 ±100，超出就是抓錯數字
  return Number.isFinite(value) && Math.abs(value) <= 100 ? value : null
}

async function fetchAAII(): Promise<IndicatorData> {
  const label = 'AAII Bull-Bear'
  try {
    const res = await fetch('https://www.aaii.com/sentimentsurvey/sent_results', {
      headers: aaiiHeaders(),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) throw new Error(`aaii.com HTTP ${res.status}`)

    const weeks = parseAaiiTable(await res.text())

    if (weeks.length === 0) {
      // 主來源解析失敗，改用敘述式備援（只有最新值，沒有歷史）
      const fallback = await fetchAaiiFallbackSpread()
      if (fallback === null) {
        throw new Error(
          'Could not parse the Bullish/Bearish table from aaii.com, and sentiment.aaii.com fallback returned no usable value'
        )
      }
      const history = appendHistory(label, { date: todayStr(), value: fallback })
      return {
        label,
        value: fallback,
        change: null,
        history,
        lastUpdated: new Date().toISOString(),
        dataSource: 'sentiment.aaii.com',
      }
    }

    // 把解析出來的每一週寫進 history store，之後抓取失敗時仍留得住 sparkline
    let history = getHistory(label)
    for (const week of weeks) {
      history = appendHistory(label, { date: week.date, value: week.spread })
    }

    const latest = weeks[weeks.length - 1]
    const previous = weeks.length > 1 ? weeks[weeks.length - 2] : null

    return {
      label,
      value: latest.spread,
      change:
        previous === null
          ? null
          : Math.round((latest.spread - previous.spread) * 10) / 10,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: `AAII · ${latest.date}`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return makeError(label, `Error: 無法取得真實連線，需更換資料源 - ${msg}`)
  }
}

// ── Canary Ratio (VWO + BND Momentum) ──

interface MonthlyPriceRecord {
  date: string  // YYYY-MM-DD
  price: number
}

/**
 * Fetch monthly historical prices from Yahoo Finance v8 chart API
 * Returns last 13 months of monthly data for momentum calculation
 */
async function fetchYahooMonthlyHistory(symbol: string): Promise<MonthlyPriceRecord[]> {
  // Fetch 400 days of data to ensure we have 13+ months
  const now = Math.floor(Date.now() / 1000)
  const period1 = now - 400 * 24 * 60 * 60  // 400 days ago
  const period2 = now

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1mo`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)

  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('Invalid Yahoo Finance response')

  const timestamps = result.timestamp
  const rawCloses = result.indicators?.quote?.[0]?.close
  // 動能計算必須用含息調整價（total return）：BND 每月配息，
  // 用不含息收盤價會低估債券報酬 ~4%/年，動能符號可能因此判錯
  const adjCloses = result.indicators?.adjclose?.[0]?.adjclose
  const closes = adjCloses && adjCloses.length === timestamps?.length ? adjCloses : rawCloses

  if (!timestamps || !closes || timestamps.length === 0) {
    throw new Error('No historical data from Yahoo Finance')
  }

  const monthlyData: MonthlyPriceRecord[] = []

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]
    const price = closes[i]
    if (ts == null || price == null || isNaN(price)) continue

    const d = new Date(ts * 1000)
    const dateStr = d.toISOString().slice(0, 10)
    monthlyData.push({ date: dateStr, price })
  }

  return monthlyData
}

/**
 * Calculate return between two prices
 */
function calcReturn(currentPrice: number, pastPrice: number): number {
  return (currentPrice - pastPrice) / pastPrice
}

/**
 * Calculate momentum score:
 * M = 1M_return * 12 + 3M_return * 4 + 6M_return * 2 + 12M_return * 1
 */
function calcMomentum(
  data: MonthlyPriceRecord[],
  currentIdx: number
): { momentum: number; returns: { m1: number | null; m3: number | null; m6: number | null; m12: number | null } } | null {
  if (currentIdx < 12 || currentIdx >= data.length) return null

  const current = data[currentIdx].price
  const m1Idx = currentIdx - 1
  const m3Idx = currentIdx - 3
  const m6Idx = currentIdx - 6
  const m12Idx = currentIdx - 12

  if (m1Idx < 0 || m3Idx < 0 || m6Idx < 0 || m12Idx < 0) return null

  const r1 = calcReturn(current, data[m1Idx].price)
  const r3 = calcReturn(current, data[m3Idx].price)
  const r6 = calcReturn(current, data[m6Idx].price)
  const r12 = calcReturn(current, data[m12Idx].price)

  const momentum = r1 * 12 + r3 * 4 + r6 * 2 + r12 * 1

  return {
    momentum,
    returns: {
      m1: r1 * 100,   // convert to percentage
      m3: r3 * 100,
      m6: r6 * 100,
      m12: r12 * 100,
    },
  }
}

async function fetchCanaryRatio(): Promise<CanaryData> {
  const label = 'Canary Ratio'

  try {
    // Fetch monthly historical data from Yahoo Finance
    const [vwoMonthly, bndMonthly] = await Promise.all([
      fetchYahooMonthlyHistory('VWO'),
      fetchYahooMonthlyHistory('BND'),
    ])

    if (vwoMonthly.length < 13 || bndMonthly.length < 13) {
      throw new Error('Not enough historical data from Yahoo Finance (need 13+ months)')
    }

    // Calculate momentum for the most recent month
    const vwoResult = calcMomentum(vwoMonthly, vwoMonthly.length - 1)
    const bndResult = calcMomentum(bndMonthly, bndMonthly.length - 1)

    if (!vwoResult || !bndResult) {
      throw new Error('Unable to calculate momentum (insufficient data points)')
    }

    const vwoM = vwoResult.momentum
    const bndM = bndResult.momentum

    // Count how many momentums are positive
    let n = 0
    if (vwoM > 0) n++
    if (bndM > 0) n++

    // Determine Canary Ratio
    let canaryRatio: number
    if (n === 0) canaryRatio = 0
    else if (n === 1) canaryRatio = 50
    else canaryRatio = 100

    const today = todayStr()
    const history = appendHistory(label, { date: today, value: canaryRatio })

    return {
      label,
      value: canaryRatio,
      change: null,
      vwoMomentum: vwoM,
      bndMomentum: bndM,
      n,
      vwoReturns: vwoResult.returns,
      bndReturns: bndResult.returns,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: `VWO: ${vwoMonthly[vwoMonthly.length - 1]?.date}, BND: ${bndMonthly[bndMonthly.length - 1]?.date}`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      ...makeError(label, `Error: 無法計算 Canary Ratio - ${msg}`),
      vwoMomentum: null,
      bndMomentum: null,
      n: undefined,
      vwoReturns: undefined,
      bndReturns: undefined,
    }
  }
}

// ── FBI (Fund Bias Index) from GitHub Gist JSON with fundhot.com fallback ──

interface FbiJsonResponse {
  date: string
  updated_at: string
  source: string
  buy_zone: Array<{ rank: number; name: string; deviation: number }>      // 負乖離 (買進區)
  strength_zone: Array<{ rank: number; name: string; deviation: number }> // 正乖離 (強勢區)
}

// Check if name is valid (not placeholder like "." or empty)
function isValidFbiName(name: string): boolean {
  if (!name || name.length < 2) return false
  if (name === '.' || name === '..') return false
  // Should contain at least one Chinese character
  return /[\u4e00-\u9fff]/.test(name)
}

// Fallback: Scrape fundhot.com directly
async function fetchFbiFromFundhot(): Promise<{ negative: FbiRankingItem[]; positive: FbiRankingItem[]; date: string } | null> {
  try {
    const res = await fetch('https://fundhot.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const html = await res.text()

    const negative: FbiRankingItem[] = []
    const positive: FbiRankingItem[] = []

    // 先把 HTML tag 全部剝掉，變成純文字再做 regex
    const plainText = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')

    // Date format: 2026-04-02淨值
    const dateMatch = plainText.match(/(\d{4}-\d{2}-\d{2})\s*淨值/)
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10)

    // 切出負乖離和正乖離的文字區塊
    const negBlock = plainText.match(/負乖離([\s\S]*?)正乖離/)
    const posBlock = plainText.match(/正乖離([\s\S]*?)(?:債券FBI|匯率FBI|查看完整排行|$)/)

    // 修正後的 regex：中文開頭，後面接非數字非%的字元（非貪婪），再接有號數字%
    const re = /([\u4e00-\u9fff][^\d%]*?)(-?\d+\.?\d*)%/g

    if (negBlock) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(negBlock[1])) !== null) {
        const name = m[1].trim()
        const val = parseFloat(m[2])
        if (!isNaN(val) && name.length >= 2) {
          negative.push({ name, value: val < 0 ? val : -val })
        }
      }
    }

    re.lastIndex = 0
    if (posBlock) {
      let m
      while ((m = re.exec(posBlock[1])) !== null) {
        const name = m[1].trim()
        const val = parseFloat(m[2])
        if (!isNaN(val) && name.length >= 2) {
          positive.push({ name, value: Math.abs(val) })
        }
      }
    }

    negative.sort((a, b) => a.value - b.value)
    positive.sort((a, b) => b.value - a.value)

    if (negative.length === 0 && positive.length === 0) return null
    return { negative: negative.slice(0, 5), positive: positive.slice(0, 5), date }
  } catch {
    return null
  }
}

async function fetchFBI(): Promise<FbiData> {
  const label = 'FBI股票排行'
  const FBI_JSON_URL = 'https://gist.githubusercontent.com/blackswan1207-commits/29339fe5131d3f17e2747be0d81426de/raw/fbi_ranking.json'

  try {
    // === Primary: GitHub Gist JSON ===
    const res = await fetch(FBI_JSON_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.ok) {
      const json: FbiJsonResponse = await res.json()

      // Validate that names are real (not placeholder dots)
      const hasValidNames = 
        json.buy_zone?.some(item => isValidFbiName(item.name)) ||
        json.strength_zone?.some(item => isValidFbiName(item.name))

      if (hasValidNames) {
        const negativeBias: FbiRankingItem[] = (json.buy_zone || [])
          .filter(item => isValidFbiName(item.name))
          .slice(0, 5)
          .map(item => ({
            name: item.name,
            value: item.deviation < 0 ? item.deviation : -Math.abs(item.deviation),
          }))

        const positiveBias: FbiRankingItem[] = (json.strength_zone || [])
          .filter(item => isValidFbiName(item.name))
          .slice(0, 5)
          .map(item => ({
            name: item.name,
            value: Math.abs(item.deviation),
          }))

        if (negativeBias.length > 0 || positiveBias.length > 0) {
          return {
            label,
            negativeBias,
            positiveBias,
            lastUpdated: new Date().toISOString(),
            dataSource: json.source || 'fundhot.com',
            dataDate: json.date,
          }
        }
      }
    }

    // === Fallback: Scrape fundhot.com directly ===
    const fundhot = await fetchFbiFromFundhot()
    if (fundhot && (fundhot.negative.length > 0 || fundhot.positive.length > 0)) {
      return {
        label,
        negativeBias: fundhot.negative,
        positiveBias: fundhot.positive,
        lastUpdated: new Date().toISOString(),
        dataSource: 'fundhot.com (直接抓取)',
        dataDate: fundhot.date,
      }
    }

    throw new Error('GitHub Gist JSON 無效且 fundhot.com 抓取失敗')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      label,
      negativeBias: [],
      positiveBias: [],
      error: `Error: 無法取得 FBI 資料 - ${msg}`,
      lastUpdated: new Date().toISOString(),
    }
  }
}

// ── Cycle Model (富邦景氣循環): OECD CLI + Yield Spread + Fed Assets ──

function parseFredCsv(text: string): Array<{ date: string; value: number }> {
  const lines = text.trim().split('\n')
  const result: Array<{ date: string; value: number }> = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 2) continue
    const date = parts[0].trim()
    const val = parts[1].trim()
    if (!date || val === '.' || val === '' || isNaN(Number(val))) continue
    result.push({ date, value: Number(val) })
  }
  return result
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr: number[], avg: number): number {
  const variance = arr.reduce((a, b) => a + (b - avg) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

function classifyOecdCli(level: number, direction: 'rising' | 'falling'): CycleStage {
  if (level >= 100 && direction === 'rising') return 'Expansion'
  if (level >= 100 && direction === 'falling') return 'Retracement'
  if (level < 100 && direction === 'falling') return 'Recession'
  return 'Recovery'
}

function classifyYieldSpread(spread: number, avg: number, std: number): CycleStage {
  if (spread >= 0) {
    return spread >= avg ? 'Expansion' : 'Retracement'
  } else {
    return spread < avg - std ? 'Recession' : 'Recovery'
  }
}

function combineStages(cliStage: CycleStage, yieldStage: CycleStage): CycleStage {
  const growthStages: CycleStage[] = ['Expansion', 'Recovery']
  const slowdownStages: CycleStage[] = ['Retracement', 'Recession']
  const cliGrowth = growthStages.includes(cliStage)
  const yieldGrowth = growthStages.includes(yieldStage)
  if (cliGrowth && yieldGrowth) return cliStage
  if (!cliGrowth && !yieldGrowth) return yieldStage
  return cliStage  // conflict → CLI wins
}

function applyFedPolicy(stage: CycleStage, policy: FedPolicy): CycleStage {
  if (policy === 'QE') {
    if (stage === 'Retracement') return 'Expansion'
    if (stage === 'Recession') return 'Recovery'
  }
  if (policy === 'QT') {
    if (stage === 'Recovery') return 'Retracement'
  }
  return stage
}

async function fetchCycleModel(): Promise<CycleData> {
  const label = '景氣循環模型'
  const now = new Date()
  const tenYearsAgo = new Date(now)
  tenYearsAgo.setFullYear(now.getFullYear() - 10)
  const tenYearsAgoStr = tenYearsAgo.toISOString().slice(0, 10)
  const sixMonthsAgoStr = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const FRED_API_KEY = process.env.FRED_API_KEY ?? ''
  const FRED_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

  try {
    // OECD API (stats.oecd.org) deprecated → 301 to sdmx.oecd.org which returns 403
    // OECD CLI fetched via Gist relay (local launchd monthly) — for now skip live fetch
    // OECD CLI + Yield Spread: GitHub Gist relay (local launchd monthly update on 12th)
    // WALCL: 20s — FRED official API, weekly data ~3KB (fast, no aggregation needed)
    const RELAY_GIST_URL = 'https://gist.githubusercontent.com/blackswan1207-commits/9250d2a987aeebd6d6ec6f61a47b6f23/raw/oecd-cli.json'
    const [gistResult, walclResult] = await Promise.allSettled([
      fetch(RELAY_GIST_URL, { signal: AbortSignal.timeout(10000) }),
      fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&observation_start=${sixMonthsAgoStr}&frequency=w&file_type=json&api_key=${FRED_API_KEY}`,
        { headers: { 'User-Agent': FRED_UA }, signal: AbortSignal.timeout(20000) }
      ),
    ])
    const gistRes = gistResult.status === 'fulfilled' ? gistResult.value : null
    const walclRes = walclResult.status === 'fulfilled' ? walclResult.value : null

    // ── OECD CLI + Yield Spread — both from Gist relay ──
    let oecdCli: number | null = null
    let oecdCliDirection: 'rising' | 'falling' | null = null
    let oecdCliStage: CycleStage | null = null
    let oecdCliDate: string | null = null
    let yieldSpread: number | null = null
    let yieldSpreadAvg: number | null = null
    let yieldSpreadStd: number | null = null
    let yieldSpreadStage: CycleStage | null = null
    let yieldSpreadDate: string | null = null

    if (gistRes?.ok) {
      try {
        type GistPayload = {
          oecdCli?: { value?: number; direction?: string; date?: string }
          yieldSpread?: { current?: number; avg?: number; std?: number; date?: string }
        }
        const gist = await gistRes.json() as GistPayload
        // OECD CLI
        if (gist?.oecdCli?.value != null && !isNaN(gist.oecdCli.value)) {
          oecdCli = gist.oecdCli.value
          oecdCliDirection = gist.oecdCli.direction === 'falling' ? 'falling' : 'rising'
          oecdCliStage = classifyOecdCli(oecdCli, oecdCliDirection)
          oecdCliDate = gist.oecdCli.date ?? null
        }
        // Yield Spread
        if (gist?.yieldSpread?.current != null && gist?.yieldSpread?.avg != null && gist?.yieldSpread?.std != null) {
          yieldSpread = gist.yieldSpread.current
          yieldSpreadAvg = gist.yieldSpread.avg
          yieldSpreadStd = gist.yieldSpread.std
          yieldSpreadStage = classifyYieldSpread(yieldSpread, yieldSpreadAvg, yieldSpreadStd)
          yieldSpreadDate = gist.yieldSpread.date ?? null
        }
      } catch { /* parse error, continue */ }
    }

    // ── Fed Total Assets (WALCL) ──
    let fedAssetsChangeQoQ: number | null = null
    let fedPolicy: FedPolicy | null = null

    if (walclRes?.ok) {
      try {
        const walclJson = await walclRes.json()
        const walclData: Array<{ value: number }> = (walclJson?.observations ?? [])
          .filter((o: { value: string }) => o.value !== '.' && !isNaN(parseFloat(o.value)))
          .map((o: { value: string }) => ({ value: parseFloat(o.value) }))
        if (walclData.length >= 14) {
          const latest = walclData[walclData.length - 1].value
          const quarterAgo = walclData[walclData.length - 14].value
          fedAssetsChangeQoQ = ((latest - quarterAgo) / quarterAgo) * 100
          if (fedAssetsChangeQoQ >= 3) fedPolicy = 'QE'
          else if (fedAssetsChangeQoQ < -1) fedPolicy = 'QT'
          else fedPolicy = 'QN'
        }
      } catch { /* leave null */ }
    }

    // ── Combine stages ──
    let designatedStage: CycleStage | null = null
    let finalStage: CycleStage | null = null

    if (oecdCliStage && yieldSpreadStage) {
      designatedStage = combineStages(oecdCliStage, yieldSpreadStage)
      finalStage = fedPolicy ? applyFedPolicy(designatedStage, fedPolicy) : designatedStage
    } else if (oecdCliStage) {
      designatedStage = oecdCliStage
      finalStage = fedPolicy ? applyFedPolicy(designatedStage, fedPolicy) : designatedStage
    } else if (yieldSpreadStage) {
      designatedStage = yieldSpreadStage
      finalStage = fedPolicy ? applyFedPolicy(designatedStage, fedPolicy) : designatedStage
    }

    return {
      label,
      oecdCli,
      oecdCliDirection,
      oecdCliStage,
      oecdCliDate,
      yieldSpread,
      yieldSpreadAvg,
      yieldSpreadStd,
      yieldSpreadStage,
      yieldSpreadDate,
      fedAssetsChangeQoQ,
      fedPolicy,
      designatedStage,
      finalStage,
      lastUpdated: new Date().toISOString(),
      dataSource: 'OECD / FRED',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      label,
      oecdCli: null, oecdCliDirection: null, oecdCliStage: null, oecdCliDate: null,
      yieldSpread: null, yieldSpreadAvg: null, yieldSpreadStd: null, yieldSpreadStage: null, yieldSpreadDate: null,
      fedAssetsChangeQoQ: null, fedPolicy: null,
      designatedStage: null, finalStage: null,
      error: `Error: 無法取得景氣循環資料 - ${msg}`,
      lastUpdated: new Date().toISOString(),
    }
  }
}

// ── Taiwan Business Cycle Signal (國發會景氣對策信號) ──
// 靜態資料維護於 lib/taiwan-cli-data.ts，國發會每月發布後需手動補一筆
async function fetchTaiwanCLI(): Promise<TaiwanCLIData> {
  const label = '台灣景氣燈號'
  try {
    const sorted = [...TAIWAN_CLI_HISTORY].sort((a, b) => a.date.localeCompare(b.date))
    const latest = sorted[sorted.length - 1]
    const prev = sorted[sorted.length - 2]
    const history = sorted.map(d => ({ date: d.date, value: d.score }))
    const change = prev ? latest.score - prev.score : null
    return {
      label,
      value: latest.score,
      change,
      classification: latest.signal,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: `國發會 · ${latest.date}`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      label,
      value: null,
      change: null,
      history: [],
      error: `無法取得景氣燈號 - ${msg}`,
      lastUpdated: new Date().toISOString(),
    }
  }
}

// ── Main API Route ──
export async function GET() {
  // Check cache first
  const cached = getCached<SentimentPayload>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=3600',
      },
    })
  }

  // Fetch all indicators in parallel
  const [vix, vvix, contango, fearGreed, aaii, cryptoFearGreed, canary, fbi, cycle, taiwanCLI] = await Promise.all([
    fetchVIX(),
    fetchVVIX(),
    fetchContango(),
    fetchFearGreed(),
    fetchAAII(),
    fetchCryptoFearGreed(),
    fetchCanaryRatio(),
    fetchFBI(),
    fetchCycleModel(),
    fetchTaiwanCLI(),
  ])

  const payload: SentimentPayload = {
    vix,
    vvix,
    contango,
    fearGreed,
    aaii,
    cryptoFearGreed,
    canary,
    fbi,
    cycle,
    taiwanCLI,
    timestamp: new Date().toISOString(),
    dataPoints: getHistoryCount(),
  }

  // Cache the result for 2 hours
  setCache(CACHE_KEY, payload)

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=3600',
    },
  })
}
