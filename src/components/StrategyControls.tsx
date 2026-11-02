import React from 'react';
import type { StrategyParameters, Timeframe } from '../types.ts';

const TimeframeSelector: React.FC<{ selected: Timeframe, onSelect: (tf: Timeframe) => void }> = ({ selected, onSelect }) => {
    const timeframes: Timeframe[] = ['daily', 'weekly', 'monthly'];
    return (
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900/50 p-1 rounded-lg">
            {timeframes.map(tf => (
                <button
                    key={tf}
                    onClick={() => onSelect(tf)}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize
                        ${selected === tf ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/60'}`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
};

export function StrategyControls({ strategyParams, setStrategyParams, currentTimeframe, setCurrentTimeframe, hideTimeframe = false }: { hideTimeframe?: boolean; strategyParams: StrategyParameters; setStrategyParams: React.Dispatch<React.SetStateAction<StrategyParameters>>; currentTimeframe: Timeframe; setCurrentTimeframe: (tf: Timeframe) => void }) {
return <>
                        {!hideTimeframe && <div className="mb-4"><TimeframeSelector selected={currentTimeframe} onSelect={setCurrentTimeframe} /></div>}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                            {/* Parameter sections here */}
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                               <h3 className="font-bold mb-2 text-slate-600 dark:text-slate-300">Bollinger Bands</h3>
                               <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useBB} onChange={e => setStrategyParams(p => ({...p, useBB: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> Use BB</label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Period: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.bbPeriod} onChange={e => setStrategyParams(p => ({...p, bbPeriod: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Std Dev: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.bbStd} onChange={e => setStrategyParams(p => ({...p, bbStd: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                               <h3 className="font-bold mb-2 text-slate-600 dark:text-slate-300">RSI</h3>
                               <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useRSI} onChange={e => setStrategyParams(p => ({...p, useRSI: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> Use RSI</label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Period: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.rsiPeriod} onChange={e => setStrategyParams(p => ({...p, rsiPeriod: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Overbought: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.rsiOverbought} onChange={e => setStrategyParams(p => ({...p, rsiOverbought: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Oversold: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.rsiOversold} onChange={e => setStrategyParams(p => ({...p, rsiOversold: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                               <h3 className="font-bold mb-2 text-slate-600 dark:text-slate-300">MACD</h3>
                               <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useMACD} onChange={e => setStrategyParams(p => ({...p, useMACD: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> Use MACD</label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Fast: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.macdFast} onChange={e => setStrategyParams(p => ({...p, macdFast: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Slow: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.macdSlow} onChange={e => setStrategyParams(p => ({...p, macdSlow: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Signal: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.macdSignal} onChange={e => setStrategyParams(p => ({...p, macdSignal: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                               <h3 className="font-bold mb-2 text-slate-600 dark:text-slate-300">Risk Management</h3>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Risk/Trade (%): <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.riskPct} onChange={e => setStrategyParams(p => ({...p, riskPct: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Stop Loss (ATR×): <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.stopATR} onChange={e => setStrategyParams(p => ({...p, stopATR: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Slippage (bps): <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.slipBps} onChange={e => setStrategyParams(p => ({...p, slipBps: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Commission ($): <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.commission} onChange={e => setStrategyParams(p => ({...p, commission: +e.target.value}))} /></label>
                               <label className="flex items-center gap-2 mt-3 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.allowFractionalShares} onChange={e => setStrategyParams(p => ({...p, allowFractionalShares: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> Allow Fractional Shares</label>
                               
                               <div className="mt-3 pt-3 border-t dark:border-slate-600">
                                   <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                       <input type="checkbox" checked={strategyParams.useTrailingStop} onChange={e => setStrategyParams(p => ({...p, useTrailingStop: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> 
                                       Use Trailing Stop
                                   </label>
                                   {strategyParams.useTrailingStop && (
                                       <div className="pl-4 mt-2 space-y-2">
                                           <label className="block text-sm text-slate-600 dark:text-slate-400">Trail Multiplier (ATR×):
                                               <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.trailingATRMultiplier} onChange={e => setStrategyParams(p => ({...p, trailingATRMultiplier: +e.target.value}))} />
                                           </label>
                                           <label className="block text-sm text-slate-600 dark:text-slate-400">Activation Mode:
                                               <select className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" value={strategyParams.trailingStopActivation || 'ratchet'} onChange={e => setStrategyParams(p => ({...p, trailingStopActivation: e.target.value as 'ratchet' | 'immediate'}))}>
                                                   <option value="ratchet">High-water mark (never loosens)</option>
                                                   <option value="immediate">Close-based (never loosens)</option>
                                               </select>
                                           </label>
                                       </div>
                                   )}
                               </div>
                           </div>
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                               <h3 className="font-bold mb-2 text-slate-600 dark:text-slate-300">Filters & Exits</h3>
                               <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useTrendFilter} onChange={e => setStrategyParams(p => ({...p, useTrendFilter: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600" /> Use Trend Filter</label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Trend SMA Period: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.trendFilterPeriod} onChange={e => setStrategyParams(p => ({...p, trendFilterPeriod: +e.target.value}))} /></label>
                               
                               <label className="flex items-center gap-2 mt-4 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useTakeProfit} onChange={e => setStrategyParams(p => ({...p, useTakeProfit: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600"/> Use Take Profit</label>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Take Profit (ATR×): <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" step="0.1" value={strategyParams.takeProfitATR} onChange={e => setStrategyParams(p => ({...p, takeProfitATR: +e.target.value}))} /></label>

                               <label className="flex items-center gap-2 mt-4 text-slate-700 dark:text-slate-300"><input type="checkbox" checked={strategyParams.useMomentumEntry} onChange={e => setStrategyParams(p => ({...p, useMomentumEntry: e.target.checked}))} className="dark:bg-slate-900 dark:border-slate-600"/> Use Momentum Entry</label>
                               <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Momentum entry requires price above its SMA and RSI above 50, using the RSI period configured above. This RSI condition applies even when Use RSI is unchecked.</p>
                               <label className="block mt-2 text-sm text-slate-600 dark:text-slate-400">Momentum SMA Period: <input className="w-full p-1 border rounded dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" type="number" value={strategyParams.momentumSMAPeriod} onChange={e => setStrategyParams(p => ({...p, momentumSMAPeriod: +e.target.value}))} /></label>
                           </div>
                        </div>
</>;
}
