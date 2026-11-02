import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStrategyParams } from '../src/defaults.ts';
import { calculateAllIndicators, runBacktest } from '../src/services/tradingService.ts';
import { validationBars, makeHoldoutPlan, optimizeDevelopment, runDevelopment, lockHoldout, evaluateHoldout, periodBenchmark, fingerprint, evaluationRecord } from '../src/services/holdoutService.ts';
import { readHistory, recordExposure, overlappingExposure, saveValidationRecord, serializeRecord, HISTORY_KEY } from '../src/services/validationHistory.ts';
import { analysisContext } from '../src/services/runSnapshot.ts';
import type { StockData } from '../src/types.ts';

function fixture(n=1260): StockData {
  const dates:string[]=[];let t=Date.UTC(2020,0,1);
  while(dates.length<n){const d=new Date(t);if(d.getUTCDay()!==0&&d.getUTCDay()!==6) dates.push(d.toISOString().slice(0,10));t+=86400000;}
  const c=dates.map((_,i)=>100+i*.015+12*Math.sin(i*.18));
  return {dates,c,o:c.map((x,i)=>i?c[i-1]:x),h:c.map((x,i)=>Math.max(x,i?c[i-1]:x)+1),l:c.map((x,i)=>Math.min(x,i?c[i-1]:x)-1),v:c.map(()=>10000)};
}
const params={...defaultStrategyParams,useMACD:false,useBB:false,useRSI:true,useMomentumEntry:false,useTrendFilter:false,rsiPeriod:7,useTakeProfit:true,commission:1,slipBps:5};
const search={param1:'rsi_period',range1:[5,7,9],param2:'stop_loss_atr',range2:[1,2,3],metric:'sharpe'};
function setup(){const data=fixture();return {data,plan:makeHoldoutPlan(data,'daily',data.dates[750],40,'2030-01-01')};}
class MemoryStorage { values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);} }

test('future-price perturbation cannot change development results or optimized parameters',()=>{
  const {data,plan}=setup();const changed=structuredClone(data);
  for(let i=750;i<data.dates.length;i++) for(const key of ['o','h','l','c'] as const) changed[key][i]*=4;
  const alternate=makeHoldoutPlan(changed,'daily',data.dates[750],40,'2030-01-01');
  assert.deepEqual(optimizeDevelopment(plan,params,search),optimizeDevelopment(alternate,params,search));
  const a=runDevelopment('AAPL',plan,params),b=runDevelopment('AAPL',alternate,params);
  assert.deepEqual(a.result,b.result);assert.deepEqual(a.benchmark,b.benchmark);
  assert.equal(a.startDate,data.dates[40]);assert.equal(a.bars,710);
  assert.ok(a.result.trades.every(t=>t.date>=a.startDate&&t.date<=a.endDate));
});
test('all eligible optimization candidates use fixed scoring dates and long lookbacks are skipped',()=>{
  const {plan}=setup();const {result}=optimizeDevelopment(plan,params,{...search,range1:[5,7,80],param2:'select',range2:[]});
  assert.equal(result.grid[0][2],null);assert.ok(result.best);
  assert.equal(result.best!.bt.equityDates[0],plan.developmentStart);
  assert.equal(result.best!.bt.equity.length,plan.splitIndex-plan.warmupBars);
});
test('warm-up produces no positions; first scoring open can use last warm-up signal and fees reconcile',()=>{
  const data=fixture(80);for(const key of ['o','h','l','c'] as const)data[key]=Array(80).fill(100);
  data.h=Array(80).fill(101);data.l=Array(80).fill(99);
  const p={...params,riskPct:10,stopATR:10,useTakeProfit:false,commission:1,slipBps:10,rsiOversold:30};
  const ind=calculateAllIndicators(data,p);ind.rsi=Array(80).fill(50);ind.rsi[39]=10;ind.atr=Array(80).fill(1);
  const bt=runBacktest(data,ind,p,'daily',40);
  assert.equal(bt.trades[0].date,data.dates[40]);assert.equal(bt.trades[0].price,100.1);
  assert.equal(bt.trades.length,2);assert.equal(bt.trades[1].reason,'End of Data');
  const shares=bt.trades[0].shares;
  assert.ok(Math.abs(bt.metrics.finalEquity-(10000+shares*(99.9-100.1)-2))<1e-8);
  assert.equal(bt.equity.length,40);assert.ok(bt.equity[0]<10000);
  assert.ok(bt.metrics.maxDrawdown>0);assert.equal(bt.metrics.timeInMarketPct,100);
  assert.equal(bt.metrics.maxDrawdownDurationDays,(Date.parse(data.dates[79])-Date.parse(data.dates[40]))/86400000);
  // A signal only inside earlier warm-up must never leave an inherited position.
  ind.rsi[39]=50;ind.rsi[30]=10;
  assert.equal(runBacktest(data,ind,p,'daily',40).trades.length,0);
});
test('benchmark buys at scoring open, values on scoring closes, and excludes warm-up',()=>{
  const {plan}=setup();const start=plan.splitIndex;const b=periodBenchmark(plan.data,start);
  assert.equal(b.equity.length,plan.data.c.length-start);
  assert.equal(b.equity[0],10000*plan.data.c[start]/plan.data.o[start]);
  assert.equal(b.ret,(b.equity.at(-1)!/10000-1)*100);
});
test('weekly/monthly windows align forward, never cross split, and exclude uncertain edge aggregates',()=>{
  const data=fixture();
  for(const tf of ['weekly','monthly'] as const){
    const p=makeHoldoutPlan(data,tf,'2023-01-11',14,'2030-01-01');
    assert.ok(p.evaluationStart>='2023-01-11');
    assert.ok(p.developmentEnd<p.evaluationStart);
    assert.ok(p.data.openDates![0]>data.dates[0]);assert.ok(p.evaluationEnd<data.dates.at(-1)!);
    assert.ok(p.data.openDates!.every((d,i)=>d<=p.data.dates[i]));
    const r=evaluateHoldout({id:'test',lockedAt:'2025-01-01',symbol:'AAPL',dataFingerprint:'test',params:{...params,rsiPeriod:5},plan:p,searches:[],priorKnowledge:'unknown',development:runDevelopment('AAPL',p,{...params,rsiPeriod:5})},'unknown');
    assert.ok(r.evaluation!.result.trades.every(t=>t.date>=p.evaluationStart));
  }
});
test('today excluded and inadequate monthly history fails rather than fabricating results',()=>{
  const data=fixture();const bars=validationBars(data,'daily',data.dates[100]);assert.equal(bars.dates.length,100);
  assert.throws(()=>makeHoldoutPlan(data,'monthly','2023-01-01',200,'2030-01-01'),/Insufficient history/);
  const plan=makeHoldoutPlan(data,'monthly','2023-01-01',14,'2030-01-01');
  assert.throws(()=>runDevelopment('AAPL',plan,defaultStrategyParams),/warm-up/);
});
test('locking clones parameters, data and searches before async work; evaluation uses frozen snapshot',async()=>{
  const {plan}=setup();const p={...params};const expected=structuredClone(plan);
  const pending=lockHoldout('AAPL',plan,p,[],'unknown');p.riskPct=90;plan.data.c[800]=1;
  const lock=await pending;assert.equal(lock.params.riskPct,params.riskPct);assert.deepEqual(lock.plan,expected);
  assert.equal(lock.dataFingerprint,await fingerprint(expected.data));
  const result=evaluateHoldout(lock,'first-recorded-here');
  assert.equal(result.evaluation!.startDate,expected.evaluationStart);
  assert.equal(result.evaluation!.bars,expected.data.dates.length-expected.splitIndex);
  assert.equal(result.evaluation!.result.equityDates[0],expected.data.dates[expected.splitIndex]);
  const context=analysisContext(result.evaluation!);
  assert.equal(context.validation!.experimentId,lock.id);assert.match(context.methodology.validation,/holdout/);
  assert.ok(result.warnings.some(w=>w.includes('Retrospective')));
});
test('reuse survives reload, changed timeframe/data and overlapping dates; failed attempt remains exposed',async()=>{
  const store=new MemoryStorage();const {plan}=setup();const lock=await lockHoldout('AAPL',plan,params,[],'not-reviewed');
  recordExposure(store,{symbol:'AAPL',start:plan.evaluationStart,end:plan.evaluationEnd,recordedAt:'2025-01-01',source:'evaluation'});
  saveValidationRecord(store,evaluationRecord(lock,'first-recorded-here'));
  const h=readHistory(store);assert.equal(h.records[0].status,'started');assert.ok(overlappingExposure(h.exposures,'AAPL',plan.developmentEnd,plan.evaluationStart));
  assert.equal(overlappingExposure(h.exposures,'MSFT',plan.evaluationStart,plan.evaluationEnd),false);
  const completed=evaluateHoldout(lock,'previously-recorded');saveValidationRecord(store,completed);
  assert.equal(readHistory(store).records.length,1);assert.equal(readHistory(store).records[0].status,'complete');
  assert.equal(readHistory(store).records[0].evaluation!.result.metrics.profitFactor,completed.evaluation!.result.metrics.profitFactor);
  assert.equal(JSON.parse(serializeRecord(completed)).plan.data,undefined);
});
test('bad history and quota failures are surfaced, not silently reset',()=>{
  const store=new MemoryStorage();store.setItem(HISTORY_KEY,'broken');assert.throws(()=>readHistory(store));
  const full={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
  assert.throws(()=>recordExposure(full,{symbol:'AAPL',start:'2020-01-01',end:'2025-01-01',recordedAt:'2025-01-01',source:'exploration'}),/quota/);
});

test('weekly open fills use first-session dates, not the interval close date',()=>{
  const daily=fixture();const data=validationBars(daily,'weekly','2030-01-01');
  const p={...params,useTakeProfit:false,stopATR:5,allowFractionalShares:true};
  const ind=calculateAllIndicators(data,p);ind.rsi=data.c.map(()=>50);ind.rsi[39]=10;
  const bt=runBacktest(data,ind,p,'weekly',40);
  assert.equal(bt.trades[0].date,data.openDates![40]);assert.notEqual(bt.trades[0].date,data.dates[40]);
  assert.ok(bt.trades.every(t=>t.date>=data.openDates![40]));
});
test('changes later in evaluation cannot change earlier fills or mark-to-market equity',async()=>{
  const {plan}=setup();const lock=await lockHoldout('AAPL',plan,params,[],'unknown');
  const baseline=evaluateHoldout(lock,'unknown').evaluation!;
  const modified=structuredClone(lock);const cutoff=1000;
  for(let i=cutoff;i<plan.data.c.length;i++) for(const k of ['o','h','l','c'] as const) modified.plan.data[k][i]*=2;
  const altered=evaluateHoldout(modified,'unknown').evaluation!;
  assert.deepEqual(baseline.result.equity.slice(0,cutoff-plan.splitIndex),altered.result.equity.slice(0,cutoff-plan.splitIndex));
  assert.deepEqual(baseline.result.trades.filter(t=>t.date<plan.data.dates[cutoff]),altered.result.trades.filter(t=>t.date<plan.data.dates[cutoff]));
});
