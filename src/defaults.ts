import type { StrategyParameters } from './types.ts';

export const defaultStrategyParams: StrategyParameters = {
    useBB: true, useRSI: true, useMACD: true,
    bbPeriod: 20, bbStd: 2,
    rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    riskPct: 1, stopATR: 2, commission: 0.5, slipBps: 5,
    useTrailingStop: false, trailingATRMultiplier: 3.0, trailingStopActivation: 'ratchet',
    useTrendFilter: true,
    trendFilterPeriod: 200,
    useTakeProfit: true,
    takeProfitATR: 1.5,
    useMomentumEntry: true,
    momentumSMAPeriod: 50,
    allowFractionalShares: false,
};
