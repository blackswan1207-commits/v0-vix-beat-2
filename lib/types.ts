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
  timestamp: string
}
