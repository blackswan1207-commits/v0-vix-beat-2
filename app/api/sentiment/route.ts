import { NextResponse } from 'next/server'
import { getCached, setCache, appendHistory, getHistory } from '@/lib/cache'
import type {
  SentimentPayload,
  IndicatorData,
  ContangoData,
  FearGreedData,
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
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return makeError(label, `Error: 無法取得真實連線 - ${msg}`)
  }
}

// ── Contango: VIX Futures from vixcentral.com ──
async function fetchContango(): Promise<ContangoData> {
  const label = 'Contango'
  try {
    // Try scraping vixcentral.com for VIX futures data
    const res = await fetch('http://vixcentral.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`vixcentral HTTP ${res.status}`)

    const html = await res.text()

    // Try to parse futures data from the page
    // vixcentral stores data in JavaScript variables
    let f1: number | null = null
    let f2: number | null = null

    // Look for futures data in script tags
    const futuresMatch = html.match(/var defined_data\s*=\s*(\[[\s\S]*?\]);/)
    if (futuresMatch) {
      try {
        const data = JSON.parse(futuresMatch[1])
        if (Array.isArray(data) && data.length >= 2) {
          // data format: array of [month, price] or just prices
          if (Array.isArray(data[0])) {
            f1 = parseFloat(data[0][1])
            f2 = parseFloat(data[1][1])
          } else {
            f1 = parseFloat(data[0])
            f2 = parseFloat(data[1])
          }
        }
      } catch {
        // JSON parse failed, try alternate pattern
      }
    }

    // Try alternate patterns if above failed
    if (!f1 || !f2) {
      // Look for futures_data or similar
      const altMatch = html.match(/futures_data[^=]*=\s*(\[[\s\S]*?\]);/)
      if (altMatch) {
        try {
          const data = JSON.parse(altMatch[1])
          if (Array.isArray(data) && data.length >= 2) {
            f1 = typeof data[0] === 'number' ? data[0] : parseFloat(data[0])
            f2 = typeof data[1] === 'number' ? data[1] : parseFloat(data[1])
          }
        } catch {
          // parse failed
        }
      }
    }

    // If scraping failed, try using Yahoo Finance for VIX futures
    if (!f1 || !f2 || isNaN(f1) || isNaN(f2)) {
      // Attempt Yahoo Finance VIX futures
      const [vf1, vf2] = await Promise.all([
        fetchYahooQuote('VX=F'),  // Front month VIX future
        fetchYahooQuote('VXV2=F'), // Second month
      ])

      if (vf1) f1 = vf1.price
      if (vf2) f2 = vf2.price
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
        spread,
        change: null,
        history,
        lastUpdated: new Date().toISOString(),
      }
    }

    // If all attempts failed, throw error
    throw new Error(
      'vixcentral scraping + Yahoo VIX futures both failed to yield F1/F2 data'
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    // Return error state per strict rules: show error, never fabricate
    return {
      ...makeError(label, `Error: 無法取得真實連線，需更換資料源 - ${msg}`),
      f1: null,
      f2: null,
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
  const [vix, vvix, contango, fearGreed, aaii] = await Promise.all([
    fetchVIX(),
    fetchVVIX(),
    fetchContango(),
    fetchFearGreed(),
    fetchAAII(),
  ])

  const payload: SentimentPayload = {
    vix,
    vvix,
    contango,
    fearGreed,
    aaii,
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
