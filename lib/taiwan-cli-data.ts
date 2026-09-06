// 台灣景氣對策信號的「內建墊檔」——最後一道防線，平常用不到。
// 燈號對照：藍(9-16) 黃藍(17-22) 綠(23-31) 黃紅(32-37) 紅(38-45)
//
// 2026-09-06 起，這份資料改由本機排程 fetch-ndc-cli.py 每日抓國發會 → 寫進
// Gist relay（taiwan-cli.json），網站優先讀 relay，抓不到才退回這裡。
// 所以**不需要每月手動維護**；只有 relay 長期掛掉時才會被用到，
// 而那種情況健檢的 TAIWAN_MAX_DAYS 會叫。
//
// 下面這份是 2026-09-06 對照國發會官網逐月核對過的 2025-01~2026-07，
// 已與 API 抓下來的 19 個重疊月份逐筆比對一致。
// 注意：國發會每月發布時會回溯修正歷史資料，所以排程是整段重寫而非只 append。
export const TAIWAN_CLI_HISTORY = [
  { date: '2025-01', score: 35, signal: '黃紅燈' },
  { date: '2025-02', score: 37, signal: '黃紅燈' },
  { date: '2025-03', score: 35, signal: '黃紅燈' },
  { date: '2025-04', score: 33, signal: '黃紅燈' },
  { date: '2025-05', score: 31, signal: '綠燈' },
  { date: '2025-06', score: 29, signal: '綠燈' },
  { date: '2025-07', score: 29, signal: '綠燈' },
  { date: '2025-08', score: 31, signal: '綠燈' },
  { date: '2025-09', score: 34, signal: '黃紅燈' },
  { date: '2025-10', score: 35, signal: '黃紅燈' },
  { date: '2025-11', score: 37, signal: '黃紅燈' },
  { date: '2025-12', score: 38, signal: '紅燈' },
  { date: '2026-01', score: 39, signal: '紅燈' },
  { date: '2026-02', score: 41, signal: '紅燈' },
  { date: '2026-03', score: 39, signal: '紅燈' },
  { date: '2026-04', score: 40, signal: '紅燈' },
  { date: '2026-05', score: 39, signal: '紅燈' },
  { date: '2026-06', score: 41, signal: '紅燈' },
  { date: '2026-07', score: 41, signal: '紅燈' },
]
