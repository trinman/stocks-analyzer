import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { StrategyParameters } from '../types.ts';
import type { RunSnapshot } from '../services/runSnapshot.ts';
import { lockHoldout, evaluateHoldout, evaluationRecord,
  type HoldoutPlan, type SearchRecord, type LockedHoldout, type ValidationRecord } from '../services/holdoutService.ts';
import { readHistory, recordExposure, overlappingExposure, saveValidationRecord, serializeRecord } from '../services/validationHistory.ts';
import { AnalysisChat } from './AnalysisChat.tsx';
import { exportToCSV } from '../utils.ts';

const button = 'px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed';
const panel = 'p-4 sm:p-6 border border-slate-200 rounded-xl dark:border-slate-700 space-y-3 leading-relaxed';
function display(value: number | null | undefined, suffix = '') { return value == null || !Number.isFinite(value) ? 'N/A' : value.toFixed(2) + suffix; }
function riskMetric(run: RunSnapshot, which: 'sharpeRatio' | 'sortinoRatio') {
  const returns = run.result.equity.map((e, i, a) => e / (i ? a[i - 1] : 10000) - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  if (which === 'sortinoRatio' ? !returns.some(r => r < 0) : returns.every(r => Math.abs(r - mean) < 1e-12)) return null;
  return run.result.metrics[which];
}
function summary(run: RunSnapshot) {
  const m = run.result.metrics;
  return { 'Net return (%)': display(m.totalReturn), 'CAGR (%)': display(m.cagr), 'Buy & hold return (%)': display(run.benchmark.ret),
    'Buy & hold CAGR (%)': display(run.benchmark.cagr), 'Sharpe (zero reference)': display(riskMetric(run, 'sharpeRatio')),
    'Sortino (zero target)': display(riskMetric(run, 'sortinoRatio')), 'Maximum drawdown (%)': display(m.maxDrawdown),
    'Longest drawdown (calendar days)': display(m.maxDrawdownDurationDays), 'Profit factor': display(m.numTrades ? m.profitFactor : null),
    'Completed trades': String(m.numTrades), 'Exposure (%)': display(m.timeInMarketPct), 'Turnover (% of starting capital)': display(m.turnoverPct) };
}
function EquityChart({ run, title }: {run: RunSnapshot; title: string}) {
  return <section className={panel}><h3 className="font-bold">{title}</h3><p className="text-sm">{run.startDate} to {run.endDate} · {run.bars} scoring bars · Starts in cash with $10,000</p>
    <div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={run.result.equity.map((equity, i) => ({date: run.result.equityDates[i], Strategy: equity, 'Buy & hold': run.benchmark.equity[i]}))}>
      <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" minTickGap={60}/><YAxis width={75}/><Tooltip formatter={v => typeof v === 'number' ? display(v) : String(v ?? 'N/A')}/><Legend/>
      <Line dataKey="Strategy" stroke="#2563eb" dot={false} isAnimationActive={false}/><Line dataKey="Buy & hold" stroke="#94a3b8" dot={false} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer></div></section>;
}
function downloadRecord(record: ValidationRecord) {
  const url = URL.createObjectURL(new Blob([serializeRecord(record)], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `${record.symbol}_holdout_${record.id}.json`; a.click(); URL.revokeObjectURL(url);
}
function exportComparison(record: ValidationRecord) {
  const dev = summary(record.development), evaluation = record.evaluation ? summary(record.evaluation) : null;
  exportToCSV(Object.keys(dev).map(metric => ({experiment_id:record.id, symbol:record.symbol, timeframe:record.plan.timeframe,
    metric, development:dev[metric as keyof typeof dev], evaluation:evaluation?.[metric as keyof typeof dev] ?? '',
    development_start:record.development.startDate, development_end:record.development.endDate,
    evaluation_start:record.plan.evaluationStart, evaluation_end:record.plan.evaluationEnd,
    prior_knowledge:record.priorKnowledge, local_reuse:record.reuse, data_fingerprint:record.dataFingerprint,
    assumptions:record.development.methodology.metrics, benchmark:record.development.methodology.benchmark})), `${record.symbol}_holdout_comparison.csv`);
}

interface ValidationProps {
  symbol: string;
  plan: HoldoutPlan;
  params: StrategyParameters;
  development: RunSnapshot | null;
  searches: SearchRecord[];
  prior: LockedHoldout['priorKnowledge'];
  historyWarning: string;
  onBacktest: () => void;
  onRestart: () => void;
}

// Kept mounted across tabs; App remounts this review when the experiment inputs change.
export function HoldoutValidation({symbol, plan, params, development, searches, prior, historyWarning, onBacktest, onRestart}: ValidationProps) {
  const [locked, setLocked] = useState<LockedHoldout | null>(null);
  const [record, setRecord] = useState<ValidationRecord | null>(null);
  const [saved, setSaved] = useState<ValidationRecord[]>([]);
  const [error, setError] = useState('');
  const [storageNote, setStorageNote] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; try {setSaved(readHistory(localStorage).records);} catch {setStorageNote('Browser history is unavailable. Prior exposure is unknown; export results to keep a copy.');} return () => {alive.current = false;};}, []);
  async function lock() {
    if (!plan || !development || busy) return;setBusy(true);setError('');
    try {const result=await lockHoldout(symbol,plan,params,searches,prior);if(alive.current)setLocked(result);} catch(e) {if(alive.current)setError((e as Error).message);} finally {if(alive.current)setBusy(false);}
  }
  function evaluate() {
    if (!locked || record) return;setError('');
    let reuse:ValidationRecord['reuse']='unknown';
    try {
      const history=readHistory(localStorage);
      reuse=(storageNote || historyWarning) ? 'unknown' : overlappingExposure(history.exposures,symbol,locked.plan.evaluationStart,locked.plan.evaluationEnd)?'previously-recorded':'first-recorded-here';
      // Record exposure BEFORE evaluation: errors/reloads cannot make a revealed period fresh.
      recordExposure(localStorage,{symbol,start:locked.plan.evaluationStart,end:locked.plan.evaluationEnd,recordedAt:new Date().toISOString(),source:'evaluation'});
      saveValidationRecord(localStorage,evaluationRecord(locked,reuse));
    } catch {reuse='unknown';setStorageNote('History could not be saved. Prior exposure is unknown. Download the experiment record.');}
    try {
      const result=evaluateHoldout(locked,reuse);setRecord(result);
      try {saveValidationRecord(localStorage,result);setSaved(readHistory(localStorage).records);} catch {setStorageNote('Result could not be saved in this browser. Download the experiment record before leaving.');}
    } catch(e) {setError((e as Error).message);}
  }
  return <div className="space-y-6 leading-relaxed text-slate-700 dark:text-slate-200">
    <p>Review the strategy developed in Backtest &amp; AI, lock its settings, then run the reserved evaluation. Optimization is optional.</p>
    <p className="text-sm">{symbol} · Single chronological holdout · Long only · Browser records cannot certify unseen data or track work on other devices.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {storageNote && <p role="alert" className="text-amber-700 dark:text-amber-300">{storageNote}</p>}
    {!locked && <section className={panel}>
      <h3 className="text-xl font-bold">Review Before Validation</h3>
      <p>Development: {plan.developmentStart} → {plan.developmentEnd}<br/>Reserved evaluation: {plan.evaluationStart} → {plan.evaluationEnd}</p>
      <p>{plan.timeframe} bars · {plan.warmupBars} development warm-up bars · Commission: ${params.commission} per order · Slippage: {params.slipBps} bps per side.</p>
      <p>{searches.length} optimization searches recorded · {searches.reduce((n,s)=>n+s.combinations,0)} combinations tried.</p>
      <details><summary className="cursor-pointer font-semibold">Review Strategy Parameters</summary><pre className="text-xs whitespace-pre-wrap break-words mt-3 leading-relaxed">{JSON.stringify(params,null,2)}</pre></details>
      {!development && <p role="status">Run a development backtest with your current parameters in Step 3 before locking the strategy.</p>}
      <div className="flex flex-wrap justify-between gap-3 pt-2">
        <button className="px-4 py-2 border rounded-lg" onClick={onBacktest}>Back to Backtest</button>
        <button disabled={busy || !development} className={button} onClick={lock}>{busy?'Preparing…':'Lock Strategy'}</button>
      </div>
    </section>}
      {locked && <section className={panel}><h3 className="text-xl font-bold">Locked Strategy</h3><p>Parameters, costs, data, and dates are frozen for this experiment. Evaluation starts with $10,000 cash and no inherited position.</p>
        <p>Commission: ${locked.params.commission} per order · Slippage: {locked.params.slipBps} bps per side · Locked {locked.lockedAt}</p>
        <details><summary className="cursor-pointer">Review All Locked Parameters</summary><pre className="text-xs whitespace-pre-wrap break-words mt-2">{JSON.stringify(locked.params,null,2)}</pre></details>
        {!record&&<div className="flex justify-end pt-2"><button className={button} onClick={evaluate}>Run Validation</button></div>}
      </section>}
    {record?.evaluation && <section className="space-y-4"><h3 className="text-xl font-bold">Validation Results</h3>
      <p>{record.reuse==='first-recorded-here'?'First evaluation recorded here':record.reuse==='previously-recorded'?'Previously recorded exposure overlaps this evaluation period':'Prior local exposure unknown'} · {record.priorKnowledge==='not-reviewed'?'User reports no prior review (unverified)':'Retrospective / prior review unknown'}</p>
      <ul className="list-disc pl-5 space-y-2 text-amber-700 dark:text-amber-300">{record.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Metric</th><th className="p-2">Development</th><th className="p-2">Reserved Evaluation</th></tr></thead><tbody>{Object.entries(summary(record.development)).map(([k,v])=><tr key={k} className="border-t dark:border-slate-600"><th className="p-2 font-normal">{k}</th><td className="p-2">{v}</td><td className="p-2">{summary(record.evaluation!)[k as keyof ReturnType<typeof summary>]}</td></tr>)}</tbody></table></div>
      <p className="text-sm">N/A means the ratio has no valid denominator. Drawdown duration includes unrecovered drawdowns. Buy-and-hold excludes costs and dividends; strategy results include configured costs. Weekly/monthly drawdown uses interval closes and can miss losses within an interval.</p>
      <div className="grid lg:grid-cols-2 gap-4"><EquityChart run={record.development} title="Development Equity"/><EquityChart run={record.evaluation} title="Evaluation Equity"/></div>
      <div className="flex flex-wrap gap-3"><button className={button} onClick={()=>downloadRecord(record)}>Download Experiment JSON</button><button className={button} onClick={()=>exportComparison(record)}>Export Comparison CSV</button></div>
      <details className={panel}><summary className="font-bold cursor-pointer">AI Review of Validation Results</summary><p>Optional. Sends this evaluation and development summary to the AI only when you select Generate AI Analysis.</p><AnalysisChat key={record.id} run={record.evaluation}/></details>
    </section>}
    {locked && <div className="flex flex-wrap justify-between gap-3 pt-2"><button className="px-4 py-2 border rounded-lg" onClick={onBacktest}>Back to Backtest</button><button className="px-4 py-2 border rounded-lg" disabled={busy} onClick={onRestart}>Start New Experiment</button></div>}
    {locked && <p className="text-sm">Changing strategy parameters, timeframe, or reserved dates resets this review. Saved evaluations remain in browser history; reusing their dates is not a fresh unseen test.</p>}
    {saved.length>0&&<details className={panel}><summary className="font-bold cursor-pointer">Saved Experiments in This Browser ({saved.length})</summary><p>Newest experiments appear first. Records are local to this site and browser. Clearing storage removes them. Download records for a durable copy; they are not tamper-proof.</p>{[...saved].sort((a,b)=>b.lockedAt.localeCompare(a.lockedAt)).map(r=><div className="flex flex-wrap justify-between gap-2 border-t py-2" key={r.id}><span>{r.symbol} · {r.plan.evaluationStart} → {r.plan.evaluationEnd} · {r.status} · {r.lockedAt}</span><button className="underline" onClick={()=>downloadRecord(r)}>Download record</button></div>)}</details>}
  </div>;
}
