import { StockData, Indicators, StrategyParameters, BacktestResult, Signal, Trade, Timeframe } from '../types.ts';

// INDICATOR CALCULATIONS

const rma = (values: (number | null)[], period: number): (number | null)[] => {
  const out: (number | null)[] = [];
  let avg = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      out.push(null);
      continue;
    }
    if (count < period) {
      avg += v;
      count++;
      if (count < period) {
        out.push(null);
      } else {
        avg /= period;
        out.push(avg);
      }
    } else {
      avg = (avg * (period - 1) + v) / period;
      out.push(avg);
    }
  }
  return out;
};

const calcRSI = (close: number[], period = 14): (number | null)[] => {
  const ch: number[] = [];
  for (let i = 1; i < close.length; i++) ch.push(close[i] - close[i - 1]);
  const gains = ch.map(x => x > 0 ? x : 0);
  const losses = ch.map(x => x < 0 ? -x : 0);
  const avgG = rma(gains, period);
  const avgL = rma(losses, period);
  const rsi: (number | null)[] = [null];
  for (let i = 0; i < avgG.length; i++) {
    const g = avgG[i];
    const l = avgL[i];
    if (g == null || l == null) {
      rsi.push(null);
      continue;
    }
    const rs = l === 0 ? 1000 : g / l;
    rsi.push(100 - (100 / (1 + rs)));
  }
  while (rsi.length < close.length) rsi.push(null);
  return rsi;
};

const ema = (values: number[], period: number): (number | null)[] => {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  let sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (prev == null) {
      sum += v;
      n++;
      if (n === period) {
        prev = sum / period;
        out.push(prev);
      } else {
        out.push(null);
      }
    } else {
      prev = v * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
};

const calcMACD = (close: number[], fast = 12, slow = 26, signal = 9) => {
  const emaF = ema(close, fast);
  const emaS = ema(close, slow);
  const macd = close.map((_, i) => (emaF[i] != null && emaS[i] != null) ? (emaF[i]! - emaS[i]!) : null);
  const sig = ema(macd.map(x => x == null ? 0 : x), signal).map((v, i) => macd[i] == null ? null : v);
  const hist = macd.map((m, i) => (m == null || sig[i] == null) ? null : (m - sig[i]!));
  return { MACD: macd, signal: sig, histogram: hist };
};

const calcBB = (close: number[], period = 20, std = 2) => {
  const up: (number | null)[] = [], mid: (number | null)[] = [], lo: (number | null)[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      up.push(null); mid.push(null); lo.push(null);
      continue;
    }
    const slice = close.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);
    mid.push(mean);
    up.push(mean + std * sd);
    lo.push(mean - std * sd);
  }
  return { upper: up, middle: mid, lower: lo };
};

const calcATR = (h: number[], l: number[], c: number[], period = 14): (number | null)[] => {
  const tr = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) {
      tr.push(h[i] - l[i]);
      continue;
    }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  return rma(tr, period);
};

const sma = (values: number[], period: number): (number | null)[] => {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    out.push(sum / period);
  }
  return out;
};

export const calculateAllIndicators = (data: StockData, p: StrategyParameters): Indicators => ({
    bb: calcBB(data.c, p.bbPeriod, p.bbStd),
    rsi: calcRSI(data.c, p.rsiPeriod),
    macd: calcMACD(data.c, p.macdFast, p.macdSlow, p.macdSignal),
    atr: calcATR(data.h, data.l, data.c, 14),
    sma_slow: sma(data.c, p.trendFilterPeriod),
    sma_fast: sma(data.c, p.momentumSMAPeriod)
});


// BACKTESTING ENGINE

const generateSignals = (data: StockData, ind: Indicators, p: StrategyParameters): Signal[] => {
    const sigs: Signal[] = [];
    for (let i = 1; i < data.dates.length; i++) {
        let reversalBuys = 0, reversalSells = 0;
        const price = data.c[i];
        
        // --- Mean Reversion Logic ---
        if (p.useBB && ind.bb.upper[i] != null && ind.bb.lower[i] != null) {
            if (price <= ind.bb.lower[i]!) reversalBuys++;
            if (price >= ind.bb.upper[i]!) reversalSells++;
        }
        if (p.useRSI && ind.rsi[i] != null) {
            if (ind.rsi[i]! <= p.rsiOversold) reversalBuys++;
            if (ind.rsi[i]! >= p.rsiOverbought) reversalSells++;
        }
        if (p.useMACD && ind.macd.MACD[i] != null && ind.macd.signal[i] != null && ind.macd.MACD[i-1] != null && ind.macd.signal[i-1] != null) {
            const bull = ind.macd.MACD[i]! > ind.macd.signal[i]! && ind.macd.MACD[i-1]! <= ind.macd.signal[i-1]!;
            const bear = ind.macd.MACD[i]! < ind.macd.signal[i]! && ind.macd.MACD[i-1]! >= ind.macd.signal[i-1]!;
            if (bull) reversalBuys++;
            if (bear) reversalSells++;
        }

        const isReversalBuy = reversalBuys > 0 && reversalSells === 0;
        const isReversalSell = reversalSells > 0 && reversalBuys === 0;

        // --- Momentum Entry Logic ---
        let isMomentumBuy = false;
        if (p.useMomentumEntry && ind.sma_fast?.[i] != null && ind.rsi?.[i] != null) {
            if (price > ind.sma_fast[i]! && ind.rsi[i]! > 50) {
                 isMomentumBuy = true;
            }
        }
        
        let totalBuy = isReversalBuy || isMomentumBuy;
        
        // --- Trend Filter and Signal Generation ---
        // Apply trend filter to all potential buy signals
        if (totalBuy && p.useTrendFilter && ind.sma_slow && ind.sma_slow[i] != null && price < ind.sma_slow[i]!) {
            totalBuy = false; // Invalidate buy signals if below trend
        }
        
        if (totalBuy) {
            const reason = isMomentumBuy && !isReversalBuy ? 'Momentum Entry' : 'Reversal Entry';
            sigs.push({ type: 'buy', index: i, date: data.dates[i], price, reason });
        } else if (isReversalSell) {
             sigs.push({ type: 'sell', index: i, date: data.dates[i], price, reason: 'Reversal Sell' });
        }
    }
    return sigs;
}

export const runBacktest = (data: StockData, ind: Indicators, p: StrategyParameters, timeframe: Timeframe): BacktestResult => {
    const { dates, o, h, l, c } = data, N = c.length;
    const initialCapital = 10000;
    const slip = p.slipBps / 10000;

    let cash = initialCapital, pos: { shares: number, entry: number } | null = null;
    const equity: number[] = [], equityDates: string[] = [];
    let peak = initialCapital, maxDD = 0;
    const trades: Trade[] = [];
    const signals = generateSignals(data, ind, p);
    const buyIdx = new Set(signals.filter(s => s.type === 'buy').map(s => s.index));
    const sellIdx = new Set(signals.filter(s => s.type === 'sell').map(s => s.index));
    const atr = ind.atr;
    let exposureBars = 0;

    for (let i = 1; i < N; i++) {
        // Signal exit
        if (pos && sellIdx.has(i - 1)) {
            const exitPx = o[i] * (1 - slip);
            cash += pos.shares * exitPx - p.commission;
            trades.push({ type: 'sell', date: dates[i], price: exitPx, shares: pos.shares, reason: 'Signal Exit' });
            pos = null;
        }
        
        // Take Profit
        if (pos && p.useTakeProfit) {
            const takeProfitLvl = pos.entry + (p.takeProfitATR * (atr[i] ?? (c[i] * 0.02)));
            if (h[i] >= takeProfitLvl) {
                const px = Math.max(o[i], takeProfitLvl) * (1 - slip);
                cash += pos.shares * px - p.commission;
                trades.push({ type: 'sell', date: dates[i], price: px, shares: pos.shares, reason: 'Take Profit' });
                pos = null;
            }
        }

        // Stop loss
        if (pos) {
            const stopLvl = pos.entry - (p.stopATR * (atr[i] ?? (c[i] * 0.02)));
            if (l[i] <= stopLvl) {
                const px = Math.min(o[i], stopLvl) * (1 - slip);
                cash += pos.shares * px - p.commission;
                trades.push({ type: 'sell', date: dates[i], price: px, shares: pos.shares, reason: 'Stop Loss' });
                pos = null;
            }
        }
        // Signal entry
        if (!pos && buyIdx.has(i - 1)) {
            const px = o[i] * (1 + slip);
            const stopDist = Math.max(0.01, p.stopATR * (atr[i] ?? (c[i] * 0.02)));
            const riskDollars = cash * (p.riskPct / 100);
            const shares = Math.floor(riskDollars / stopDist);
            if (shares > 0 && cash >= shares * px + p.commission) {
                cash -= shares * px + p.commission;
                pos = { shares, entry: px };
                trades.push({ type: 'buy', date: dates[i], price: px, shares, reason: 'Signal Entry' });
            }
        }

        if (pos) exposureBars++;

        const eq = cash + (pos ? pos.shares * c[i] : 0);
        equity.push(eq);
        equityDates.push(dates[i]);
        if (eq > peak) peak = eq;
        maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
    }

    if (pos) {
        const px = c[N - 1] * (1 - slip);
        cash += pos.shares * px;
    }
    const finalEquity = cash;

    // Calculate metrics
    const paired: { buy: Trade, sell: Trade }[] = [];
    let lastBuy: Trade | null = null;
    for (const t of trades) {
        if (t.type === 'buy') lastBuy = t;
        else if (t.type === 'sell' && lastBuy) {
            paired.push({ buy: lastBuy, sell: t });
            lastBuy = null;
        }
    }

    const rets = paired.map(p => (p.sell.price - p.buy.price) / p.buy.price);
    const wins = rets.filter(r => r > 0);
    const losses = rets.filter(r => r <= 0);
    const winRate = paired.length > 0 ? (wins.length / paired.length) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length * 100 : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) * 100 : 0;
    
    const grossProfit = paired.filter(p => p.sell.price > p.buy.price).reduce((sum, p) => sum + (p.sell.price - p.buy.price) * p.buy.shares, 0);
    const grossLoss = paired.filter(p => p.sell.price <= p.buy.price).reduce((sum, p) => sum + (p.buy.price - p.sell.price) * p.buy.shares, 0);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    const years = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 24 * 3600 * 1000);
    const totalReturn = (finalEquity - initialCapital) / initialCapital * 100;
    const cagr = years > 0 ? (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100 : 0;
    
    const periodReturns = equity.slice(1).map((e, i) => (e - equity[i]) / equity[i]);
    const meanReturn = periodReturns.length > 0 ? periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length : 0;
    const stdDev = periodReturns.length > 0 ? Math.sqrt(periodReturns.map(r => Math.pow(r - meanReturn, 2)).reduce((a, b) => a + b, 0) / periodReturns.length) : 0;
    
    const ann = timeframe === 'daily' ? 252 : timeframe === 'weekly' ? 52 : 12;
    const sharpeRatio = stdDev > 0 ? (meanReturn * ann) / (stdDev * Math.sqrt(ann)) : 0; // Assuming risk-free rate is 0

    const negReturns = periodReturns.filter(r => r < 0);
    const downsideDev = negReturns.length > 0 ? Math.sqrt(negReturns.map(r => r * r).reduce((a, b) => a + b, 0) / negReturns.length) : 0;
    const sortinoRatio = downsideDev > 0 ? (meanReturn * ann) / (downsideDev * Math.sqrt(ann)) : 0;

    const calmarRatio = maxDD > 0 ? cagr / maxDD : Infinity;

    let consecLoss = 0, maxConsecLosses = 0;
    for (const r of rets) {
        if (r <= 0) {
            consecLoss++;
            maxConsecLosses = Math.max(maxConsecLosses, consecLoss);
        } else {
            consecLoss = 0;
        }
    }

    return {
        trades,
        signals,
        equity,
        equityDates,
        metrics: {
            finalEquity, totalReturn, winRate, profitFactor, avgWin, avgLoss,
            maxDrawdown: maxDD, sharpeRatio, sortinoRatio, calmarRatio,
            cagr, numTrades: paired.length,
            timeInMarketPct: (exposureBars / N) * 100,
            maxConsecLosses,
        }
    };
};

// OPTIMIZATION ENGINE
const paramKeyMap: { [key: string]: keyof StrategyParameters } = {
    'rsi_period': 'rsiPeriod',
    'bb_std': 'bbStd',
    'stop_loss_atr': 'stopATR',
    'rsi_oversold': 'rsiOversold',
    'risk_per_trade': 'riskPct',
    'bb_period': 'bbPeriod',
    'rsi_overbought': 'rsiOverbought',
    'macd_fast': 'macdFast',
    'macd_slow': 'macdSlow',
    'macd_signal': 'macdSignal',
};

export const runOptimization = (data: StockData, baseParams: StrategyParameters, p1Key: string, p1Range: number[], p2Key: string, p2Range: number[], metric: string) => {
    let best = { score: -Infinity, params: {}, bt: {} as BacktestResult };
    
    // Calculate benchmark CAGR for alpha calculation
    const { dates, c } = data;
    if (dates.length > 1 && c.length > 1) {
        const years = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 24 * 3600 * 1000);
        const buyHoldReturn = (c[c.length - 1] - c[0]) / c[0];
        const benchmarkCagr = years > 0 ? (Math.pow(1 + buyHoldReturn, 1 / years) - 1) * 100 : 0;

        const effectiveP2Range = p2Key === 'select' || p2Range.length === 0 ? [0] : p2Range;
        const grid: (number | null)[][] = effectiveP2Range.map(() => p1Range.map(() => null));
        
        const mappedP1Key = paramKeyMap[p1Key];
        const mappedP2Key = paramKeyMap[p2Key];

        for (let i = 0; i < effectiveP2Range.length; i++) {
            for (let j = 0; j < p1Range.length; j++) {
                const currentParams = { ...baseParams };
                if (mappedP1Key) (currentParams as any)[mappedP1Key] = p1Range[j];
                if (mappedP2Key && p2Key !== 'select') (currentParams as any)[mappedP2Key] = effectiveP2Range[i];

                const indicators = calculateAllIndicators(data, currentParams);
                const bt = runBacktest(data, indicators, currentParams, 'daily'); // Optimization runs on daily data

                let score: number;
                switch(metric) {
                    case 'sharpe': score = bt.metrics.sharpeRatio; break;
                    case 'cagr': score = bt.metrics.cagr; break;
                    case 'alpha_cagr': score = bt.metrics.cagr - benchmarkCagr; break;
                    case 'win_rate': score = bt.metrics.winRate; break;
                    case 'max_drawdown': score = -bt.metrics.maxDrawdown; break;
                    default: score = bt.metrics.sharpeRatio;
                }
                if (bt.metrics.numTrades < 5) score = -Infinity; // Penalize for too few trades
                
                grid[i][j] = isFinite(score) ? score : null;

                if (score > best.score) {
                     const bestParams: Partial<StrategyParameters> = {};
                    if(mappedP1Key) (bestParams as any)[mappedP1Key] = p1Range[j];
                    if(mappedP2Key && p2Key !== 'select') (bestParams as any)[mappedP2Key] = effectiveP2Range[i];
                    best = { score, params: bestParams, bt };
                }
            }
        }
         return { grid, best };
    }


    // Fallback for case where data is insufficient
    return { grid: [], best: null };
};
