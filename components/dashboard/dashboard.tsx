'use client'

import useSWR from 'swr'
import type { SentimentPayload, ContangoData, FearGreedData, CryptoFearGreedData, CanaryData } from '@/lib/types'
import { HeaderClock } from './header-clock'
import { MetricPanel } from './metric-panel'
import { Sparkline } from './sparkline'
import { FearGreedGauge } from './fear-greed-gauge'
import { ContangoDetail } from './contango-detail'
import { CanaryDetail } from './canary-detail'
import { PlaceholderPanel } from './placeholder-panel'
import { StatusBar } from './status-bar'
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const TWO_HOURS = 2 * 60 * 60 * 1000

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return iso
  }
}

export function Dashboard() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<SentimentPayload>(
    '/api/sentiment',
    fetcher,
    {
      refreshInterval: TWO_HOURS,
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  const errorCount = data
    ? [data.vix, data.vvix, data.contango, data.fearGreed, data.aaii, data.cryptoFearGreed, data.canary].filter(
        (d) => d.error
      ).length
    : 0

  if (isLoading && !data) {
    return (
      <div className="min-h-screen bg-terminal-bg flex flex-col items-center justify-center gap-4">
        <RefreshCw className="h-8 w-8 text-terminal-orange animate-spin" />
        <p className="text-terminal-orange text-sm uppercase tracking-widest">
          Initializing Market Data Feed...
        </p>
        <p className="text-terminal-dim text-xs">
          Connecting to data sources
        </p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-terminal-bg flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-8 w-8 text-terminal-red" />
        <p className="text-terminal-red text-sm uppercase tracking-widest">
          Data Feed Connection Failed
        </p>
        <button
          onClick={() => mutate()}
          className="text-terminal-orange text-xs border border-terminal-orange px-3 py-1 hover:bg-terminal-orange hover:text-terminal-bg transition-colors"
        >
          RETRY CONNECTION
        </button>
      </div>
    )
  }

  const contango = data?.contango as ContangoData | undefined
  const fearGreed = data?.fearGreed as FearGreedData | undefined
  const cryptoFG = data?.cryptoFearGreed as CryptoFearGreedData | undefined
  const canary = data?.canary as CanaryData | undefined

  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between border-b border-terminal-border bg-terminal-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <Activity className="h-4 w-4 text-terminal-orange" />
          <h1 className="text-terminal-orange text-sm font-bold uppercase tracking-widest">
            Market Sentiment War Room
          </h1>
          <span className="text-terminal-dim text-[10px] uppercase">Phase 1</span>
        </div>
        <HeaderClock />
      </header>

      {/* Main Grid */}
      <main className="flex-1 p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-min">
        {/* VIX Panel */}
        <MetricPanel
          title="CBOE VIX Index"
          value={data?.vix.value ?? null}
          change={data?.vix.change}
          history={data?.vix.history ?? []}
          error={data?.vix.error}
          subtitle="CBOE Volatility Index - Fear Gauge"
          sparklineColor="auto"
          lastUpdated={data?.vix.lastUpdated}
          dataSource={data?.vix.dataSource}
        />

        {/* VVIX Panel */}
        <MetricPanel
          title="CBOE VVIX Index"
          value={data?.vvix.value ?? null}
          change={data?.vvix.change}
          history={data?.vvix.history ?? []}
          error={data?.vvix.error}
          subtitle="Volatility of Volatility"
          sparklineColor="auto"
          lastUpdated={data?.vvix.lastUpdated}
          dataSource={data?.vvix.dataSource}
        />

        {/* Contango Panel */}
        <MetricPanel
          title="VIX Futures Contango"
          value={contango?.value ?? null}
          change={contango?.change}
          unit="%"
          history={contango?.history ?? []}
          error={contango?.error}
          subtitle="Contango = Spread / VIX(F1)"
          sparklineColor="#4fc3f7"
          lastUpdated={contango?.lastUpdated}
          dataSource={contango?.dataSource}
          extraInfo={
            <ContangoDetail
              f1={contango?.f1}
              f2={contango?.f2}
              f1Symbol={contango?.f1Symbol}
              f2Symbol={contango?.f2Symbol}
              spread={contango?.spread}
            />
          }
        />

        {/* CNN Fear & Greed Panel */}
        <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px]">
          <div className="flex items-center justify-between">
            <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
              CNN Fear & Greed
            </h3>
            <div className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-blink-dot" aria-hidden="true" />
          </div>

          {fearGreed?.error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <AlertTriangle className="h-5 w-5 text-terminal-red" />
              <p className="text-terminal-red text-[10px] leading-tight">{fearGreed.error}</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums animate-pulse-glow">
                  {fearGreed?.value != null ? Math.round(fearGreed.value) : '--'}
                </span>
                <span className="text-[10px] text-terminal-dim">/100</span>
                {fearGreed?.change != null && (
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      fearGreed.change > 0 ? 'text-terminal-green' : fearGreed.change < 0 ? 'text-terminal-red' : 'text-foreground'
                    }`}
                  >
                    {fearGreed.change > 0 ? '\u25B2' : fearGreed.change < 0 ? '\u25BC' : ''}{' '}
                    {Math.abs(fearGreed.change).toFixed(1)}
                  </span>
                )}
              </div>

              <FearGreedGauge
                score={fearGreed?.value ?? null}
                classification={fearGreed?.classification}
              />

              <div className="mt-auto">
                <Sparkline
                  data={fearGreed?.history ?? []}
                  color="#d4a843"
                  height={36}
                />
              </div>

              {(fearGreed?.lastUpdated || fearGreed?.dataSource) && (
                <div className="flex items-center justify-between text-[9px] text-terminal-dim pt-1 border-t border-terminal-border/50">
                  {fearGreed?.lastUpdated && <span>{formatTimestamp(fearGreed.lastUpdated)}</span>}
                  {fearGreed?.dataSource && <span>via {fearGreed.dataSource}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* AAII Panel */}
        <MetricPanel
          title="AAII Bull-Bear Spread"
          value={data?.aaii.value ?? null}
          change={data?.aaii.change}
          unit="%"
          history={data?.aaii.history ?? []}
          error={data?.aaii.error}
          subtitle="US Investor Sentiment Survey"
          sparklineColor="#4fc3f7"
          invertColor
          lastUpdated={data?.aaii.lastUpdated}
          dataSource={data?.aaii.dataSource}
        />

        {/* Crypto Fear & Greed Panel */}
        <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px]">
          <div className="flex items-center justify-between">
            <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
              Crypto Fear & Greed
            </h3>
            <div className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-blink-dot" aria-hidden="true" />
          </div>

          {cryptoFG?.error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <AlertTriangle className="h-5 w-5 text-terminal-red" />
              <p className="text-terminal-red text-[10px] leading-tight">{cryptoFG.error}</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums animate-pulse-glow">
                  {cryptoFG?.value != null ? Math.round(cryptoFG.value) : '--'}
                </span>
                <span className="text-[10px] text-terminal-dim">/100</span>
                {cryptoFG?.change != null && (
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      cryptoFG.change > 0 ? 'text-terminal-green' : cryptoFG.change < 0 ? 'text-terminal-red' : 'text-foreground'
                    }`}
                  >
                    {cryptoFG.change > 0 ? '\u25B2' : cryptoFG.change < 0 ? '\u25BC' : ''}{' '}
                    {Math.abs(cryptoFG.change).toFixed(0)}
                  </span>
                )}
              </div>

              <FearGreedGauge
                score={cryptoFG?.value ?? null}
                classification={cryptoFG?.classification}
              />

              <div className="mt-auto">
                <Sparkline
                  data={cryptoFG?.history ?? []}
                  color="#f7931a"
                  height={36}
                />
              </div>

              {(cryptoFG?.lastUpdated || cryptoFG?.dataSource) && (
                <div className="flex items-center justify-between text-[9px] text-terminal-dim pt-1 border-t border-terminal-border/50">
                  {cryptoFG?.lastUpdated && <span>{formatTimestamp(cryptoFG.lastUpdated)}</span>}
                  {cryptoFG?.dataSource && <span>via {cryptoFG.dataSource}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Canary Ratio Panel */}
        <div className="flex flex-col border border-terminal-border bg-terminal-panel p-3 gap-2 min-h-[160px]">
          <div className="flex items-center justify-between">
            <h3 className="text-terminal-orange text-xs font-bold uppercase tracking-wider">
              Canary Ratio
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-terminal-dim">Monthly</span>
              <div className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-blink-dot" aria-hidden="true" />
            </div>
          </div>

          {canary?.error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <AlertTriangle className="h-5 w-5 text-terminal-red" />
              <p className="text-terminal-red text-[10px] leading-tight">{canary.error}</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground tabular-nums animate-pulse-glow">
                  {canary?.value != null ? `${canary.value}%` : '--'}
                </span>
                <span
                  className={`text-xs font-bold ${
                    canary?.value === 100
                      ? 'text-terminal-green'
                      : canary?.value === 0
                      ? 'text-terminal-red'
                      : 'text-yellow-500'
                  }`}
                >
                  {canary?.value === 100 ? 'RISK ON' : canary?.value === 0 ? 'RISK OFF' : 'PARTIAL'}
                </span>
              </div>

              <p className="text-terminal-dim text-[10px]">
                VWO(M) + BND(M) momentum signal
              </p>

              <CanaryDetail
                vwoMomentum={canary?.vwoMomentum}
                bndMomentum={canary?.bndMomentum}
                n={canary?.n}
                vwoReturns={canary?.vwoReturns}
                bndReturns={canary?.bndReturns}
              />

              <div className="mt-auto">
                <Sparkline
                  data={canary?.history ?? []}
                  color="#9c27b0"
                  height={36}
                />
              </div>

              {(canary?.lastUpdated || canary?.dataSource) && (
                <div className="flex items-center justify-between text-[9px] text-terminal-dim pt-1 border-t border-terminal-border/50">
                  {canary?.lastUpdated && <span>{formatTimestamp(canary.lastUpdated)}</span>}
                  {canary?.dataSource && <span>Data: {canary.dataSource}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Placeholder for Phase 2 */}
        <PlaceholderPanel />
      </main>

      {/* Bottom Status Bar */}
      <StatusBar
        lastUpdated={data?.timestamp ?? null}
        isLoading={isValidating}
        onRefresh={() => mutate()}
        errorCount={errorCount}
      />
    </div>
  )
}
