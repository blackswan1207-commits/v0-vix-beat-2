import { NextResponse } from 'next/server'
import { getCached, setCache, appendHistory, getHistory } from '@/lib/cache'
import type {
  SentimentPayload,
  IndicatorData,
  ContangoData,
  FearGreedData,
  CryptoFearGreedData,
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
    // Use Yahoo Finance v8 chart endpoint for reliable data
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

async function fetchVIX(): Promise<IndicatorData> {
  const label = 'VIX'
  try {
    const quote = await fetchYahooQuote('^VIX')
    if (!quote) throw new Error('Yahoo Finance VIX request failed')

    const change = quote.price - quote.previousClose
    const today = todayStr()
    const history = appendHistory(label, { date: today, value: quote.price })

    return {
      label,
      value: quote.price,
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
    const quote = await fetchYahooQuote('^VVIX')
    if (!quote) throw new Error('Yahoo Finance VVIX request failed')

    const change = quote.price - quote.previousClose
    const today = todayStr()
    const history = appendHistory(label, { date: today, value: quote.price })

    return {
      label,
      value: quote.price,
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
      ...makeError(label, `Error: 無法取得真實連線，需更換資料源 - ${msg}`),
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

async function fetchCryptoFearGreedFromAlternativeMe(): Promise<{ value: number; classification: string; previousValue: number | null } | null> {
  try {
    // alternative.me free public API - no key required
    const res = await fetch('https://api.alternative.me/fng/?limit=2', {
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

    return { value, classification, previousValue: isNaN(previousValue as number) ? null : previousValue }
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

    // === Primary: CoinGlass scraping ===
    const coinglassResult = await fetchCryptoFearGreedFromCoinGlass()
    if (coinglassResult) {
      value = coinglassResult.value
      classification = coinglassResult.classification
      source = 'CoinGlass'
    }

    // === Fallback: alternative.me free API ===
    if (value === null) {
      const altResult = await fetchCryptoFearGreedFromAlternativeMe()
      if (altResult) {
        value = altResult.value
        classification = altResult.classification
        source = 'alternative.me'
        if (altResult.previousValue !== null) {
          change = value - altResult.previousValue
        }
      }
    }

    if (value === null) {
      throw new Error('CoinGlass + alternative.me 均無法取得加密貨幣恐慌指數')
    }

    const today = todayStr()
    const history = appendHistory(label, { date: today, value })

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
  const [vix, vvix, contango, fearGreed, aaii, cryptoFearGreed] = await Promise.all([
    fetchVIX(),
    fetchVVIX(),
    fetchContango(),
    fetchFearGreed(),
    fetchAAII(),
    fetchCryptoFearGreed(),
  ])

  const payload: SentimentPayload = {
    vix,
    vvix,
    contango,
    fearGreed,
    aaii,
    cryptoFearGreed,
    timestamp: new Date().toISOString(),
  }

  // Cache the result for 2 hours
  setCache(CACHE_KEY, payload)

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=3600',
    },
  })
}
