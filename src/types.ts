export interface StockData {
  dates: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

export interface Indicators {
  bb: { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] };
  rsi: (number | null)[];
  macd: { MACD: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] };
  atr: (number | null)[];
  sma_slow: (number | null)[];
  sma_fast: (number | null)[];
}

export interface StrategyParameters {
  useBB: boolean;
  useRSI: boolean;
  useMACD: boolean;
  bbPeriod: number;
  bbStd: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  riskPct: number;
  stopATR: number;
  useTrailingStop: boolean;
  trailingATRMultiplier: number;
  trailingStopActivation?: 'immediate' | 'ratchet';
  commission: number;
  slipBps: number;
  useTrendFilter: boolean;
  trendFilterPeriod: number;
  useTakeProfit: boolean;
  takeProfitATR: number;
  useMomentumEntry: boolean;
  momentumSMAPeriod: number;
}

export interface Trade {
  type: 'buy' | 'sell';
  date: string;
  price: number;
  shares: number;
  reason: string;
}

export interface Signal {
  type: 'buy' | 'sell';
  index: number;
  date: string;
  price: number;
  reason: string;
}

export interface BacktestMetrics {
  finalEquity: number;
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  cagr: number;
  numTrades: number;
  timeInMarketPct: number;
  maxConsecLosses: number;
}

export interface BacktestResult {
  trades: Trade[];
  signals: Signal[];
  equity: number[];
  equityDates: string[];
  metrics: BacktestMetrics;
}

export interface Benchmark {
    equity: number[];
    ret: number;
    cagr: number;
}

export interface OptimizationResult {
    grid: (number | null)[][];
    xs: number[];
    ys: number[];
    best: {
        score: number;
        params: Partial<StrategyParameters>;
        bt: BacktestResult;
    } | null;
    param1: string;
    param2: string;
}

export enum AppStep {
    MarketAnalysis = 1,
    StrategySetup = 2,
    Backtest = 3,
    Optimization = 4,
}

export type Timeframe = 'daily' | 'weekly' | 'monthly';
