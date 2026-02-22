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
}

export interface ContangoData extends IndicatorData {
  f1?: number | null
  f2?: number | null
  spread?: number | null
}

export interface FearGreedData extends IndicatorData {
  classification?: string
}

export interface SentimentPayload {
  vix: IndicatorData
  vvix: IndicatorData
  contango: ContangoData
  fearGreed: FearGreedData
  aaii: IndicatorData
  timestamp: string
}
