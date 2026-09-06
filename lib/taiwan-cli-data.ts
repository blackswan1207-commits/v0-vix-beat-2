// 台灣景氣對策信號歷史資料（來源：國發會，每月27日左右發布上個月數據）
// 燈號對照：藍(9-16) 黃藍(17-22) 綠(23-31) 黃紅(32-37) 紅(38-45)
// 注意：此為手動維護的靜態資料，每月國發會發布後需補一筆。
//
// 2026-09-06 全面核對（國發會景氣指標查詢系統 index.ndc.gov.tw）：
//   官網有 Cloudflare，curl 一律 403，但用真實瀏覽器開得起來 —— 進
//   /n/zh_tw/data/eco/indicators_table1 切「改用表格呈現」即可讀到官方表格。
//   本次一次補齊 2025-01~2026-07 全部月份（原本缺 2025-02~04、08、10），
//   並依官網現值修正三筆舊資料（國發會每月發布時會回溯修正歷史資料）：
//     2025-01 34→35、2025-09 35→34、2026-02 40→41
//   交叉驗證：2025-12 起連續紅燈至 2026-07 剛好 8 個月，與媒體報導「連8紅」相符；
//   2026-07 為 41 分、與 6 月持平，經濟日報／TechNews（2026-08-27）一致。
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
