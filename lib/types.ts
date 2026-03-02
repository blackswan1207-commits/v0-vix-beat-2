export interface HistoricalPoint {
  date: string
  value: number
}

export interface IndicatorData {
  label: string
  value: number | null
  change?: number | null
  history: HistoricalPoint[]
  error?: string
  lastUpdated: string
  dataSource?: string
}

export interface ContangoData extends IndicatorData {
  f1?: number | null
  f2?: number | null
  f1Symbol?: string
  f2Symbol?: string
  spread?: number | null
}

export interface FearGreedData extends IndicatorData {
  classification?: string
}

export interface CryptoFearGreedData extends IndicatorData {
  classification?: string
}

export interface FbiRankingItem {
  name: string       // Chinese name e.g. "中國國企股"
  value: number      // e.g. -3.42 (percentage)
}

export interface FbiData {
  label: string
  negativeBias: FbiRankingItem[]  // Top 5 negative bias
  positiveBias: FbiRankingItem[]  // Top 5 positive bias
  error?: string
  lastUpdated: string
  dataSource?: string
  dataDate?: string  // Date shown on fundhot.com (e.g. "2026-02-20")
}

export interface CanaryData extends IndicatorData {
  vwoMomentum?: number | null
  bndMomentum?: number | null
  n?: number  // count of positive momentums (0, 1, or 2)
  vwoReturns?: {
    m1: number | null
    m3: number | null
    m6: number | null
    m12: number | null
  }
  bndReturns?: {
    m1: number | null
    m3: number | null
    m6: number | null
    m12: number | null
  }
}

export interface SentimentPayload {
  vix: IndicatorData
  vvix: IndicatorData
  contango: ContangoData
  fearGreed: FearGreedData
  aaii: IndicatorData
  cryptoFearGreed: CryptoFearGreedData
  canary: CanaryData
  fbi: FbiData
  timestamp: string
  dataPoints: number  // Number of accumulated data points (max 10)
}
