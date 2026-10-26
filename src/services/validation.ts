import type { StockData, StrategyParameters, Timeframe } from '../types.ts';

export function validateParameters(p: StrategyParameters): string[] {
  const errors: string[] = [];
  const periods = ['bbPeriod', 'rsiPeriod', 'macdFast', 'macdSlow', 'macdSignal', 'trendFilterPeriod', 'momentumSMAPeriod'] as const;
  for (const key of periods) {
    if (!Number.isInteger(p[key]) || p[key] < 2 || p[key] > 1000) errors.push(`${key} must be a whole number from 2 to 1000.`);
  }
  for (const key of ['bbStd', 'stopATR', 'trailingATRMultiplier', 'takeProfitATR'] as const) {
    if (!Number.isFinite(p[key]) || p[key] <= 0 || p[key] > 100) errors.push(`${key} must be greater than 0 and at most 100.`);
  }
  if (!Number.isFinite(p.riskPct) || p.riskPct <= 0 || p.riskPct > 100) errors.push('Risk per trade must be greater than 0 and at most 100%.');
  if (!Number.isFinite(p.commission) || p.commission < 0 || p.commission >= 10000) errors.push('Commission must be between $0 and $9,999.99.');
  if (!Number.isFinite(p.slipBps) || p.slipBps < 0 || p.slipBps > 1000) errors.push('Slippage must be between 0 and 1000 basis points.');
  if (![p.rsiOversold, p.rsiOverbought].every(x => Number.isFinite(x) && x >= 0 && x <= 100) || p.rsiOversold >= p.rsiOverbought) errors.push('RSI thresholds must satisfy 0 ≤ oversold < overbought ≤ 100.');
  if (p.macdFast >= p.macdSlow) errors.push('MACD fast period must be shorter than its slow period.');
  for (const key of ['useBB', 'useRSI', 'useMACD', 'useTrailingStop', 'useTrendFilter', 'useTakeProfit', 'useMomentumEntry', 'allowFractionalShares'] as const) {
    if (typeof p[key] !== 'boolean') errors.push(`${key} must be enabled or disabled.`);
  }
  if (p.trailingStopActivation !== undefined && !['immediate', 'ratchet'].includes(p.trailingStopActivation)) errors.push('Choose a valid trailing-stop mode.');
  if (!p.useBB && !p.useRSI && !p.useMACD && !p.useMomentumEntry) errors.push('Enable at least one entry indicator or momentum entry.');
  return errors;
}

export function validateStockData(data: StockData): void {
  const n = data?.dates?.length;
  if (!n || n < 2 || n > 10000) throw new Error('Market data must contain 2–10,000 bars.');
  for (const key of ['o', 'h', 'l', 'c', 'v'] as const) {
    if (!Array.isArray(data[key]) || data[key].length !== n) throw new Error('Market-data arrays have inconsistent lengths.');
  }
  data.dates.forEach((date, i) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || (i > 0 && date <= data.dates[i - 1])) throw new Error('Market dates must be valid, unique, and in chronological order.');
    if (![data.o[i], data.h[i], data.l[i], data.c[i]].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(data.v[i]) || data.v[i] < 0) throw new Error(`Invalid market values on ${date}.`);
    if (data.h[i] < Math.max(data.o[i], data.c[i], data.l[i]) || data.l[i] > Math.min(data.o[i], data.c[i])) throw new Error(`Inconsistent OHLC prices on ${date}.`);
  });
}

// Index of the first usable signal, plus its following execution bar.
export function requiredBars(p: StrategyParameters): number {
  return Math.max(13, p.useBB ? p.bbPeriod - 1 : 0,
    p.useRSI || p.useMomentumEntry ? p.rsiPeriod : 0,
    p.useMACD ? p.macdSlow + p.macdSignal - 1 : 0,
    p.useTrendFilter ? p.trendFilterPeriod - 1 : 0,
    p.useMomentumEntry ? p.momentumSMAPeriod - 1 : 0) + 2;
}

export function validateBacktest(data: StockData, p: StrategyParameters, timeframe: Timeframe): void {
  validateStockData(data);
  if (!['daily', 'weekly', 'monthly'].includes(timeframe)) throw new Error('Choose a valid timeframe.');
  const errors = validateParameters(p);
  if (errors.length) throw new Error(errors.join(' '));
  const needed = requiredBars(p);
  if (data.dates.length < needed) throw new Error(`Not enough ${timeframe} history: ${data.dates.length} bars available; at least ${needed} required for warm-up and a next-bar entry. Reduce indicator periods or choose a shorter timeframe.`);
}
