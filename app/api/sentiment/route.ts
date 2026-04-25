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
} from '@/lib/types'

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

    // Skip if not a symbol we can parse
    if (!symbol) continue

    // Skip continuous contracts (e.g. "VX1!", "VXM1!")
    if (symbol.includes('!')) continue

    // Skip Mini VXM contracts (symbol starts with VXM followed by letter)
    // Standard VIX: VX + month_code + year (e.g. VXH2026)
    // Mini VIX:     VXM + month_code + year (e.g. VXMH2026)
    if (symbol.startsWith('VXM')) continue

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
      const history = appendHistory(label, { date: today, value: contango })

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
    // CNN provides a public API endpoint for fear & greed
    const res = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
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
    const classification = fgData.rating // e.g., "Fear", "Greed", "Extreme Fear"

    if (typeof score !== 'number') throw new Error('Invalid score from CNN')

    const change =
      typeof previousClose === 'number' ? score - previousClose : null

    const today = todayStr()
    const history = appendHistory(label, { date: today, value: score })

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
async function fetchAAII(): Promise<IndicatorData> {
  const label = 'AAII Bull-Bear'
  try {
    // Attempt to scrape from ycharts
    // ycharts.com/indicators/us_investor_sentiment_bull_bear_spread
    const res = await fetch(
      'https://ycharts.com/indicators/us_investor_sentiment_bull_bear_spread',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!res.ok) throw new Error(`ycharts HTTP ${res.status}`)

    const html = await res.text()
    const { load } = await import('cheerio')
    const $ = load(html)

    // ycharts typically shows the value in a key-stat element
    let value: number | null = null

    // Try various selectors that ycharts uses
    const selectors = [
      '.key-stat-title + .key-stat-value',
      '.key-stat-value',
      '[class*="current-value"]',
      '.indicator-value',
    ]

    for (const selector of selectors) {
      const el = $(selector).first()
      if (el.length) {
        const text = el.text().trim().replace('%', '').replace(',', '')
        const parsed = parseFloat(text)
        if (!isNaN(parsed)) {
          value = parsed
          break
        }
      }
    }

    if (value === null) {
      // Try finding any percentage-like value in the page
      const bodyText = $('body').text()
      const percentMatch = bodyText.match(
        /(?:Bull[- ]Bear[^-]*?|Current\s*Value[^-]*?)(-?\d+\.?\d*)%/i
      )
      if (percentMatch) {
        value = parseFloat(percentMatch[1])
      }
    }

    if (value === null) {
      throw new Error(
        'Could not parse Bull-Bear Spread value from ycharts.com - page structure may have changed'
      )
    }

    const today = todayStr()
    const history = appendHistory(label, { date: today, value })

    return {
      label,
      value,
      change: null,
      history,
      lastUpdated: new Date().toISOString(),
      dataSource: 'ycharts.com',
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return makeError(
      label,
      `Error: 無法取得真實連線，需更換資料源 - ${msg}`
    )
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
  const closes = result.indicators?.quote?.[0]?.close

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
    // allSettled: one slow source won't block the others
    // OECD: 45s — slow API, large SDMX-JSON body
    // FRED T10Y3M: 20s — official API, monthly data ~10KB
    // WALCL: 20s — official API, weekly data ~3KB (avoid fredgraph.csv which returns all history)
    const [oecdResult, spreadResult, walclResult] = await Promise.allSettled([
      fetch(
        'https://stats.oecd.org/SDMX-JSON/data/MEI_CLI/LOLITOAA.OAVG.M/all?lastNObservations=6',
        { headers: { Accept: 'application/json', 'User-Agent': FRED_UA }, signal: AbortSignal.timeout(45000) }
      ),
      fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=T10Y3M&observation_start=${tenYearsAgoStr}&frequency=m&aggregation_method=avg&file_type=json&api_key=${FRED_API_KEY}`,
        { headers: { 'User-Agent': FRED_UA }, signal: AbortSignal.timeout(20000) }
      ),
      fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&observation_start=${sixMonthsAgoStr}&frequency=w&file_type=json&api_key=${FRED_API_KEY}`,
        { headers: { 'User-Agent': FRED_UA }, signal: AbortSignal.timeout(20000) }
      ),
    ])
    const oecdRes = oecdResult.status === 'fulfilled' ? oecdResult.value : null
    const spreadRes = spreadResult.status === 'fulfilled' ? spreadResult.value : null
    const walclRes = walclResult.status === 'fulfilled' ? walclResult.value : null
    let oecdJson: unknown = null, spreadJson: unknown = null
    if (oecdRes?.ok) try { oecdJson = await oecdRes.json() } catch { oecdJson = null }
    if (spreadRes?.ok) try { spreadJson = await spreadRes.json() } catch { spreadJson = null }

    // ── OECD CLI ──
    let oecdCli: number | null = null
    let oecdCliDirection: 'rising' | 'falling' | null = null
    let oecdCliStage: CycleStage | null = null

    if (oecdRes?.ok && oecdJson) {
      try {
        const json = oecdJson as Record<string, unknown>
        const structs = (json?.data as Record<string, unknown>)?.structures?.[0]
        const timeDimValues = structs?.dimensions?.observation?.[0]?.values as Array<{ id: string }> | undefined
        const idxToDate: Record<number, string> = {}
        if (timeDimValues) {
          timeDimValues.forEach((v, i) => { idxToDate[i] = v.id })
        }
        const G7_AA_KEY = '51:0:0:0:1:1:0:0:0'
        const seriesObs = json?.data?.dataSets?.[0]?.series?.[G7_AA_KEY]?.observations as Record<string, [number, number]> | undefined
        if (seriesObs && Object.keys(idxToDate).length > 0) {
          const entries = Object.entries(seriesObs)
            .map(([idx, arr]) => ({ date: idxToDate[Number(idx)] ?? '', value: arr[0] }))
            .filter(e => e.date && e.value != null && !isNaN(e.value))
            .sort((a, b) => a.date.localeCompare(b.date))
          if (entries.length >= 2) {
            const last = entries[entries.length - 1]
            const prev = entries[entries.length - 2]
            oecdCli = last.value
            oecdCliDirection = last.value > prev.value ? 'rising' : 'falling'
            oecdCliStage = classifyOecdCli(oecdCli, oecdCliDirection)
          }
        }
      } catch { /* parse error, continue */ }
    }

    // ── Yield Spread (T10Y3M) ──
    let yieldSpread: number | null = null
    let yieldSpreadAvg: number | null = null
    let yieldSpreadStd: number | null = null
    let yieldSpreadStage: CycleStage | null = null

    if (spreadRes?.ok && spreadJson) {
      try {
        const spreadData: Array<{ date: string; value: number }> = (spreadJson?.observations ?? [])
          .filter((o: { value: string }) => o.value !== '.' && !isNaN(parseFloat(o.value)))
          .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }))
        if (spreadData.length >= 12) {
          const values = spreadData.map(d => d.value)
          const avg = mean(values)
          const std = stdDev(values, avg)
          yieldSpread = values[values.length - 1]
          yieldSpreadAvg = avg
          yieldSpreadStd = std
          yieldSpreadStage = classifyYieldSpread(yieldSpread, avg, std)
        }
      } catch { /* leave null */ }
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
      yieldSpread,
      yieldSpreadAvg,
      yieldSpreadStd,
      yieldSpreadStage,
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
      oecdCli: null, oecdCliDirection: null, oecdCliStage: null,
      yieldSpread: null, yieldSpreadAvg: null, yieldSpreadStd: null, yieldSpreadStage: null,
      fedAssetsChangeQoQ: null, fedPolicy: null,
      designatedStage: null, finalStage: null,
      error: `Error: 無法取得景氣循環資料 - ${msg}`,
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
  const [vix, vvix, contango, fearGreed, aaii, cryptoFearGreed, canary, fbi, cycle] = await Promise.all([
    fetchVIX(),
    fetchVVIX(),
    fetchContango(),
    fetchFearGreed(),
    fetchAAII(),
    fetchCryptoFearGreed(),
    fetchCanaryRatio(),
    fetchFBI(),
    fetchCycleModel(),
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
