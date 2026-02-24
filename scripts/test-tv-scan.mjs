// Test TradingView Scanner API for listing VIX futures contracts

// Approach 1: Scanner futures/scan endpoint
async function testScannerAPI() {
  console.log("=== Testing TradingView Scanner futures/scan ===")
  try {
    const body = {
      columns: ["close", "description", "expiration"],
      filter: [
        { left: "name", operation: "match", right: "VX" }
      ],
      sort: { sortBy: "expiration", sortOrder: "asc" },
      range: [0, 20],
      markets: ["futures"],
      filter2: {
        operator: "and",
        operands: [
          { operation: { operator: "or", operands: [
            { expression: { left: "exchange", operation: "equal", right: "CBOE" } }
          ]}}
        ]
      }
    }
    
    const res = await fetch('https://scanner.tradingview.com/futures/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(body),
    })
    console.log("Status:", res.status)
    const json = await res.json()
    console.log("Response:", JSON.stringify(json, null, 2).slice(0, 3000))
  } catch (e) {
    console.log("Error:", e.message)
  }
}

// Approach 2: Scrape the contracts page
async function testContractsPage() {
  console.log("\n=== Testing TradingView Contracts Page (EN) ===")
  try {
    const res = await fetch('https://www.tradingview.com/symbols/CBOE-VX1!/contracts/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    console.log("Status:", res.status)
    const html = await res.text()
    
    // Look for VX contract symbols in the HTML
    const vxMatches = html.match(/VX[A-Z]\d{4}/g)
    if (vxMatches) {
      const unique = [...new Set(vxMatches)]
      console.log("Found VX symbols:", unique)
    } else {
      console.log("No VX symbols found in HTML")
    }
    
    // Look for price data patterns near the symbols
    const pricePatterns = html.match(/VX[A-Z]\d{4}[^]*?(\d+\.\d+)/g)
    if (pricePatterns) {
      console.log("Price patterns (first 5):", pricePatterns.slice(0, 5).map(p => p.slice(0, 100)))
    }
    
    // Check for JSON data embedded in the page
    const jsonDataMatch = html.match(/"contracts"\s*:\s*(\[[\s\S]*?\])/)
    if (jsonDataMatch) {
      console.log("Found contracts JSON:", jsonDataMatch[1].slice(0, 500))
    }
    
    // Check for __NEXT_DATA__ or similar embedded JSON
    const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (nextData) {
      console.log("Found __NEXT_DATA__:", nextData[1].slice(0, 1000))
    }

    // Check for window.__data or similar
    const windowData = html.match(/window\.__data\s*=\s*(\{[\s\S]*?\});/)
    if (windowData) {
      console.log("Found window.__data")
    }
    
    // Check for any script containing VX contract data
    const scriptMatches = html.match(/<script[^>]*>([^<]*VXK2025[^<]*)<\/script>/g)
    if (scriptMatches) {
      console.log("Found scripts with VXK2025:", scriptMatches.length)
      console.log("First match preview:", scriptMatches[0].slice(0, 500))
    } else {
      console.log("No script tags contain VXK2025")
    }

    // Broad search for any embedded data
    const allScripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []
    console.log(`Total script tags: ${allScripts.length}`)
    for (const script of allScripts) {
      if (script.includes('VX') && script.includes('2025')) {
        console.log("Script with VX+2025:", script.slice(0, 300))
      }
    }
    
  } catch (e) {
    console.log("Error:", e.message)
  }
}

// Approach 3: Individual symbol lookup for known symbols  
async function testSymbolLookup() {
  console.log("\n=== Testing individual symbol lookup ===")
  const symbols = ['VXK2025', 'VXM2025', 'VXH2026', 'VXJ2026']
  
  for (const sym of symbols) {
    try {
      const url = `https://scanner.tradingview.com/symbol?symbol=CBOE:${sym}&fields=close,description,expiration&no_404=true`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      })
      const json = await res.json()
      console.log(`${sym}:`, JSON.stringify(json))
    } catch (e) {
      console.log(`${sym}: Error - ${e.message}`)
    }
  }
}

// Approach 4: Try the TW search endpoint
async function testSearchEndpoint() {
  console.log("\n=== Testing TradingView search ===")
  try {
    const res = await fetch('https://symbol-search.tradingview.com/symbol_search/v3/?text=VX&exchange=CBOE&type=futures&start=0&search_type=undefined', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    console.log("Status:", res.status)
    const json = await res.json()
    console.log("Results:", JSON.stringify(json).slice(0, 2000))
  } catch (e) {
    console.log("Error:", e.message)
  }
}

await testScannerAPI()
await testContractsPage()
await testSymbolLookup()
await testSearchEndpoint()
