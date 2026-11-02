import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { AppStep, Benchmark, OptimizationResult, StockData, StrategyParameters, Timeframe, Signal } from './types.ts';
import { calculateAllIndicators, runBacktest, runOptimization } from './services/tradingService.ts';
import { fetchDailyData, resampleOHLC } from './services/apiServices.ts';
import { StrategyControls } from './components/StrategyControls.tsx';
import { HoldoutValidation } from './components/HoldoutValidation.tsx';
import { makeHoldoutPlan, sliceData, runDevelopment, optimizeDevelopment, type SearchRecord, type LockedHoldout } from './services/holdoutService.ts';
import { recordExposure } from './services/validationHistory.ts';
import { AnalysisChat } from './components/AnalysisChat.tsx';
import { validateParameters, validateBacktest, requiredBars } from './services/validation.ts';
import { createRunSnapshot, runMatches, type RunSnapshot } from './services/runSnapshot.ts';
import { BrainCircuitIcon, ChartLineIcon, CogsIcon, DownloadIcon, PlayIcon, SearchIcon, MoonIcon, SunIcon } from './components/Icons.tsx';
import { PriceAndIndicatorCharts, HeatmapChart } from './components/Charts.tsx';
import { parseRangeSpec } from './utils.ts';
import { exportTradesCSV, exportSummaryCSV } from './services/exportService.ts';



// Default state for strategy parameters, updated with AI recommendations
import { defaultStrategyParams } from './defaults.ts';

const defaultOptimizationParams = {
    param1: 'rsi_period',
    range1: '7-21:1',
    param2: 'stop_loss_atr',
    range2: '1.0-4.0:0.25',
    metric: 'sharpe',
};

type Theme = 'light' | 'dark';

// --- Reusable UI Components defined within App.tsx ---

const WorkflowStepper: React.FC<{ currentStep: AppStep; setStep: (step: AppStep) => void }> = ({ currentStep, setStep }) => {
    const steps = [
        { id: AppStep.MarketAnalysis, label: 'Market Analysis' },
        { id: AppStep.StrategySetup, label: 'Strategy Setup' },
        { id: AppStep.Backtest, label: 'Backtest & AI' },
        { id: AppStep.Optimization, label: 'Optimization' },
        { id: AppStep.Validation, label: 'Validation' },
    ];
    return (
        <div className="flex justify-between items-start gap-3 relative mb-8 overflow-x-auto py-2" aria-label="Workflow">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-300 dark:bg-slate-700 transform -translate-y-1/2 -z-10"></div>
            {steps.map((step) => {
                const isActive = currentStep === step.id;
                // Navigation order is not proof that a step was completed.
                return (
                    <button type="button" key={step.id} aria-current={isActive ? 'step' : undefined} className="flex flex-1 flex-col items-center min-w-[86px] group" onClick={() => setStep(step.id)}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
                            ${isActive ? 'bg-blue-600 border-blue-600 text-white scale-110' :
                             'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 group-hover:border-blue-400'}`}>
                            {step.id}
                        </div>
                        <span className={`mt-2 text-sm font-medium transition-colors duration-300 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>{step.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

const MetricCard: React.FC<{ label: string; value: string | number; colorClass?: string }> = ({ label, value, colorClass = 'text-slate-800 dark:text-slate-100' }) => (
    <div className="bg-white dark:bg-slate-700/50 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 text-center transition-transform hover:scale-105">
        <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    </div>
);

const SignalList: React.FC<{ signals: Signal[] }> = ({ signals }) => {
    const [showAll, setShowAll] = useState(false);

    const currentMonthSignals = useMemo(() => {
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth(); // 0-indexed

        return signals.filter(s => {
            const signalDate = new Date(s.date);
            return signalDate.getUTCFullYear() === currentYear && signalDate.getUTCMonth() === currentMonth;
        });
    }, [signals]);

    const displayedSignals = useMemo(() => {
        if (showAll) {
            return signals;
        }
        if (currentMonthSignals.length > 0) {
            return currentMonthSignals;
        }
        // Fallback to latest 5 if there are signals, but none in the current month.
        if (signals.length > 0) {
            return signals.slice(-5);
        }
        return [];
    }, [signals, showAll, currentMonthSignals]);

    const hasSignalsThisMonth = currentMonthSignals.length > 0;
    const isShowingFallback = !showAll && !hasSignalsThisMonth && signals.length > 0;

    if (signals.length === 0) {
        return (
             <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border dark:border-slate-700 text-center text-slate-500 dark:text-slate-400">
                No signals generated for this backtest.
            </div>
        );
    }

    return (
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200">
                    {showAll ? 'All Signals' : (hasSignalsThisMonth ? 'Current Month Signals' : 'Recent Signals')}
                </h3>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded dark:bg-slate-900 dark:border-slate-600" />
                    Show All Signals
                </label>
            </div>
             {isShowingFallback && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 -mt-2">
                    No signals this month. Showing the 5 most recent signals.
                </p>
            )}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {displayedSignals.slice().reverse().map((s, i) => (
                    <div key={i} className={`p-3 rounded-lg flex justify-between items-center text-sm
                        ${s.type === 'buy' ? 'bg-green-100 dark:bg-green-500/10 border-l-4 border-green-500' : 'bg-red-100 dark:bg-red-500/10 border-l-4 border-red-500'}`}>
                        <span className={`font-bold ${s.type === 'buy' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{s.type.toUpperCase()}</span>
                        <span className="text-slate-600 dark:text-slate-300">{s.date}</span>
                        <span className="font-mono text-slate-800 dark:text-slate-100">${s.price.toFixed(2)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Main App Component ---

function App() {
    const [reserveEvaluation, setReserveEvaluation] = useState(false);
    const [splitDate, setSplitDate] = useState('');
    const [warmup, setWarmup] = useState(200);
    const [prior, setPrior] = useState<LockedHoldout['priorKnowledge']>('unknown');
    const [searches, setSearches] = useState<SearchRecord[]>([]);
    const [experimentVersion, setExperimentVersion] = useState(0);
    const [asOf] = useState(() => new Date().toISOString().slice(0,10));
    const [storageWarning, setStorageWarning] = useState('');
    const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.MarketAnalysis);
    const [stockSymbol, setStockSymbol] = useState<string>('AAPL');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [dailyData, setDailyData] = useState<StockData | null>(null);
    const [strategyParams, setStrategyParams] = useState<StrategyParameters>(defaultStrategyParams);
    
    const [run, setRun] = useState<RunSnapshot | null>(null);
    const [loadedSymbol, setLoadedSymbol] = useState('');
    const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>('daily');
    const reservation = useMemo(() => {
        if (!reserveEvaluation || !dailyData) return {plan: null, error: ''};
        try { return {plan: makeHoldoutPlan(dailyData, currentTimeframe, splitDate, warmup, asOf), error: ''}; }
        catch (e) { return {plan: null, error: (e as Error).message}; }
    }, [reserveEvaluation, dailyData, currentTimeframe, splitDate, warmup, asOf]);
    const plan = reservation.plan;
    // Never fall back to full history when reservation is enabled but invalid.
    const resampledData = useMemo(() => reserveEvaluation
        ? (plan ? sliceData(plan.data, 0, plan.splitIndex) : null)
        : (dailyData ? resampleOHLC(dailyData, currentTimeframe) : null), [dailyData, currentTimeframe, reserveEvaluation, plan]);
    const runIsCurrent = runMatches(run, loadedSymbol, currentTimeframe, strategyParams) && loadedSymbol === stockSymbol.trim().toUpperCase();
    const backtestResult = runIsCurrent ? run!.result : null;
    const benchmarkResult = runIsCurrent ? run!.benchmark : null;
    const parameterErrors = validateParameters(strategyParams);
    const neededBars = parameterErrors.length ? 0 : requiredBars(strategyParams);
    const historyError = resampledData && neededBars > resampledData.dates.length
      ? `Only ${resampledData.dates.length} ${currentTimeframe} bars available; this setup needs at least ${neededBars}. Reduce indicator periods or choose a shorter timeframe.` : null;
    const warmupError = plan && neededBars - 1 > plan.warmupBars
        ? `This setup needs ${neededBars - 1} warm-up bars. Increase the budget in Market Analysis or shorten indicator periods.` : null;
    const setupInvalid = parameterErrors.length > 0 || !!historyError || !!warmupError || (reserveEvaluation && !plan);


    const [optimizationParams, setOptimizationParams] = useState(defaultOptimizationParams);
    const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
    
    const optimizationGeneration = useRef(0);
    useEffect(() => { setRun(null); setOptimizationResult(null); optimizationGeneration.current++; }, [strategyParams, currentTimeframe, dailyData, stockSymbol, plan, reserveEvaluation, experimentVersion]);

    useEffect(() => { setOptimizationResult(null); optimizationGeneration.current++; }, [optimizationParams]);
    useEffect(() => { setSearches([]); }, [plan, reserveEvaluation, experimentVersion]);
    useEffect(() => { setError(null); }, [currentStep]);

    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            const storedTheme = window.localStorage.getItem('theme') as Theme | null;
            if (storedTheme) return storedTheme;
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
    };

    const handleLoadData = useCallback(async () => {
        if (!stockSymbol) {
            setError('Please enter a stock symbol.');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const symbol = stockSymbol.trim().toUpperCase();
            const data = await fetchDailyData(symbol);
            setLoadedSymbol(symbol);
            setDailyData(data);
            setRun(null);
            setOptimizationResult(null);
            const start = Date.parse(data.dates[0]), end = Date.parse(data.dates.at(-1)!);
            setSplitDate(new Date(start + .6 * (end - start)).toISOString().slice(0,10));
            setExperimentVersion(v => v + 1);
        } catch (err) {
            setError((err as Error).message);
            setDailyData(null);
            setRun(null);
            setOptimizationResult(null);
        } finally {
            setIsLoading(false);
        }
    }, [stockSymbol]);

    const handleRunBacktest = useCallback(() => {
        if (!dailyData || loadedSymbol !== stockSymbol.trim().toUpperCase()) { setError('Load market data for the selected symbol first.'); return; }
        setError(null);
        setRun(null);
        try {
            if (reserveEvaluation) {
                if (!plan) throw new Error(reservation.error || 'Choose valid validation dates in Market Analysis.');
                const result = runDevelopment(loadedSymbol, plan, strategyParams);
                try { recordExposure(localStorage, {symbol: loadedSymbol, start: plan.data.openDates![0], end: plan.developmentEnd, recordedAt: new Date().toISOString(), source: 'development'}); }
                catch { setStorageWarning('Browser exposure history could not be saved. Treat later validation as prior exposure unknown.'); }
                setRun(result);
                return;
            }
            const data = resampleOHLC(dailyData, currentTimeframe);
            validateBacktest(data, strategyParams, currentTimeframe);
            const indicators = calculateAllIndicators(data, strategyParams);
            const result = runBacktest(data, indicators, strategyParams, currentTimeframe);
            const years = (Date.parse(data.dates[data.dates.length - 1]) - Date.parse(data.dates[0])) / (365.25 * 24 * 3600 * 1000);
            const ret = data.c[data.c.length - 1] / data.c[0] - 1;
            const benchmark: Benchmark = { equity: data.c.map(price => 10000 * price / data.c[0]), ret: ret * 100, cagr: years > 0 ? (Math.pow(1 + ret, 1 / years) - 1) * 100 : 0 };
            try { recordExposure(localStorage, {symbol: loadedSymbol, start: data.dates[0], end: data.dates.at(-1)!, recordedAt: new Date().toISOString(), source: 'exploration'}); } catch { setStorageWarning('Browser exposure history could not be saved. Treat later validation as prior exposure unknown.'); }
            setRun(createRunSnapshot(loadedSymbol, currentTimeframe, data, strategyParams, result, benchmark));
        } catch (err) { setError((err as Error).message); }
    }, [dailyData, loadedSymbol, stockSymbol, strategyParams, currentTimeframe, reserveEvaluation, plan, reservation.error]);

    const handleRunOptimization = useCallback(async () => {
        if (!dailyData || loadedSymbol !== stockSymbol.trim().toUpperCase()) {
            setError('Please load market data first.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setOptimizationResult(null);

        const generation = optimizationGeneration.current;
        await new Promise(resolve => setTimeout(resolve, 50));
        if (generation !== optimizationGeneration.current) { setIsLoading(false); return; }

        try {
            const p1Range = parseRangeSpec(optimizationParams.range1);
            const p2Range = optimizationParams.param2 === 'select' ? [] : parseRangeSpec(optimizationParams.range2);
            if(p1Range.length === 0) {
                throw new Error("Invalid range specification for Parameter 1.");
            }

            let result;
            if (reserveEvaluation) {
                if (!plan) throw new Error(reservation.error || 'Choose valid validation dates in Market Analysis.');
                const attempt = optimizeDevelopment(plan, strategyParams, {...optimizationParams, range1: p1Range, range2: p2Range});
                result = attempt.result;
                setSearches(s => [...s, attempt.record]);
                try { recordExposure(localStorage, {symbol: loadedSymbol, start: plan.data.openDates![0], end: plan.developmentEnd, recordedAt: new Date().toISOString(), source: 'development'}); }
                catch { setStorageWarning('Browser exposure history could not be saved. Treat later validation as prior exposure unknown.'); }
            } else {
                const dataForOptimization = resampleOHLC(dailyData, currentTimeframe);
                try { recordExposure(localStorage, {symbol: loadedSymbol, start: dataForOptimization.dates[0], end: dataForOptimization.dates.at(-1)!, recordedAt: new Date().toISOString(), source: 'exploration'}); }
                catch { setStorageWarning('Browser exposure history could not be saved. Treat later validation as prior exposure unknown.'); }
                result = runOptimization(dataForOptimization, strategyParams, optimizationParams.param1, p1Range,
                    optimizationParams.param2, p2Range, optimizationParams.metric, currentTimeframe);
            }
            const { grid, best } = result;
            setOptimizationResult({
                grid,
                xs: p1Range,
                ys: optimizationParams.param2 === 'select' ? [0] : p2Range,
                best: best,
                param1: optimizationParams.param1,
                param2: optimizationParams.param2
            });

        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [dailyData, loadedSymbol, stockSymbol, strategyParams, optimizationParams, currentTimeframe, reserveEvaluation, plan, reservation.error]);

    const indicators = useMemo(() => {
        const data = resampledData;
        if (!data || validateParameters(strategyParams).length) return null;
        return calculateAllIndicators(data, strategyParams);
    }, [resampledData, strategyParams]);

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 font-sans leading-relaxed transition-colors duration-300">
            <header className="text-center mb-8 relative">
                <h1 className="text-4xl md:text-5xl font-extrabold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-3">
                    <ChartLineIcon /> AI Trading Strategy Analyzer
                </h1>
                <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
                    Backtest, optimize, and enhance your trading strategies with AI-powered insights.
                </p>
                <button
                    onClick={toggleTheme}
                    className="absolute top-0 right-0 p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                    aria-label="Toggle theme"
                >
                    {theme === 'light' ? <MoonIcon /> : <SunIcon />}
                </button>
            </header>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}
            
            <main className="[&_p]:leading-relaxed [&_li]:leading-relaxed bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
                {storageWarning && <p role="alert" className="text-amber-700 mb-4">{storageWarning}</p>}
                <WorkflowStepper currentStep={currentStep} setStep={setCurrentStep} />
                <h2 className="text-2xl font-bold text-slate-700 dark:text-slate-200 mb-4">
                    {{
                        [AppStep.MarketAnalysis]: 'Load Market Data',
                        [AppStep.StrategySetup]: 'Configure Strategy Parameters',
                        [AppStep.Backtest]: 'Backtest & AI Analysis',
                        [AppStep.Optimization]: 'Strategy Optimization',
                        [AppStep.Validation]: 'Out-of-Sample Validation',
                    }[currentStep]}
                </h2>
                {currentStep !== AppStep.MarketAnalysis && currentStep !== AppStep.Validation && (
                  <div className="mb-5 text-sm text-slate-600 dark:text-slate-300 space-y-2">
                    <p><span className="inline-block rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 font-semibold">{reserveEvaluation ? 'Development period only' : 'Full history'}</span>{plan && <span className="ml-2">{plan.developmentStart} → {plan.developmentEnd} · Reserved evaluation: {plan.evaluationStart} → {plan.evaluationEnd}</span>}</p>
                    <p>Periods count {currentTimeframe} bars. Signals use any enabled reversal indicator without an opposing reversal signal, or momentum entry; buys must pass the trend filter.</p>
                    {parameterErrors.length > 0 && <ul role="alert" className="text-red-600 list-disc pl-5">{parameterErrors.map(message => <li key={message}>{message}</li>)}</ul>}
                    {reservation.error && <p role="alert" className="text-amber-700 dark:text-amber-300">{reservation.error} Update the reservation in Market Analysis.</p>}
                    {warmupError && <p role="alert" className="text-amber-700 dark:text-amber-300">{warmupError}</p>}
                    {historyError && <p role="alert" className="text-amber-700 dark:text-amber-300">{historyError}</p>}
                    {loadedSymbol !== stockSymbol.trim().toUpperCase() && <p role="alert">Load data for the selected symbol before running a backtest.</p>}
                  </div>
                )}
                
                {/* Step 1: Market Analysis */}
                {currentStep === AppStep.MarketAnalysis && (
                    <div className="animate-fade-in">
                        <form onSubmit={(e) => { e.preventDefault(); handleLoadData(); }} className="flex flex-col sm:flex-row gap-4">
                            <input
                                type="text"
                                value={stockSymbol}
                                onChange={(e) => setStockSymbol(e.target.value)}
                                placeholder="Enter stock symbol (e.g., AAPL)"
                                className="flex-grow p-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                aria-label="Stock Symbol"
                            />
                            <button type="submit" disabled={isLoading} className="flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-slate-400">
                                <SearchIcon /> {isLoading ? 'Loading...' : 'Load Data'}
                            </button>
                        </form>
                        {dailyData && loadedSymbol === stockSymbol.trim().toUpperCase() && <div className="mt-6 space-y-5">
                            <p className="text-sm text-slate-600 dark:text-slate-300">Loaded {loadedSymbol}: {dailyData.dates[0]} → {dailyData.dates.at(-1)}. Choose whether to reserve later data before developing your strategy.</p>
                            <section className="p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                                <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={reserveEvaluation} onChange={e => setReserveEvaluation(e.target.checked)} />Reserve data for validation <span className="text-sm font-normal text-slate-500">Optional</span></label>
                                <p className="text-sm">When enabled, Backtest &amp; AI and Optimization use the earlier development period. Step 5 evaluates the reserved period after you lock your strategy.</p>
                                {reserveEvaluation && <>
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <label className="grid gap-2 text-sm font-medium">Evaluation starts on or after<input aria-label="Evaluation start date" type="date" value={splitDate} onChange={e => setSplitDate(e.target.value)} className="p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600" /></label>
                                        <label className="grid gap-2 text-sm font-medium">Development warm-up bars<input aria-label="Development warm-up bars" type="number" min={14} max={2000} value={warmup} onChange={e => setWarmup(+e.target.value)} className="p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600" /></label>
                                    </div>
                                    <p className="text-sm">Timeframe: {currentTimeframe} (change in Strategy Setup). Warm-up bars initialize indicators and are excluded from development performance. Changing dates or timeframe clears current results.</p>
                                    {reservation.error && <p role="alert" className="text-amber-700 dark:text-amber-300">{reservation.error}</p>}
                                    {plan && <div className="grid sm:grid-cols-2 gap-4 text-sm"><p><strong className="block">Development period</strong>{plan.developmentStart} → {plan.developmentEnd}<br/>{plan.splitIndex - plan.warmupBars} scoring bars</p><p><strong className="block">Reserved evaluation</strong>{plan.evaluationStart} → {plan.evaluationEnd}<br/>{plan.data.dates.length - plan.splitIndex} scoring bars</p></div>}
                                    <label className="grid gap-2 text-sm">Have these evaluation dates influenced your earlier research?<select aria-label="Prior evaluation exposure" value={prior} onChange={e => setPrior(e.target.value as LockedHoldout['priorKnowledge'])} className="w-full p-2 border rounded-lg dark:bg-slate-900 dark:border-slate-600"><option value="unknown">Unknown — treat as retrospective research</option><option value="reviewed">Yes — already reviewed or used for strategy selection</option><option value="not-reviewed">No, to my knowledge — not independently verified</option></select></label>
                                    <p className="text-sm text-slate-500">Today is excluded. Weekly/monthly edge intervals are excluded conservatively. Previously viewed charts or results may already have exposed these dates; reserving them cannot make them unseen.</p>
                                </>}
                            </section>
                            <div className="flex justify-end"><button onClick={() => setCurrentStep(AppStep.StrategySetup)} className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700">Continue to Strategy Setup &rarr;</button></div>
                        </div>}
                        {!reserveEvaluation && (<div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden h-[600px]">
                            <iframe 
                                key={`${stockSymbol}-${theme}`}
                                title={`${stockSymbol} Market Overview Chart`}
                                id="stockChart"
                                className="w-full h-full"
                                src={`https://s.tradingview.com/widgetembed/?symbol=${stockSymbol.toUpperCase()}&interval=D&theme=${theme}&style=1&hidesidetoolbar=1&symboledit=0`}
                            />
                        </div>)}
                    </div>
                )}

                {/* Step 2: Strategy Setup */}
                {currentStep === AppStep.StrategySetup && (
                     <div className="animate-fade-in">
                        <StrategyControls strategyParams={strategyParams} setStrategyParams={setStrategyParams} currentTimeframe={currentTimeframe} setCurrentTimeframe={tf => {setCurrentTimeframe(tf); setWarmup(tf === 'daily' ? 200 : tf === 'weekly' ? 52 : 24);}} />
                        <div className="mt-6 flex justify-end">
                             <button disabled={setupInvalid || !dailyData} onClick={() => setCurrentStep(AppStep.Backtest)} className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                                Proceed to Backtest &rarr;
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Step 3: Backtest Results */}
                {currentStep === AppStep.Backtest && (
                    <div className="animate-fade-in space-y-6">
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    Run the strategy configured in Strategy Setup. Results, charts, and AI analysis will appear below.
                                </p>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
                                <p className="text-sm text-slate-600 dark:text-slate-300">Timeframe: <span className="font-semibold capitalize">{currentTimeframe}</span></p>
                                <div className="flex items-center gap-2">
                                    <button onClick={handleRunBacktest} disabled={isLoading || !dailyData || setupInvalid || loadedSymbol !== stockSymbol.trim().toUpperCase()} className="flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-slate-400 disabled:cursor-not-allowed whitespace-nowrap">
                                        <PlayIcon /> {isLoading ? 'Running...' : (backtestResult ? 'Re-Run Backtest' : 'Run Backtest')}
                                    </button>
                                    {backtestResult && benchmarkResult && (
                                        <>
                                            <button onClick={() => exportTradesCSV(backtestResult, run!.symbol, run!.params.commission)} className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg" title="Export Trades">
                                                <DownloadIcon />
                                            </button>
                                            <button onClick={() => exportSummaryCSV(backtestResult, benchmarkResult, run!.params, run!.symbol, run!.timeframe)} className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg" title="Export Summary">
                                                <ChartLineIcon />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {!backtestResult || !benchmarkResult ? (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                                <div className="max-w-2xl mx-auto">
                                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Ready to test your setup</h3>
                                    <p className="mt-2 text-slate-500 dark:text-slate-400">
                                        Your selected timeframe is <span className="font-semibold capitalize">{currentTimeframe}</span>. Click <span className="font-semibold">Run Backtest</span> to generate performance metrics, charts, trading signals, and the AI review (available on request).
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-slate-500">{run!.symbol} · {run!.timeframe} · {run!.startDate} to {run!.endDate}. Entry-ATR stops and targets; stop-first for ambiguous bars. Drawdown uses closing equity. Buy &amp; hold excludes fees and dividends. {reserveEvaluation ? 'Development performance excludes warm-up bars.' : 'Results include the warm-up interval.'}</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                                    <MetricCard label="Initial Capital" value="$10,000" />
                                    <MetricCard
                                        label="Final Equity"
                                        value={`$${backtestResult.metrics.finalEquity.toFixed(2)}`}
                                        colorClass={backtestResult.metrics.finalEquity >= 10000 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                                    />
                                    <MetricCard
                                        label="Total Return"
                                        value={`${backtestResult.metrics.totalReturn.toFixed(2)}%`}
                                        colorClass={backtestResult.metrics.totalReturn >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                                    />
                                    <MetricCard
                                        label="Buy & Hold Return"
                                        value={`${benchmarkResult.ret.toFixed(2)}%`}
                                        colorClass={benchmarkResult.ret >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                                    />
                                    <MetricCard label="Number of Trades" value={backtestResult.metrics.numTrades} />
                                    <MetricCard label="Time in Market" value={`${backtestResult.metrics.timeInMarketPct.toFixed(1)}%`} />
                                    <MetricCard label="CAGR" value={`${backtestResult.metrics.cagr.toFixed(2)}%`} />
                                    <MetricCard label="Buy & Hold CAGR" value={`${benchmarkResult.cagr.toFixed(2)}%`} />
                                    <MetricCard label="Sharpe Ratio" value={backtestResult.metrics.sharpeRatio.toFixed(2)} />
                                    <MetricCard
                                        label="Max Drawdown"
                                        value={`${backtestResult.metrics.maxDrawdown.toFixed(2)}%`}
                                        colorClass="text-red-600 dark:text-red-400"
                                    />
                                    <MetricCard label="Win Rate" value={`${backtestResult.metrics.winRate.toFixed(1)}%`} />
                                    <MetricCard
                                        label="Profit Factor"
                                        value={Number.isFinite(backtestResult.metrics.profitFactor) ? backtestResult.metrics.profitFactor.toFixed(2) : '∞'}
                                    />
                                </div>

                                {indicators && (
                                    <PriceAndIndicatorCharts stockData={resampledData!} indicators={indicators} backtestResult={backtestResult} />
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div><p className="mb-2 text-sm text-slate-500">Signal prices are bar closes, not fills. Executed trades appear on the chart and in the trade export.</p><SignalList signals={backtestResult.signals} /></div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                                        <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-3"><BrainCircuitIcon /> OpenAI Analysis Chat</h3>
                                        <AnalysisChat key={run!.id} run={run!} />
                                    </div>
                                </div>
                            </>
                        )}
                        <div className="flex flex-wrap justify-between gap-3 border-t dark:border-slate-700 pt-6">
                            <button className="px-4 py-2 border rounded-lg" onClick={() => setCurrentStep(AppStep.StrategySetup)}>Back to Strategy Setup</button>
                            <div className="flex flex-wrap gap-3"><button className="px-4 py-2 border rounded-lg" onClick={() => setCurrentStep(AppStep.Optimization)}>Optimize Strategy (Optional)</button>{reserveEvaluation && <button className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50" disabled={!backtestResult} onClick={() => setCurrentStep(AppStep.Validation)}>Continue to Validation &rarr;</button>}</div>
                        </div>
                    </div>
                )}
                
                {/* Step 4: Optimization */}
                {currentStep === AppStep.Optimization && (
                    <div className="animate-fade-in">
                        <div className="flex justify-between items-center mb-4">
                             <button onClick={handleRunOptimization} disabled={isLoading || !dailyData || setupInvalid || loadedSymbol !== stockSymbol.trim().toUpperCase()} className="flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-purple-700 transition disabled:bg-slate-400">
                                <CogsIcon /> {isLoading ? 'Optimizing...' : 'Run Optimization'}
                            </button>
                        </div>
                        <p className="mb-4 text-sm text-slate-500">Optimization is optional. It ranks {reserveEvaluation ? 'development-period' : 'full-history'} results, not future performance. Enable the corresponding feature in Strategy Setup before optimizing its parameters. Candidates need at least five completed trades. {reserveEvaluation ? 'Candidates must fit the fixed warm-up budget. Apply selected parameters, then rerun Backtest before validation.' : 'To reserve later data, enable validation in Market Analysis before developing your strategy.'}</p>
                        {reserveEvaluation && <p className="mb-4 text-sm text-slate-500">{searches.length} searches recorded · {searches.reduce((n,s)=>n+s.combinations,0)} combinations tried.</p>}
                        {optimizationResult && !optimizationResult.best && <p role="status" className="mb-4 text-amber-700">No eligible strategy found. Check indicator warm-up, parameter ranges, and the five-trade minimum.</p>}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700 space-y-4">
                                <div>
                                    <label htmlFor="param1-select" className="font-semibold text-slate-600 dark:text-slate-300">Parameter 1</label>
                                    <select id="param1-select" value={optimizationParams.param1} onChange={e => setOptimizationParams(p => ({...p, param1: e.target.value}))} className="w-full p-2 border rounded mt-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200">
                                        <optgroup label="Bollinger Bands">
                                            <option value="bb_period">BB Period</option>
                                            <option value="bb_std">BB Std Dev</option>
                                        </optgroup>
                                        <optgroup label="RSI">
                                            <option value="rsi_period">RSI Period</option>
                                            <option value="rsi_overbought">RSI Overbought</option>
                                            <option value="rsi_oversold">RSI Oversold</option>
                                        </optgroup>
                                         <optgroup label="MACD">
                                            <option value="macd_fast">MACD Fast</option>
                                            <option value="macd_slow">MACD Slow</option>
                                            <option value="macd_signal">MACD Signal</option>
                                        </optgroup>
                                        <optgroup label="Risk">
                                            <option value="stop_loss_atr">Stop-Loss ATR</option>
                                            <option value="risk_per_trade">Risk Per Trade</option>
                                            <option value="trailing_atr_multiplier">Trailing Stop Multiplier</option>
                                        </optgroup>
                                    </select>
                                    <input type="text" value={optimizationParams.range1} onChange={e => setOptimizationParams(p => ({...p, range1: e.target.value}))} placeholder="min-max:step" className="w-full p-2 border rounded mt-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" aria-label="Parameter 1 Range" />
                                </div>
                                <div>
                                    <label htmlFor="param2-select" className="font-semibold text-slate-600 dark:text-slate-300">Parameter 2</label>
                                    <select id="param2-select" value={optimizationParams.param2} onChange={e => setOptimizationParams(p => ({...p, param2: e.target.value}))} className="w-full p-2 border rounded mt-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200">
                                        <option value="select">-- None (1D) --</option>
                                        <optgroup label="Bollinger Bands">
                                            <option value="bb_period">BB Period</option>
                                            <option value="bb_std">BB Std Dev</option>
                                        </optgroup>
                                        <optgroup label="RSI">
                                            <option value="rsi_period">RSI Period</option>
                                            <option value="rsi_overbought">RSI Overbought</option>
                                            <option value="rsi_oversold">RSI Oversold</option>
                                        </optgroup>
                                         <optgroup label="MACD">
                                            <option value="macd_fast">MACD Fast</option>
                                            <option value="macd_slow">MACD Slow</option>
                                            <option value="macd_signal">MACD Signal</option>
                                        </optgroup>
                                        <optgroup label="Risk">
                                            <option value="stop_loss_atr">Stop-Loss ATR</option>
                                            <option value="risk_per_trade">Risk Per Trade</option>
                                            <option value="trailing_atr_multiplier">Trailing Stop Multiplier</option>
                                        </optgroup>
                                    </select>
                                    <input type="text" value={optimizationParams.range2} onChange={e => setOptimizationParams(p => ({...p, range2: e.target.value}))} placeholder="min-max:step" className="w-full p-2 border rounded mt-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200" aria-label="Parameter 2 Range" />
                                </div>
                                <div>
                                    <label htmlFor="metric-select" className="font-semibold text-slate-600 dark:text-slate-300">Optimize For</label>
                                    <select id="metric-select" value={optimizationParams.metric} onChange={e => setOptimizationParams(p => ({...p, metric: e.target.value}))} className="w-full p-2 border rounded mt-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200">
                                        <option value="sharpe">Sharpe Ratio</option>
                                        <option value="cagr">CAGR</option>
                                        <option value="alpha_cagr">CAGR difference vs buy-and-hold</option>
                                        <option value="win_rate">Win Rate</option>
                                        <option value="max_drawdown">Max Drawdown (Min)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="lg:col-span-2 space-y-4">
                                {optimizationResult?.best && (
                                    <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border dark:border-slate-700">
                                        <h3 className="font-bold text-slate-600 dark:text-slate-300 mb-2">Best Parameters Found</h3>
                                        <p className="text-sm mb-3">{Object.entries(optimizationResult.best.params).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
                                        <button className="mb-3 px-3 py-2 bg-blue-600 text-white rounded" onClick={() => { setStrategyParams(p => ({ ...p, ...optimizationResult.best!.params })); setCurrentStep(AppStep.StrategySetup); }}>Apply Parameters & Review Setup</button>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                                            <MetricCard label="Best Score" value={optimizationResult.best.score.toFixed(3)} colorClass="text-purple-600 dark:text-purple-400" />
                                            <MetricCard label="Sharpe" value={optimizationResult.best.bt.metrics.sharpeRatio.toFixed(3)} />
                                            <MetricCard label="CAGR" value={`${optimizationResult.best.bt.metrics.cagr.toFixed(2)}%`} />
                                            <MetricCard label="Max DD" value={`${optimizationResult.best.bt.metrics.maxDrawdown.toFixed(2)}%`} colorClass="text-red-500" />
                                        </div>
                                    </div>
                                )}
                                <div className="bg-white dark:bg-slate-800 p-2 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 h-[400px]">
                                    <h3 className="text-center font-semibold text-slate-700 dark:text-slate-200 mb-2">Optimization Heatmap</h3>
                                    {optimizationResult ? (
                                        <HeatmapChart optimizationResult={optimizationResult} />
                                    ): (
                                        <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500">Run optimization to see heatmap.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 flex flex-wrap justify-between gap-3 border-t dark:border-slate-700 pt-6">
                            <button className="px-4 py-2 border rounded-lg" onClick={() => setCurrentStep(AppStep.Backtest)}>Back to Backtest</button>
                            {reserveEvaluation && <button className="px-4 py-2 bg-blue-600 text-white rounded-lg" onClick={() => setCurrentStep(AppStep.Validation)}>Continue to Validation &rarr;</button>}
                        </div>
                    </div>
                )}
                <div hidden={currentStep !== AppStep.Validation}>
                    {plan && loadedSymbol === stockSymbol.trim().toUpperCase() ? <HoldoutValidation
                        key={JSON.stringify([experimentVersion, loadedSymbol, currentTimeframe, splitDate, warmup, prior, strategyParams, searches.length])}
                        symbol={loadedSymbol} plan={plan} params={strategyParams} development={runIsCurrent ? run : null} searches={searches} prior={prior} historyWarning={storageWarning}
                        onBacktest={() => setCurrentStep(AppStep.Backtest)}
                        onRestart={() => {setExperimentVersion(v => v + 1); setCurrentStep(AppStep.MarketAnalysis);}}
                    /> : <section className="space-y-4 leading-relaxed">
                        <p>Reserve an evaluation period in Market Analysis, then develop your strategy in the existing Backtest and Optimization tabs. Return here to lock the strategy and run validation.</p>
                        <p className="text-sm text-slate-500">If you already reviewed full-history results, those dates are not a fresh unseen test. Prior-exposure warnings will remain part of the evaluation.</p>
                        <button className="px-6 py-3 bg-blue-600 text-white rounded-lg" onClick={() => setCurrentStep(AppStep.MarketAnalysis)}>Set Up Validation in Market Analysis</button>
                    </section>}
                </div>
            </main>
        </div>
    );
}

export default App;

