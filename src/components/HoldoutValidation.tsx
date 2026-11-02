import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { StockData, StrategyParameters, Timeframe } from '../types.ts';
import type { RunSnapshot } from '../services/runSnapshot.ts';
import { makeHoldoutPlan, validationBars, runDevelopment, optimizeDevelopment, lockHoldout, evaluateHoldout, evaluationRecord,
  type HoldoutPlan, type SearchRecord, type LockedHoldout, type ValidationRecord } from '../services/holdoutService.ts';
import { readHistory, recordExposure, overlappingExposure, saveValidationRecord, serializeRecord } from '../services/validationHistory.ts';
import { StrategyControls } from './StrategyControls.tsx';
import { AnalysisChat } from './AnalysisChat.tsx';
import { parseRangeSpec, exportToCSV } from '../utils.ts';

const button = 'px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed';
const field = 'p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600';
const panel = 'p-4 border rounded-lg dark:border-slate-600 space-y-3';
const axes = [['rsi_period', 'RSI Period'], ['rsi_oversold', 'RSI Oversold'], ['rsi_overbought', 'RSI Overbought'],
  ['bb_period', 'BB Period'], ['bb_std', 'BB Standard Deviation'], ['macd_fast', 'MACD Fast'], ['macd_slow', 'MACD Slow'],
  ['macd_signal', 'MACD Signal'], ['stop_loss_atr', 'Stop ATR'], ['risk_per_trade', 'Risk per Trade'], ['trailing_atr_multiplier', 'Trailing ATR']];
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

export function HoldoutValidation({dailyData, symbol, initialParams, initialTimeframe}: {dailyData:StockData; symbol:string; initialParams:StrategyParameters; initialTimeframe:Timeframe}) {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [params, setParams] = useState(() => structuredClone(initialParams));
  const [asOf] = useState(() => new Date().toISOString().slice(0,10));
  const [splitDate, setSplitDate] = useState(() => {
    const start = Date.parse(dailyData.dates[0]), end = Date.parse(dailyData.dates.at(-1)!);
    return new Date(start + .6 * (end - start)).toISOString().slice(0,10);
  });
  const [warmup, setWarmup] = useState(initialTimeframe === 'daily' ? 200 : initialTimeframe === 'weekly' ? 52 : 24);
  const [prior, setPrior] = useState<LockedHoldout['priorKnowledge']>('unknown');
  const [plan, setPlan] = useState<HoldoutPlan | null>(null);
  const [development, setDevelopment] = useState<RunSnapshot | null>(null);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [search, setSearch] = useState({param1:'rsi_period', range1:'7-21:2', param2:'stop_loss_atr', range2:'1-3:0.5', metric:'sharpe'});
  const [locked, setLocked] = useState<LockedHoldout | null>(null);
  const [record, setRecord] = useState<ValidationRecord | null>(null);
  const [saved, setSaved] = useState<ValidationRecord[]>([]);
  const [error, setError] = useState('');
  const [storageNote, setStorageNote] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; try {setSaved(readHistory(localStorage).records);} catch {setStorageNote('Browser history is unavailable. Prior exposure is unknown; export results to keep a copy.');} return () => {alive.current = false;};}, []);
  const available = useMemo(() => {try {return validationBars(dailyData,timeframe,asOf).dates.length;} catch {return 0;}}, [dailyData,timeframe,asOf]);
  const draftPlan = useMemo(() => {try {return {value:makeHoldoutPlan(dailyData,timeframe,splitDate,warmup,asOf), error:''};} catch(e) {return {value:null,error:(e as Error).message};}}, [dailyData,timeframe,splitDate,warmup,asOf]);
  const currentDevelopment = development && JSON.stringify(development.params) === JSON.stringify(params) ? development : null;
  const logDevelopment = (p:HoldoutPlan) => {
    try {recordExposure(localStorage,{symbol,start:p.data.openDates![0],end:p.developmentEnd,recordedAt:new Date().toISOString(),source:'development'});}
    catch {setStorageNote('Exposure history could not be saved. Prior exposure is unknown; export your results.');}
  };
  function develop() {
    if (!plan) return; setError('');
    try {const run=runDevelopment(symbol,plan,params); logDevelopment(plan); setDevelopment(run);} catch(e) {setError((e as Error).message);}
  }
  async function optimize() {
    if (!plan || busy) return; setBusy(true);setError('');
    await new Promise(resolve=>setTimeout(resolve,20));
    if (!alive.current) return;
    try {
      const {record:attempt}=optimizeDevelopment(plan,params,{...search,range1:parseRangeSpec(search.range1),range2:search.param2==='select'?[]:parseRangeSpec(search.range2)});
      logDevelopment(plan); setSearches(s=>[...s,attempt]);
      if (!attempt.selected) throw new Error('No eligible candidate: check parameter ranges, fixed warm-up budget, and the five-trade eligibility minimum.');
      setParams(attempt.selected);setDevelopment(runDevelopment(symbol,plan,attempt.selected));
    } catch(e) {setError((e as Error).message);} finally {if(alive.current)setBusy(false);}
  }
  async function lock() {
    if (!plan || !currentDevelopment || busy) return;setBusy(true);setError('');
    try {const result=await lockHoldout(symbol,plan,params,searches,prior);if(alive.current)setLocked(result);} catch(e) {if(alive.current)setError((e as Error).message);} finally {if(alive.current)setBusy(false);}
  }
  function evaluate() {
    if (!locked || record) return;setError('');
    let reuse:ValidationRecord['reuse']='unknown';
    try {
      const history=readHistory(localStorage);
      reuse=storageNote ? 'unknown' : overlappingExposure(history.exposures,symbol,locked.plan.evaluationStart,locked.plan.evaluationEnd)?'previously-recorded':'first-recorded-here';
      // Record exposure BEFORE evaluation: errors/reloads cannot make a revealed period fresh.
      recordExposure(localStorage,{symbol,start:locked.plan.evaluationStart,end:locked.plan.evaluationEnd,recordedAt:new Date().toISOString(),source:'evaluation'});
      saveValidationRecord(localStorage,evaluationRecord(locked,reuse));
    } catch {reuse='unknown';setStorageNote('History could not be saved. Prior exposure is unknown. Download the experiment record.');}
    try {
      const result=evaluateHoldout(locked,reuse);setRecord(result);
      try {saveValidationRecord(localStorage,result);setSaved(readHistory(localStorage).records);} catch {setStorageNote('Result could not be saved in this browser. Download the experiment record before leaving.');}
    } catch(e) {setError((e as Error).message);}
  }
  function restart() {setPlan(null);setDevelopment(null);setSearches([]);setLocked(null);setRecord(null);setError('');}
  return <div className="space-y-6 text-slate-700 dark:text-slate-200">
    <header><h2 className="text-2xl font-bold mb-3">Out-of-Sample Validation</h2><p>Develop on earlier data, lock the strategy, then reveal performance on a reserved period.</p></header>
    <p className="text-sm">{symbol} · Single chronological holdout · Long only · Browser records cannot certify unseen data or track work on other devices.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {storageNote && <p role="alert" className="text-amber-700 dark:text-amber-300">{storageNote}</p>}
    {!plan && <section className={panel}><h3 className="text-xl font-bold">1. Choose Validation Periods</h3>
      <p>Select the split and a fixed development warm-up budget before comparing parameters. The suggested split reserves roughly 40% of calendar history.</p>
      <div className="flex flex-wrap gap-4">
        <label className="grid gap-1">Indicator timeframe<select aria-label="Validation timeframe" className={field} value={timeframe} onChange={e=>{const tf=e.target.value as Timeframe;setTimeframe(tf);setWarmup(tf==='daily'?200:tf==='weekly'?52:24);}}>{['daily','weekly','monthly'].map(tf=><option key={tf}>{tf}</option>)}</select></label>
        <label className="grid gap-1">Evaluation starts on or after<input aria-label="Evaluation start date" className={field} type="date" value={splitDate} onChange={e=>setSplitDate(e.target.value)}/></label>
        <label className="grid gap-1">Development warm-up bars<input aria-label="Development warm-up bars" className={field} type="number" min={14} max={2000} value={warmup} onChange={e=>setWarmup(+e.target.value)}/></label>
      </div>
      <p className="text-sm">{available} usable {timeframe} bars. Today is excluded. For weekly/monthly data, both edge intervals are excluded conservatively because their completeness is unverified. Periods count selected-timeframe bars, not holding days.</p>
      {draftPlan.error && <p role="status" className="text-amber-700 dark:text-amber-300">{draftPlan.error}</p>}
      {draftPlan.value && <div className="grid sm:grid-cols-2 gap-3"><p>Development scoring: <strong>{draftPlan.value.developmentStart} → {draftPlan.value.developmentEnd}</strong><br/>{draftPlan.value.splitIndex-warmup} scoring bars; {warmup} earlier bars for warm-up.</p><p>Reserved evaluation: <strong>{draftPlan.value.evaluationStart} → {draftPlan.value.evaluationEnd}</strong><br/>{draftPlan.value.data.dates.length-draftPlan.value.splitIndex} scoring bars. Split aligns forward to an interval opening.</p></div>}
      <label className="block">Have these evaluation dates influenced your earlier research?<select aria-label="Prior evaluation exposure" className={`${field} block mt-1 w-full`} value={prior} onChange={e=>setPrior(e.target.value as LockedHoldout['priorKnowledge'])}><option value="unknown">Unknown — treat as retrospective research</option><option value="reviewed">Yes — already reviewed or used for strategy selection</option><option value="not-reviewed">No, to my knowledge — not independently verified</option></select></label>
      <button className={button} disabled={!draftPlan.value} onClick={()=>{setPlan(structuredClone(draftPlan.value!));setError('');}}>Confirm Periods & Develop</button>
    </section>}
    {plan && <>
      <section className={panel}><h3 className="font-bold">Reserved Periods</h3><p>Development: {plan.developmentStart} → {plan.developmentEnd} · Evaluation: {plan.evaluationStart} → {plan.evaluationEnd}</p><p>{plan.timeframe} indicators and valuation · {plan.warmupBars} warm-up bars excluded from development performance.</p>
      <button className="underline" disabled={busy} onClick={restart}>Start New Experiment</button></section>
      {!locked && <section className={panel}><h3 className="text-xl font-bold">2. Develop Strategy</h3><p>Backtests and optimization below use development data only. Evaluation results remain hidden.</p>
        <fieldset disabled={busy} className="space-y-4"><StrategyControls strategyParams={params} setStrategyParams={setParams} currentTimeframe={timeframe} setCurrentTimeframe={()=>{}} hideTimeframe/>
          <button className={button} onClick={develop}>Run Development Backtest</button>
          <details className={panel}><summary className="font-bold cursor-pointer">Optimize Development Parameters</summary><p>Choose up to two parameters. Candidates outside the fixed warm-up budget or with fewer than five completed trades are ineligible. Five trades is not proof of reliability.</p>
            <div className="grid sm:grid-cols-2 gap-3">{([1,2] as const).map(n=><div key={n}><label className="grid gap-1">Parameter {n}<select aria-label={`Validation parameter ${n}`} className={field} value={search[`param${n}`]} onChange={e=>setSearch(s=>({...s,[`param${n}`]:e.target.value}))}>{n===2&&<option value="select">None (1D)</option>}{axes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 mt-2">Range (min-max:step)<input aria-label={`Validation range ${n}`} className={field} disabled={n===2&&search.param2==='select'} value={search[`range${n}`]} onChange={e=>setSearch(s=>({...s,[`range${n}`]:e.target.value}))}/></label></div>)}</div>
            <label className="grid gap-1">Objective<select className={field} aria-label="Validation optimization objective" value={search.metric} onChange={e=>setSearch(s=>({...s,metric:e.target.value}))}><option value="sharpe">Sharpe</option><option value="cagr">CAGR</option><option value="max_drawdown">Minimum drawdown</option><option value="alpha_cagr">CAGR difference vs buy-and-hold</option></select></label>
            <button className={button} onClick={optimize}>{busy?'Optimizing…':'Optimize Development Only'}</button>
          </details>
        </fieldset>
        <p>{searches.length} searches recorded in this experiment · {searches.reduce((n,s)=>n+s.combinations,0)} combinations tried. Ties retain the first candidate in the recorded grid order.</p>
        {searches.length>0&&<p>Latest search: {searches.at(-1)!.eligible} eligible of {searches.at(-1)!.combinations}. The best eligible parameters are applied to this development setup.</p>}
        {currentDevelopment && <><EquityChart run={currentDevelopment} title="Development Equity"/><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Object.entries(summary(currentDevelopment)).map(([k,v])=><p key={k} className="text-sm">{k}<br/><strong>{v}</strong></p>)}</div><button disabled={busy} className={button} onClick={lock}>{busy?'Preparing…':'Lock Strategy for Review'}</button></>}
      </section>}
      {locked && <section className={panel}><h3 className="text-xl font-bold">3. Locked Strategy</h3><p>Parameters, costs, data, and dates are frozen for this experiment. Evaluation starts with $10,000 cash and no inherited position.</p>
        <p>Commission: ${locked.params.commission} per order · Slippage: {locked.params.slipBps} bps per side · Locked {locked.lockedAt}</p>
        <details><summary className="cursor-pointer">Review All Locked Parameters</summary><pre className="text-xs whitespace-pre-wrap break-words mt-2">{JSON.stringify(locked.params,null,2)}</pre></details>
        {!record&&<button className={button} onClick={evaluate}>Evaluate Reserved Period</button>}
      </section>}
    </>}
    {record?.evaluation && <section className="space-y-4"><h3 className="text-xl font-bold">4. Validation Results</h3>
      <p>{record.reuse==='first-recorded-here'?'First evaluation recorded here':record.reuse==='previously-recorded'?'Previously recorded exposure overlaps this evaluation period':'Prior local exposure unknown'} · {record.priorKnowledge==='not-reviewed'?'User reports no prior review (unverified)':'Retrospective / prior review unknown'}</p>
      <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300">{record.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Metric</th><th className="p-2">Development</th><th className="p-2">Reserved Evaluation</th></tr></thead><tbody>{Object.entries(summary(record.development)).map(([k,v])=><tr key={k} className="border-t dark:border-slate-600"><th className="p-2 font-normal">{k}</th><td className="p-2">{v}</td><td className="p-2">{summary(record.evaluation!)[k as keyof ReturnType<typeof summary>]}</td></tr>)}</tbody></table></div>
      <p className="text-sm">N/A means the ratio has no valid denominator. Drawdown duration includes unrecovered drawdowns. Buy-and-hold excludes costs and dividends; strategy results include configured costs. Weekly/monthly drawdown uses interval closes and can miss losses within an interval.</p>
      <div className="grid lg:grid-cols-2 gap-4"><EquityChart run={record.development} title="Development Equity"/><EquityChart run={record.evaluation} title="Evaluation Equity"/></div>
      <div className="flex flex-wrap gap-3"><button className={button} onClick={()=>downloadRecord(record)}>Download Experiment JSON</button><button className={button} onClick={()=>exportComparison(record)}>Export Comparison CSV</button></div>
      <details className={panel}><summary className="font-bold cursor-pointer">AI Review of Validation Results</summary><p>Optional. Sends this evaluation and development summary to the AI only when you select Generate AI Analysis.</p><AnalysisChat key={record.id} run={record.evaluation}/></details>
    </section>}
    {saved.length>0&&<details className={panel}><summary className="font-bold cursor-pointer">Saved Experiments in This Browser ({saved.length})</summary><p>Records are local to this site and browser. Clearing storage removes them. Download records for a durable copy; they are not tamper-proof.</p>{saved.map(r=><div className="flex flex-wrap justify-between gap-2 border-t py-2" key={r.id}><span>{r.symbol} · {r.plan.evaluationStart} → {r.plan.evaluationEnd} · {r.status} · {r.lockedAt}</span><button className="underline" onClick={()=>downloadRecord(r)}>Download record</button></div>)}</details>}
  </div>;
}
