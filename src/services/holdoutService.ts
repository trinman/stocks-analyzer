import type { StockData, StrategyParameters, Timeframe, Benchmark } from '../types.ts';
import { resampleOHLC } from './apiServices.ts';
import { calculateAllIndicators, runBacktest, runOptimization } from './tradingService.ts';
import { validateStockData, validateParameters, requiredBars } from './validation.ts';
import { createRunSnapshot, type RunSnapshot } from './runSnapshot.ts';

export interface HoldoutPlan {
  data: StockData;
  timeframe: Timeframe;
  splitIndex: number;
  warmupBars: number;
  requestedSplit: string;
  evaluationStart: string;
  developmentStart: string;
  developmentEnd: string;
  evaluationEnd: string;
  asOf: string;
}
export interface SearchSettings {
  param1: string; range1: number[]; param2: string; range2: number[]; metric: string;
}
export interface SearchRecord extends SearchSettings {
  combinations: number; eligible: number; selected: StrategyParameters | null; score: number | null;
}
export interface LockedHoldout {
  id: string;
  lockedAt: string;
  symbol: string;
  dataFingerprint: string;
  params: StrategyParameters;
  plan: HoldoutPlan;
  searches: SearchRecord[];
  priorKnowledge: 'reviewed' | 'unknown' | 'not-reviewed';
  development: RunSnapshot;
}
export interface ValidationRecord extends Omit<LockedHoldout, 'plan'> {
  plan: Omit<HoldoutPlan, 'data'>;
  evaluation?: RunSnapshot;
  status: 'started' | 'complete';
  reuse: 'previously-recorded' | 'first-recorded-here' | 'unknown';
  warnings: string[];
}

export function sliceData(data: StockData, start: number, end = data.dates.length): StockData {
  return { dates: data.dates.slice(start, end), o: data.o.slice(start, end), h: data.h.slice(start, end),
    l: data.l.slice(start, end), c: data.c.slice(start, end), v: data.v.slice(start, end),
    ...(data.openDates ? { openDates: data.openDates.slice(start, end) } : {}) };
}

// Validation excludes today's daily bar, and both edge aggregates. Without an exchange
// calendar we cannot prove an edge week/month is complete. This conservative rule is
// explicit in the UI and frozen in each experiment; it never inspects future prices.
export function validationBars(daily: StockData, timeframe: Timeframe, asOf: string): StockData {
  validateStockData(daily);
  const cutoff = daily.dates.findIndex(d => d >= asOf);
  const closed = sliceData(daily, 0, cutoff < 0 ? daily.dates.length : cutoff);
  if (timeframe === 'daily') return { ...closed, openDates: [...closed.dates] };
  const bars = resampleOHLC(closed, timeframe);
  let first = 0;
  bars.openDates = bars.dates.map(end => {
    const start = closed.dates[first];
    while (first < closed.dates.length && closed.dates[first] <= end) first++;
    return start;
  });
  return sliceData(bars, 1, bars.dates.length - 1);
}

export function makeHoldoutPlan(daily: StockData, timeframe: Timeframe, requestedSplit: string, warmupBars: number, asOf: string): HoldoutPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedSplit) || !Number.isFinite(Date.parse(requestedSplit))) throw new Error('Choose an evaluation start date.');
  const data = validationBars(daily, timeframe, asOf);
  validateStockData(data);
  const splitIndex = data.openDates!.findIndex(d => d >= requestedSplit);
  if (!Number.isInteger(warmupBars) || warmupBars < 14 || warmupBars > 2000) throw new Error('Warm-up must be a whole number from 14 to 2,000 bars.');
  if (splitIndex < warmupBars + 2 || data.dates.length - splitIndex < 2) throw new Error('Insufficient history: reserve at least two scoring bars on each side after development warm-up.');
  return { data, timeframe, requestedSplit, splitIndex, warmupBars, asOf,
    developmentStart: data.openDates![warmupBars], developmentEnd: data.dates[splitIndex - 1],
    evaluationStart: data.openDates![splitIndex], evaluationEnd: data.dates.at(-1)! };
}

export function checkHoldoutParameters(plan: HoldoutPlan, params: StrategyParameters): void {
  const errors = validateParameters(params);
  if (errors.length) throw new Error(errors.join(' '));
  if (requiredBars(params) - 1 > plan.warmupBars) throw new Error(`This strategy needs ${requiredBars(params) - 1} warm-up bars; the experiment allows ${plan.warmupBars}. Start a new period setup or shorten the indicators.`);
}

export function periodBenchmark(data: StockData, start: number): Benchmark {
  const equity = data.c.slice(start).map(c => 10000 * c / data.o[start]);
  const ret = (equity.at(-1)! / 10000 - 1) * 100;
  const years = (Date.parse(data.dates.at(-1)!) - Date.parse(data.openDates?.[start] ?? data.dates[start])) / (365.25 * 86400000);
  return { equity, ret, cagr: years > 0 ? (Math.pow(1 + ret / 100, 1 / years) - 1) * 100 : 0 };
}

function periodRun(symbol: string, plan: HoldoutPlan, params: StrategyParameters, evaluation: boolean): RunSnapshot {
  checkHoldoutParameters(plan, params);
  const data = evaluation ? plan.data : sliceData(plan.data, 0, plan.splitIndex);
  const start = evaluation ? plan.splitIndex : plan.warmupBars;
  const result = runBacktest(data, calculateAllIndicators(data, params), params, plan.timeframe, start);
  const run = createRunSnapshot(symbol, plan.timeframe, sliceData(data, start), params, result, periodBenchmark(data, start));
  run.startDate = data.openDates![start];
  run.methodology = { ...run.methodology, engineVersion: '3-holdout',
    execution: `${run.methodology.execution} Each holdout period starts in cash. Open fills use the interval's first session; intrabar stop/target dates use its final session (exact intrabar time unknown).`,
    metrics: 'Warm-up excluded. Close-sampled equity at selected bar frequency, including first scoring-bar return and final liquidation costs. Sharpe/Sortino use zero reference return. Undefined ratios are labeled in the UI.',
    benchmark: 'Price-only buy and hold from first scoring open to final scoring close; fractional units, no fees or dividends. Same scoring dates as strategy.',
    data: 'FMP OHLCV; corporate-action adjustment not independently verified; dividends excluded. Today excluded. First and last weekly/monthly aggregates excluded conservatively.',
    validation: evaluation ? 'Locked chronological holdout; prior review and local reuse must be considered. Not certified unseen or predictive.' : 'Development-only result used for strategy selection; not out-of-sample.' };
  return run;
}
export const runDevelopment = (symbol: string, plan: HoldoutPlan, params: StrategyParameters) => periodRun(symbol, plan, params, false);

export function optimizeDevelopment(plan: HoldoutPlan, base: StrategyParameters, search: SearchSettings) {
  checkHoldoutParameters(plan, base);
  // Crucially, no evaluation prices are passed to optimization or indicator calculation.
  const development = sliceData(plan.data, 0, plan.splitIndex);
  const result = runOptimization(development, base, search.param1, search.range1, search.param2, search.range2, search.metric, plan.timeframe, plan.warmupBars);
  const record: SearchRecord = { ...structuredClone(search), combinations: search.range1.length * Math.max(1, search.range2.length),
    eligible: result.grid.flat().filter(Number.isFinite).length,
    selected: result.best ? { ...base, ...result.best.params } : null, score: result.best?.score ?? null };
  return { result, record };
}

export async function fingerprint(data: StockData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
export async function lockHoldout(symbol: string, plan: HoldoutPlan, params: StrategyParameters, searches: SearchRecord[], priorKnowledge: LockedHoldout['priorKnowledge']): Promise<LockedHoldout> {
  // Clone synchronously, before the digest yields, so edits cannot change a locked run.
  const frozen = structuredClone({ plan, params, searches });
  return { ...frozen, symbol, priorKnowledge, id: crypto.randomUUID(), lockedAt: new Date().toISOString(),
    dataFingerprint: await fingerprint(frozen.plan.data), development: runDevelopment(symbol, frozen.plan, frozen.params) };
}
export function evaluationRecord(lock: LockedHoldout, reuse: ValidationRecord['reuse']): ValidationRecord {
  const { data: _data, ...plan } = lock.plan;
  return { ...structuredClone(lock), plan, reuse, status: 'started', warnings: [] };
}
export function evaluateHoldout(lock: LockedHoldout, reuse: ValidationRecord['reuse']): ValidationRecord {
  const record = evaluationRecord(lock, reuse);
  record.evaluation = periodRun(lock.symbol, lock.plan, lock.params, true);
  record.status = 'complete';
  record.warnings = evidenceWarnings(record);
  record.evaluation.validation = { experimentId: record.id, dataFingerprint: record.dataFingerprint,
    lockedAt: record.lockedAt, splitDate: record.plan.evaluationStart, priorKnowledge: record.priorKnowledge,
    reuse: record.reuse, development: { startDate: record.development.startDate, endDate: record.development.endDate,
      metrics: record.development.result.metrics, benchmark: record.development.benchmark.ret },
    warnings: record.warnings, searchCombinations: record.searches.reduce((n, s) => n + s.combinations, 0) };
  return record;
}
export function evidenceWarnings(record: ValidationRecord): string[] {
  const messages = ['A chronological split does not prove the evaluation data was previously unseen.'];
  if (record.priorKnowledge !== 'not-reviewed' || record.reuse !== 'first-recorded-here') messages.push('Retrospective/reused or unknown prior exposure: treat this as research, not a fresh unseen test.');
  for (const [label, run] of [['Development', record.development], ['Evaluation', record.evaluation]] as const) {
    if (!run) continue;
    if (run.result.metrics.numTrades < 20) messages.push(`${label}: only ${run.result.metrics.numTrades} completed trades. Sparse evidence; 20 is a caution threshold, not a statistical guarantee.`);
    if (run.bars < 100) messages.push(`${label}: only ${run.bars} scoring bars. Risk metrics may be unstable.`);
  }
  return messages;
}
