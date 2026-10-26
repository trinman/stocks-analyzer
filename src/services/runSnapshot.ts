import type { BacktestResult, Benchmark, StockData, StrategyParameters, Timeframe } from '../types.ts';

export const methodology = {
  engineVersion: '2',
  startingCapital: 10000,
  execution: 'Long only; close-based signals execute at next bar open. Entry-bar stops apply. No re-entry after a same-bar exit. Gaps fill at open; ambiguous intrabar stop/target touches use stop first.',
  risk: 'Hard stop and take-profit use entry ATR. Trailing stops never loosen. Risk sizing includes commissions and estimated stop slippage; gaps can exceed planned risk.',
  metrics: 'Close-sampled drawdown including final liquidation costs. Sharpe and Sortino use zero risk-free/target return; downside deviation uses all bars. Exposure counts bars with any position. Indicators include warm-up within the reported test interval.',
  benchmark: 'Price-only buy and hold over the entire sample, without transaction costs. CAGR difference is not risk-adjusted alpha.',
  data: 'FMP daily OHLCV aggregated for weekly/monthly bars. Corporate-action adjustment is not independently verified; cash dividends are not included. Latest aggregate bar may be incomplete.',
  validation: 'Historical in-sample simulation, not an out-of-sample test or prediction.',
};

export interface RunSnapshot {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  bars: number;
  params: StrategyParameters;
  result: BacktestResult;
  benchmark: Benchmark;
  methodology: typeof methodology;
}

export function createRunSnapshot(symbol: string, timeframe: Timeframe, data: StockData, params: StrategyParameters, result: BacktestResult, benchmark: Benchmark): RunSnapshot {
  return structuredClone({ id: crypto.randomUUID(), symbol, timeframe, startDate: data.dates[0], endDate: data.dates.at(-1)!, bars: data.dates.length, params, result, benchmark, methodology });
}

export function runMatches(run: RunSnapshot | null, symbol: string, timeframe: Timeframe, params: StrategyParameters): boolean {
  return !!run && run.symbol === symbol && run.timeframe === timeframe && JSON.stringify(run.params) === JSON.stringify(params);
}

export function analysisContext(run: RunSnapshot) {
  const { signals: _signals, ...result } = run.result;
  return { symbol: run.symbol, timeframe: run.timeframe, startDate: run.startDate, endDate: run.endDate, bars: run.bars,
    params: run.params, result, benchmark: { ret: run.benchmark.ret, cagr: run.benchmark.cagr }, methodology };
}
