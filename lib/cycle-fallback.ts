/**
 * 景氣循環模型的「內建墊檔」——最後一道防線。
 *
 * 為什麼需要：route.ts 的 lastGood 墊檔存在 lambda 記憶體裡，冷啟動就是空的。
 * 而網站整夜沒流量，每天 08:00 健檢那一發正好都是當天第一個請求 —— 最需要墊檔的
 * 時候偏偏一定沒有。2026-08-06、08-19、09-01 三次「OECD CLI、殖利率利差、循環階段
 * 為空」的告警都是這樣來的（實測請求耗時 26~36 秒 = Gist 重試全部逾時）。
 *
 * OECD CLI 與殖利率利差都是月更資料，沿用上一份完全不影響判讀，所以直接把最後一份
 * 已知good的值寫死在 repo 裡。真的過期不會被蓋掉：健檢會拿 oecdCliDate / yieldSpreadDate
 * 比對 OECD 發布日曆，落後就告警。
 *
 * 維護：這份數字不用每月更新（月更 Gist 正常時根本用不到它）。
 * 但如果哪次健檢報「停在 YYYY-MM，依發布日曆應已有 …」而 Gist 本身是新的，
 * 代表墊檔被長期使用中，順手把下面的值同步成 Gist 現值即可。
 * Gist 來源：https://gist.github.com/blackswan1207-commits/9250d2a987aeebd6d6ec6f61a47b6f23
 */

export const CYCLE_FALLBACK = {
  // 同步自 Gist（Gist lastUpdated: 2026-08-12）
  oecdCli: {
    value: 100.36,
    date: '2026-06',
    direction: 'falling' as const,
  },
  yieldSpread: {
    current: 0.73,
    avg: 0.3953,
    std: 0.9822,
    date: '2026-08',
  },
}
