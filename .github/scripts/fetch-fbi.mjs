#!/usr/bin/env node
// fetch-fbi.mjs — 抓 fundhot.com FBI 資料並更新 Gist

const GIST_ID = process.env.GIST_ID
const GIST_TOKEN = process.env.GIST_TOKEN

if (!GIST_ID || !GIST_TOKEN) {
  console.error('缺少 GIST_ID 或 GIST_TOKEN 環境變數')
  process.exit(1)
}

async function fetchFbiData() {
  const res = await fetch('https://fundhot.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.google.com/',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) throw new Error(`fundhot HTTP ${res.status}`)
  const html = await res.text()

  // 剝掉 HTML tags
  const plainText = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')

  // 日期
  const dateMatch = plainText.match(/(\d{4}-\d{2}-\d{2})\s*淨值/)
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10)

  // 切出區塊
  const negBlock = plainText.match(/負乖離([\s\S]*?)正乖離/)
  const posBlock = plainText.match(/正乖離([\s\S]*?)(?:債券FBI|匯率FBI|查看完整排行|$)/)

  const re = /([\u4e00-\u9fff][^\d%]*?)(-?\d+\.?\d*)%/g
  const buyZone = []
  const strengthZone = []

  if (negBlock) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(negBlock[1])) !== null) {
      const name = m[1].trim()
      const val = parseFloat(m[2])
      if (!isNaN(val) && name.length >= 2) {
        buyZone.push({ rank: buyZone.length + 1, name, deviation: val < 0 ? val : -val })
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
        strengthZone.push({ rank: strengthZone.length + 1, name, deviation: Math.abs(val) })
      }
    }
  }

  if (buyZone.length === 0 && strengthZone.length === 0) {
    throw new Error('解析結果為空，可能頁面結構已變更')
  }

  return {
    date,
    updated_at: new Date().toISOString(),
    source: 'fundhot.com',
    buy_zone: buyZone.slice(0, 20),
    strength_zone: strengthZone.slice(0, 20),
  }
}

async function updateGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${GIST_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        'fbi_ranking.json': {
          content: JSON.stringify(data, null, 2),
        },
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gist update failed: ${res.status} — ${err}`)
  }

  console.log(`✓ Gist 更新成功 (${data.date})：負乖離 ${data.buy_zone.length} 筆，正乖離 ${data.strength_zone.length} 筆`)
}

try {
  const data = await fetchFbiData()
  await updateGist(data)
} catch (err) {
  console.error('❌ 失敗：', err.message)
  process.exit(1)
}
