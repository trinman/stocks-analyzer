import { BacktestResult, Benchmark, StrategyParameters, Trade } from "../types";
import { exportToCSV } from "../utils";

const fN = (val: any, digits: number): string => (typeof val === 'number' && isFinite(val) ? val.toFixed(digits) : String(val ?? ''));
const infOr = (val: any, digits: number): string => (val === Infinity ? 'Infinity' : fN(val, digits));

export const exportTradesCSV = (
    backtestResult: BacktestResult | null,
    symbol: string
) => {
    if (!backtestResult) return;
    const { trades } = backtestResult;
    
    const paired: any[] = [];
    // FIX: The `lastBuy` object temporarily holds a `pair` ID not present in the `Trade` interface.
    // We adjust the type to an intersection of `Trade` and an object with `pair` to satisfy TypeScript.
    let lastBuy: (Trade & { pair: number }) | null = null;
    let pairId = 0;

    for (const t of trades) {
        if (t.type === 'buy') {
            lastBuy = { ...t, pair: ++pairId };
        } else if (t.type === 'sell' && lastBuy) {
            const pnl = (t.price - lastBuy.price) * lastBuy.shares;
            paired.push({
                pairId: lastBuy.pair,
                entryDate: lastBuy.date,
                entryPrice: fN(lastBuy.price, 4),
                exitDate: t.date,
                exitPrice: fN(t.price, 4),
                shares: lastBuy.shares,
                returnPct: fN(((t.price - lastBuy.price) / lastBuy.price) * 100, 4),
                pnl: fN(pnl, 2),
                exitReason: t.reason || ''
            });
            lastBuy = null;
        }
    }
    
    if (paired.length > 0) {
        exportToCSV(paired, `${symbol}_trades.csv`);
    }
};

export const exportSummaryCSV = (
    backtestResult: BacktestResult | null,
    benchmark: Benchmark | null,
    params: StrategyParameters,
    symbol: string,
    timeframe: string
) => {
    if (!backtestResult || !benchmark) return;
    const m = backtestResult.metrics;
    const alpha = m.totalReturn - benchmark.ret;
    const alpha_cagr = m.cagr - benchmark.cagr;

    const row = {
        symbol,
        timeframe,
        start_date: backtestResult.equityDates[0] || '',
        end_date: backtestResult.equityDates[backtestResult.equityDates.length - 1] || '',
        initial_capital: 10000,
        final_equity: fN(m.finalEquity, 2),
        total_return_pct: fN(m.totalReturn, 2),
        buy_hold_return_pct: fN(benchmark.ret, 2),
        alpha_vs_bh_pct: fN(alpha, 2),
        strategy_cagr_pct: fN(m.cagr, 2),
        benchmark_cagr_pct: fN(benchmark.cagr, 2),
        alpha_annualized_pct: fN(alpha_cagr, 2),
        sharpe: fN(m.sharpeRatio, 3),
        sortino: fN(m.sortinoRatio, 3),
        calmar: infOr(m.calmarRatio, 3),
        max_drawdown_pct: fN(m.maxDrawdown, 2),
        win_rate_pct: fN(m.winRate, 2),
        profit_factor: infOr(m.profitFactor, 3),
        avg_win_pct: fN(m.avgWin, 2),
        avg_loss_pct: fN(m.avgLoss, 2),
        num_trades: m.numTrades,
        exposure_pct: fN(m.timeInMarketPct, 1),
        max_loss_streak: m.maxConsecLosses,
        risk_per_trade_pct: params.riskPct,
        stop_loss_atr: params.stopATR,
        use_take_profit: params.useTakeProfit,
        take_profit_atr: params.useTakeProfit ? params.takeProfitATR : 'N/A',
        slippage_bps: params.slipBps,
        commission: params.commission,
        use_trend_filter: params.useTrendFilter,
        trend_filter_period: params.useTrendFilter ? params.trendFilterPeriod : 'N/A',
        use_momentum_entry: params.useMomentumEntry,
        momentum_sma_period: params.useMomentumEntry ? params.momentumSMAPeriod : 'N/A',
        bb_period: params.useBB ? params.bbPeriod : 'N/A',
        bb_std: params.useBB ? params.bbStd : 'N/A',
        rsi_period: params.useRSI ? params.rsiPeriod : 'N/A',
        rsi_overbought: params.useRSI ? params.rsiOverbought : 'N/A',
        rsi_oversold: params.useRSI ? params.rsiOversold : 'N/A',
        macd_fast: params.useMACD ? params.macdFast : 'N/A',
        macd_slow: params.useMACD ? params.macdSlow : 'N/A',
        macd_signal: params.useMACD ? params.macdSignal : 'N/A',
    };
    exportToCSV([row], `${symbol}_summary.csv`);
};