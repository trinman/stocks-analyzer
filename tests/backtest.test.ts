import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllIndicators, runBacktest, runOptimization } from '../src/services/tradingService.ts';
import { validateParameters, validateStockData, requiredBars } from '../src/services/validation.ts';
import { defaultStrategyParams } from '../src/defaults.ts';
import { createRunSnapshot, runMatches, analysisContext } from '../src/services/runSnapshot.ts';
import { parseRangeSpec } from '../src/utils.ts';
import { resampleOHLC } from '../src/services/apiServices.ts';
import type { StockData, StrategyParameters, Indicators } from '../src/types.ts';

const base: StrategyParameters = { ...defaultStrategyParams, useBB: false, useMACD: false, useTrendFilter: false, useMomentumEntry: false, useTakeProfit: false, commission: 0, slipBps: 0 };
function fixture(n = 18): { data: StockData; ind: Indicators } {
  const a = (v: number) => Array(n).fill(v);
  const data = { dates: Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0,10)), o: a(100), h: a(101), l: a(99), c: a(100), v: a(100) };
  return { data, ind: { bb: { upper: a(102), middle: a(100), lower: a(98) }, rsi: a(50), macd: { MACD: a(0), signal: a(0), histogram: a(0) }, atr: a(1), sma_fast: a(100), sma_slow: a(100) } };
}

test('entry-bar stop executes at 98 even if close recovers', () => {
  const {data, ind} = fixture(); ind.rsi[14] = 20; data.l[15] = 90;
  const r = runBacktest(data, ind, base, 'daily');
  assert.deepEqual(r.trades.map(t => [t.type,t.date,t.price]), [['buy', data.dates[15],100], ['sell',data.dates[15],98]]);
  assert.equal(r.metrics.finalEquity,9900); assert.equal(r.metrics.maxDrawdown,1);
});
test('intrabar stop never re-enters at the earlier open', () => {
  const {data, ind} = fixture(); ind.rsi[14] = 20; ind.rsi[15] = 20; data.l[16] = 97;
  const r = runBacktest(data, ind, base, 'daily'); assert.equal(r.trades.length,2); assert.equal(r.trades[1].reason,'Stop Loss');
});
test('ambiguous target and stop use stop first; target gap uses known open', () => {
  const {data, ind} = fixture(); ind.rsi[14] = 20; data.h[16] = 103; data.l[16] = 97;
  const p = {...base,useTakeProfit:true}; assert.equal(runBacktest(data,ind,p,'daily').trades[1].price,98);
  data.o[16]=102; assert.equal(runBacktest(data,ind,p,'daily').trades[1].price,102);
});
test('stop gaps fill at open and risk can exceed planned loss', () => {
  const {data,ind}=fixture();ind.rsi[14]=20;data.o[16]=90;data.l[16]=89;
  const r=runBacktest(data,ind,base,'daily');assert.equal(r.trades[1].price,90);assert.equal(r.metrics.finalEquity,9500);
});
test('stop stays anchored to entry ATR after volatility increases', () => {
  const {data,ind}=fixture();ind.rsi[14]=20;ind.atr[15]=5;data.l[16]=97;
  assert.equal(runBacktest(data,ind,base,'daily').trades[1].price,98);
});
test('both trailing modes never loosen after a lower close and rising ATR', () => {
  for (const trailingStopActivation of ['immediate','ratchet'] as const) {
    const {data,ind}=fixture(20);ind.rsi[14]=20;
    data.h[15]=105; data.c[15]=104;
    data.o[16]=104;data.h[16]=104;data.l[16]=103;data.c[16]=103;
    ind.atr[16]=5;data.o[17]=103;data.h[17]=103;data.l[17]=100;data.c[17]=101;
    const r=runBacktest(data,ind,{...base,useTrailingStop:true,trailingStopActivation},'daily');
    assert.equal(r.trades[1].price,trailingStopActivation==='immediate'?101:102);
    assert.equal(r.trades[1].reason,'Trailing Stop');
  }
});
test('final liquidation commission is included in maximum drawdown', () => {
  const {data,ind}=fixture();ind.rsi[16]=20;
  const r=runBacktest(data,ind,{...base,commission:10},'daily');
  assert.equal(r.metrics.finalEquity,9980);assert.equal(r.metrics.maxDrawdown,0.2);assert.equal(r.equity.length,data.dates.length);
});
test('flat RSI is neutral and Bollinger bands use population deviation', () => {
  const {data}=fixture();const r=calculateAllIndicators(data,{...base,bbPeriod:2});assert.equal(r.rsi[14],50);
  data.c[16]=98;data.c[17]=102;const bb=calculateAllIndicators(data,{...base,bbPeriod:2}).bb;
  assert.equal(bb.middle[17],100);assert.equal(bb.upper[17],104);assert.equal(bb.lower[17],96);
});
test('validates thresholds, periods, risk and data chronology', () => {
  for (const p of [{rsiPeriod:0},{macdFast:40},{riskPct:-1},{rsiOversold:90},{commission:NaN}]) assert.ok(validateParameters({...base,...p}).length);
  const {data}=fixture();data.dates[1]=data.dates[0];assert.throws(()=>validateStockData(data),/chronological/);
});
test('insufficient monthly warm-up has actionable error and no best candidate', () => {
  const {data}=fixture(60);const p={...base,useTrendFilter:true};
  assert.equal(requiredBars(p),201);assert.throws(()=>runBacktest(data,calculateAllIndicators(data,p),p,'monthly'),/at least 201/);
  assert.equal(runOptimization(data,p,'rsi_period',[7,14],'select',[],'sharpe','monthly').best,null);
});
test('no-trade optimization returns null, rejects duplicate and invalid axes', () => {
  const {data}=fixture(60);assert.equal(runOptimization(data,base,'rsi_period',[7,14],'select',[],'sharpe','daily').best,null);
  assert.throws(()=>runOptimization(data,base,'rsi_period',[7],'rsi_period',[14],'sharpe','daily'),/different/);
  assert.throws(()=>runOptimization(data,base,'rsi_period',[7],'stop_loss_atr',[],'sharpe','daily'),/valid ranges/);
});
test('run snapshot is isolated and invalidated by configuration changes', () => {
  const {data,ind}=fixture();const params={...base};const result=runBacktest(data,ind,params,'daily');
  const run=createRunSnapshot('AAPL','daily',data,params,result,{equity:[],ret:0,cagr:0});params.riskPct=2;result.metrics.finalEquity=0;
  assert.equal(run.params.riskPct,1);assert.equal(run.result.metrics.finalEquity,10000);
  assert.equal(runMatches(run,'AAPL','daily',params),false);assert.equal(runMatches(run,'AAPL','monthly',base),false);
  assert.equal(analysisContext(run).params.useMomentumEntry,false);assert.equal(analysisContext(run).bars,18);
});
test('weekly resampling preserves open/high/low/close/volume',()=>{
  const {data}=fixture(18);const r=resampleOHLC(data,'weekly');assert.equal(r.o[0],100);assert.equal(r.h[0],101);assert.equal(r.l[0],99);assert.equal(r.v.reduce((a,b)=>a+b,0),1800);
});
test('ranges retain decimal precision and reject silent truncation',()=>{
  assert.deepEqual(parseRangeSpec('0.25-1.25:1'),[0.25,1.25]);assert.throws(()=>parseRangeSpec('1-100:1'),/exceeds/);
});
