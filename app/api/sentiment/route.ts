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

// ── VIX Futures month code mapping ──
// Jan=F, Feb=G, Mar=H, Apr=J, May=K, Jun=M, Jul=N, Aug=Q, Sep=U, Oct=V, Nov=X, Dec=Z
const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']

// VIX futures typically expire on the Wednesday 30 days before
// the 3rd Friday of the following month. Approximate with ~3rd Wednesday of the month.
function getVixFuturesExpiry(year: number, month: number): Date {
  // Find the 3rd Wednesday of the given month
  const d = new Date(year, month, 1)
  // Day of week: 0=Sun, 3=Wed
  const firstDay = d.getDay()
  const firstWed = firstDay <= 3 ? 3 - firstDay + 1 : 7 - firstDay + 3 + 1
  const thirdWed = firstWed + 14
  return new Date(year, month, thirdWed)
}

/**
 * Determine the front-month (F1) and second-month (F2) VIX futures contract symbols.
 * If the front month has already expired, roll forward.
 */
function getVixFutureSymbols(): { f1Symbol: string; f2Symbol: string; f1Label: string; f2Label: string } {
  const now = new Date()
  let f1Month = now.getMonth() // 0-indexed
  let f1Year = now.getFullYear()

  // Check if the front month contract has expired
  const expiry = getVixFuturesExpiry(f1Year, f1Month)
  if (now > expiry) {
    // Roll to next month
    f1Month += 1
    if (f1Month > 11) {
      f1Month = 0
      f1Year += 1
    }
  }

  let f2Month = f1Month + 1
  let f2Year = f1Year
  if (f2Month > 11) {
    f2Month = 0
    f2Year += 1
  }

  const f1Code = MONTH_CODES[f1Month]
  const f2Code = MONTH_CODES[f2Month]
  const f1Symbol = `VX${f1Code}${f1Year}`
  const f2Symbol = `VX${f2Code}${f2Year}`

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const f1Label = `${f1Symbol} (${monthNames[f1Month]} ${f1Year})`
  const f2Label = `${f2Symbol} (${monthNames[f2Month]} ${f2Year})`

  return { f1Symbol, f2Symbol, f1Label, f2Label }
}

/**
 * Fetch a single VIX futures price from TradingView Scanner API
 * Endpoint: https://scanner.tradingview.com/symbol?symbol=CBOE:<symbol>&fields=close&no_404=true
 */
async function fetchTradingViewFuturesPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://scanner.tradingview.com/symbol?symbol=CBOE:${symbol}&fields=close&no_404=true`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = await res.json()
    // Response format: { "close": 20.223, ... } or with pipe notation
    const close = json?.close ?? json?.['close|1D'] ?? json?.['close']
    if (typeof close === 'number' && !isNaN(close)) return close
    // Try to find any numeric close-like field
    for (const key of Object.keys(json)) {
      if (key.startsWith('close')) {
        const v = parseFloat(json[key])
        if (!isNaN(v)) return v
      }
    }
    return null
  } catch {
    return null
  }
}

// ── Contango: VIX Futures from TradingView Scanner API (primary) ──
async function fetchContango(): Promise<ContangoData> {
  const label = 'Contango'
  const { f1Symbol, f2Symbol, f1Label, f2Label } = getVixFutureSymbols()

  try {
    let f1: number | null = null
    let f2: number | null = null

    let source = ''

    // === Primary source: TradingView Scanner API ===
    const [tvF1, tvF2] = await Promise.all([
      fetchTradingViewFuturesPrice(f1Symbol),
      fetchTradingViewFuturesPrice(f2Symbol),
    ])

    if (tvF1 !== null && tvF2 !== null) {
      f1 = tvF1
      f2 = tvF2
      source = 'TradingView'
    }

    // === Fallback: Yahoo Finance VIX futures ===
    if (f1 === null || f2 === null) {
      const [vf1, vf2] = await Promise.all([
        fetchYahooQuote('VX=F'),   // Front month VIX future
        fetchYahooQuote('VX2=F'),  // Second month
      ])
      if (vf1 && f1 === null) f1 = vf1.price
      if (vf2 && f2 === null) f2 = vf2.price
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

    throw new Error(
      `TradingView (${f1Symbol}, ${f2Symbol}) + Yahoo VIX futures 均無法取得 F1/F2 數據`
    )
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
