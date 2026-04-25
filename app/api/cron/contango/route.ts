import { NextResponse } from 'next/server'

export const maxDuration = 30

const CONTANGO_GIST_ID = '1a486a43e09009d5afc46ebdf15c8c95'
const CONTANGO_GIST_FILE = 'contango_history.json'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

async function fetchContangoValue(): Promise<number | null> {
  try {
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
    if (!res.ok) return null
    const json = await res.json()
    const data = json?.data
    if (!Array.isArray(data)) return null

    const contracts = data
      .map((item: { s: string; d: [number, string, number] }) => {
        const sym = item.s?.split(':')?.[1]
        if (!sym || sym.includes('!') || sym.startsWith('VXM')) return null
        const [price, , expiration] = item.d
        if (typeof price !== 'number' || !expiration) return null
        return { price, expiration }
      })
      .filter(Boolean)
      .sort((a: { expiration: number }, b: { expiration: number }) => a.expiration - b.expiration)

    if (contracts.length < 2) return null
    const f1 = contracts[0].price
    const f2 = contracts[1].price
    return ((f2 - f1) / f1) * 100
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  // Verify request is from Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contango = await fetchContangoValue()
  if (contango === null) {
    return NextResponse.json({ error: 'Failed to fetch VIX futures from TradingView' }, { status: 500 })
  }

  // Read existing history from Gist
  let history: Array<{ date: string; value: number }> = []
  try {
    const url = `https://gist.githubusercontent.com/blackswan1207-commits/${CONTANGO_GIST_ID}/raw/${CONTANGO_GIST_FILE}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const json = await res.json()
      history = Array.isArray(json.data) ? json.data : []
    }
  } catch { /* start with empty */ }

  const today = todayStr()
  if (!history.some(p => p.date === today)) {
    history.push({ date: today, value: contango })
  }
  const trimmed = history.slice(-10)

  // Write back to Gist
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not set' }, { status: 500 })
  }

  const patchRes = await fetch(`https://api.github.com/gists/${CONTANGO_GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        [CONTANGO_GIST_FILE]: {
          content: JSON.stringify({ updated_at: today, data: trimmed }),
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  })

  if (!patchRes.ok) {
    return NextResponse.json({ error: `Gist write failed: ${patchRes.status}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date: today, value: contango, points: trimmed.length })
}
