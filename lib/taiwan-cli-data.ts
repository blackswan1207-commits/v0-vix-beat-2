// 台灣景氣對策信號歷史資料（來源：國發會，每月27日左右發布上上月數據）
// 燈號對照：藍(9-16) 黃藍(17-22) 綠(23-31) 黃紅(32-37) 紅(38-45)
// 注意：此為手動維護的靜態資料，每月國發會發布後需補一筆（缺月：2025-02~04、08、10）
// 驗證來源：國發會景氣指標查詢系統 index.ndc.gov.tw（2026-07-15 核對，4月分數已按國發會修正為40）
export const TAIWAN_CLI_HISTORY = [
  { date: '2025-01', score: 34, signal: '黃紅燈' },
  { date: '2025-05', score: 31, signal: '綠燈' },
  { date: '2025-06', score: 29, signal: '綠燈' },
  { date: '2025-07', score: 29, signal: '綠燈' },
  { date: '2025-09', score: 35, signal: '黃紅燈' },
  { date: '2025-11', score: 37, signal: '黃紅燈' },
  { date: '2025-12', score: 38, signal: '紅燈' },
  { date: '2026-01', score: 39, signal: '紅燈' },
  { date: '2026-02', score: 40, signal: '紅燈' },
  { date: '2026-03', score: 39, signal: '紅燈' },
  { date: '2026-04', score: 40, signal: '紅燈' },
  { date: '2026-05', score: 39, signal: '紅燈' },
]
