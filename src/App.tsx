import React, { useState, useCallback, useMemo, ReactNode, useRef, useEffect } from 'react';
import { AppStep, BacktestResult, Benchmark, Indicators, OptimizationResult, StockData, StrategyParameters, Timeframe, Signal } from './types';
import { calculateAllIndicators, runBacktest, runOptimization } from './services/tradingService';
import { fetchDailyData, resampleOHLC } from './services/apiServices';
import { getInitialAnalysis, createChatSession, getAnalysisPrompt } from './services/geminiService';
import { BrainCircuitIcon, ChartLineIcon, CogsIcon, DownloadIcon, PlayIcon, SearchIcon, SendIcon } from './components/Icons';
import { PriceAndIndicatorCharts, HeatmapChart } from './components/Charts';
import { parseRangeSpec } from './utils';
import { exportTradesCSV, exportSummaryCSV } from './services/exportService';
import { Chat } from '@google/genai';


// Default state for strategy parameters, updated with AI recommendations
const defaultStrategyParams: StrategyParameters = {
    useBB: true, useRSI: true, useMACD: true,
    bbPeriod: 20, bbStd: 2,
    rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    riskPct: 1, stopATR: 2, commission: 0.5, slipBps: 5,
    useTrendFilter: true,
    trendFilterPeriod: 200,
    useTakeProfit: true,
    takeProfitATR: 1.5,
    useMomentumEntry: true,
    momentumSMAPeriod: 50,
};

const defaultOptimizationParams = {
    param1: 'rsi_period',
    range1: '7-21:1',
    param2: 'stop_loss_atr',
    range2: '1.0-4.0:0.25',
    metric: 'sharpe',
};

// --- Reusable UI Components defined within App.tsx ---

const WorkflowStepper: React.FC<{ currentStep: AppStep; setStep: (step: AppStep) => void }> = ({ currentStep, setStep }) => {
    const steps = [
        { id: AppStep.MarketAnalysis, label: 'Market Analysis' },
        { id: AppStep.StrategySetup, label: 'Strategy Setup' },
        { id: AppStep.Backtest, label: 'Backtest & AI' },
        { id: AppStep.Optimization, label: 'Optimization' },
    ];
    return (
        <div className="flex justify-between items-center relative mb-8">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-300 transform -translate-y-1/2 -z-10"></div>
            {steps.map((step, index) => {
                const isActive = currentStep === step.id;
                const isCompleted = currentStep > step.id;
                return (
                    <div key={step.id} className="flex flex-col items-center cursor-pointer group" onClick={() => setStep(step.id)}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
                            ${isActive ? 'bg-blue-600 border-blue-600 text-white scale-110' :
                             isCompleted ? 'bg-green-500 border-green-500 text-white' :
                             'bg-white border-slate-300 text-slate-500 group-hover:border-blue-400'}`}>
                            {isCompleted ? '✓' : step.id}
                        </div>
                        <span className={`mt-2 text-sm font-medium transition-colors duration-300 ${isActive ? 'text-blue-600' : 'text-slate-500'}`}>{step.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

const MetricCard: React.FC<{ label: string; value: string | number; colorClass?: string }> = ({ label, value, colorClass = 'text-slate-800' }) => (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 text-center transition-transform hover:scale-105">
        <div className="text-sm text-slate-500">{label}</div>
        <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    </div>
);

const TimeframeSelector: React.FC<{ selected: Timeframe, onSelect: (tf: Timeframe) => void }> = ({ selected, onSelect }) => {
    const timeframes: Timeframe[] = ['daily', 'weekly', 'monthly'];
    return (
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            {timeframes.map(tf => (
                <button
                    key={tf}
                    onClick={() => onSelect(tf)}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize
                        ${selected === tf ? 'bg-white text-blue-600 shadow-sm' : 'bg-transparent text-slate-500 hover:bg-slate-200'}`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
};

const SignalList: React.FC<{ signals: Signal[] }> = ({ signals }) => {
    const [showAll, setShowAll] = useState(false);

    const currentMonthSignals = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed

        return signals.filter(s => {
            const signalDate = new Date(s.date);
            // Dates like 'YYYY-MM-DD' are parsed as UTC midnight.
            // Using UTC getters avoids timezone-related issues.
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
             <div className="bg-slate-50 p-4 rounded-lg border text-center text-slate-500">
                No signals generated for this backtest.
            </div>
        );
    }

    return (
        <div className="bg-slate-50 p-4 sm:p-6 rounded-xl border border-slate-200">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-slate-700">
                    {showAll ? 'All Signals' : (hasSignalsThisMonth ? 'Current Month Signals' : 'Recent Signals')}
                </h3>
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded" />
                    Show All Signals
                </label>
            </div>
             {isShowingFallback && (
                <p className="text-sm text-slate-500 mb-3 -mt-2">
                    No signals this month. Showing the 5 most recent signals.
                </p>
            )}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {displayedSignals.slice().reverse().map((s, i) => (
                    <div key={i} className={`p-3 rounded-lg flex justify-between items-center text-sm
                        ${s.type === 'buy' ? 'bg-green-100 border-l-4 border-green-500' : 'bg-red-100 border-l-4 border-red-500'}`}>
                        <span className={`font-bold ${s.type === 'buy' ? 'text-green-700' : 'text-red-700'}`}>{s.type.toUpperCase()}</span>
                        <span className="text-slate-600">{s.date}</span>
                        <span className="font-mono text-slate-800">${s.price.toFixed(2)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Gemini Chat Component (Refactored for Performance) ---

interface GeminiChatProps {
    backtestResult: BacktestResult;
    benchmarkResult: Benchmark;
    strategyParams: StrategyParameters;
    onReset: () => void;
}

const GeminiChat: React.FC<GeminiChatProps> = ({ backtestResult, benchmarkResult, strategyParams, onReset }) => {
    const [chatSession, setChatSession] = useState<Chat | null>(null);
    const [initialAiPrompt, setInitialAiPrompt] = useState<string>('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
    const [chatInput, setChatInput] = useState<string>('');
    const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);

     useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatMessages, isChatLoading]);
    
    // This effect resets the chat when the parent indicates a reset is needed (e.g., new backtest run).
    useEffect(() => {
        setChatMessages([]);
        setChatSession(null);
        setIsChatLoading(false);
        setChatInput('');
    }, [backtestResult]);

    const handleGetAIAnalysis = async () => {
        setIsChatLoading(true);
        setError(null);
        try {
            const prompt = getAnalysisPrompt(backtestResult.metrics, strategyParams, benchmarkResult);
            setInitialAiPrompt(prompt);
            const initialResponse = await getInitialAnalysis(backtestResult.metrics, strategyParams, benchmarkResult);
            setChatSession(null); // Reset session, will be created on first follow-up
            setChatMessages([{ role: 'model', content: initialResponse }]);
        } catch (e) {
            const errorMessage = "Failed to get AI analysis. The API key might be misconfigured or the service may be temporarily unavailable.";
            setError(errorMessage);
            setChatMessages([{ role: 'model', content: `Sorry, I was unable to generate an analysis. Please check the API key and try again. Error: ${(e as Error).message}` }]);
            console.error(e);
        } finally {
            setIsChatLoading(false);
        }
    };

    const handleSendChatMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || isChatLoading || chatMessages.length === 0) return;
    
        const newUserMessage = { role: 'user' as const, content: chatInput };
        setChatMessages(prev => [...prev, newUserMessage, { role: 'model', content: '' }]);
        const currentChatInput = chatInput;
        setChatInput('');
        setIsChatLoading(true);
    
        try {
            let session = chatSession;
            if (!session) {
                const firstModelMessage = chatMessages.find(m => m.role === 'model');
                if (initialAiPrompt && firstModelMessage) {
                    session = createChatSession(initialAiPrompt, firstModelMessage.content);
                    setChatSession(session);
                }
            }
    
            if (!session) throw new Error("Chat session could not be initialized.");
    
            const responseStream = await session.sendMessageStream({ message: currentChatInput });
    
            for await (const chunk of responseStream) {
                const chunkText = chunk.text;
                setChatMessages(prev => {
                    const lastIndex = prev.length - 1;
                    const lastMessage = prev[lastIndex];
                    if (lastMessage.role === 'model') {
                        const updatedMessages = [...prev];
                        updatedMessages[lastIndex] = { ...lastMessage, content: lastMessage.content + chunkText };
                        return updatedMessages;
                    }
                    return prev;
                });
            }
        } catch (err) {
            console.error("Error sending chat message:", err);
            const errorMessage = { role: 'model' as const, content: "Sorry, I encountered an error. Please try again." };
            setChatMessages(prev => {
                const lastIndex = prev.length - 1;
                if (prev[lastIndex]?.role === 'model' && prev[lastIndex].content === '') {
                     const updatedMessages = [...prev];
                     updatedMessages[lastIndex] = errorMessage;
                     return updatedMessages;
                }
                return [...prev, errorMessage];
            });
        } finally {
            setIsChatLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[400px] bg-white rounded-lg border">
            {chatMessages.length === 0 && !isChatLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="text-blue-600"><BrainCircuitIcon /></div>
                    <h4 className="font-semibold mt-2 text-slate-700">Ready for AI Insights?</h4>
                    <p className="text-sm text-slate-500 max-w-xs mt-1">
                        Click the button to have Gemini analyze your backtest results and provide actionable suggestions.
                    </p>
                    <button
                        onClick={handleGetAIAnalysis}
                        className="mt-4 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg hover:bg-blue-700 transition disabled:bg-slate-400"
                        disabled={isChatLoading}
                    >
                        <PlayIcon /> {isChatLoading ? 'Analyzing...' : 'Generate AI Analysis'}
                    </button>
                </div>
            )}
            {isChatLoading && chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full text-slate-500">
                    <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mr-3"></div>
                    Generating initial analysis...
                </div>
            )}
            {chatMessages.length > 0 && 
                <div ref={chatHistoryRef} className="flex-1 p-4 space-y-4 overflow-y-auto">
                    {chatMessages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-lg p-3 rounded-xl ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-800'}`}>
                                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/(\r\n|\n|\r)/g, "<br />").replace(/• /g, "<br/>• ") }} />
                            </div>
                        </div>
                    ))}
                    {isChatLoading && chatMessages.length > 0 && (
                        <div className="flex justify-start">
                            <div className="max-w-lg p-3 rounded-xl bg-slate-200 text-slate-800">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            }
            <form onSubmit={handleSendChatMessage} className="p-4 border-t flex items-center gap-2">
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask a follow-up question..."
                    className="flex-grow p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100"
                    disabled={isChatLoading || chatMessages.length === 0}
                    aria-label="Chat input"
                />
                <button type="submit" disabled={isChatLoading || chatMessages.length === 0 || !chatInput.trim()} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-slate-400 disabled:cursor-not-allowed">
                    <SendIcon />
                </button>
            </form>
        </div>
    );
};

// --- Main App Component ---

function App() {
    const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.MarketAnalysis);
    const [stockSymbol, setStockSymbol] = useState<string>('AAPL');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [dailyData, setDailyData] = useState<StockData | null>(null);
    const [strategyParams, setStrategyParams] = useState<StrategyParameters>(defaultStrategyParams);
    
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    const [benchmarkResult, setBenchmarkResult] = useState<Benchmark | null>(null);
    const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>('daily');
    const [resampledData, setResampledData] = useState<StockData | null>(null);

    const [optimizationParams, setOptimizationParams] = useState(defaultOptimizationParams);
    const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);

    const handleLoadData = useCallback(async () => {
        if (!stockSymbol) {
            setError('Please enter a stock symbol.');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchDailyData(stockSymbol.toUpperCase());
            setDailyData(data);
            setCurrentStep(AppStep.StrategySetup);
        } catch (err) {
            setError((err as Error).message);
            setDailyData(null);
        } finally {
            setIsLoading(false);
        }
    }, [stockSymbol]);

    const handleRunBacktest = useCallback(async () => {
        if (!dailyData) {
            setError('Please load market data first.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setBacktestResult(null);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const dataForBacktest = resampleOHLC(dailyData, currentTimeframe);
        setResampledData(dataForBacktest);

        const indicators = calculateAllIndicators(dataForBacktest, strategyParams);
        const result = runBacktest(dataForBacktest, indicators, strategyParams, currentTimeframe);
        setBacktestResult(result);

        const { dates, c } = dataForBacktest;
        const years = (dates.length > 1) ? (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 24 * 3600 * 1000) : 0;
        const buyHoldTotalReturn = (c.length > 1) ? (c[c.length - 1] - c[0]) / c[0] : 0;
        const benchmarkCagr = years > 0 ? (Math.pow(1 + buyHoldTotalReturn, 1 / years) - 1) * 100 : 0;

        const benchmark: Benchmark = {
            equity: c.map(price => 10000 * (price / (c[0] || 1))),
            ret: buyHoldTotalReturn * 100,
            cagr: benchmarkCagr,
        };
        setBenchmarkResult(benchmark);
        setIsLoading(false);

    }, [dailyData, strategyParams, currentTimeframe]);

    const handleRunOptimization = useCallback(async () => {
        if (!dailyData) {
            setError('Please load market data first.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setOptimizationResult(null);

        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const p1Range = parseRangeSpec(optimizationParams.range1);
            const p2Range = parseRangeSpec(optimizationParams.range2);
            if(p1Range.length === 0) {
                throw new Error("Invalid range specification for Parameter 1.");
            }

            const { grid, best } = runOptimization(
                dailyData, 
                strategyParams, 
                optimizationParams.param1, p1Range, 
                optimizationParams.param2, p2Range, 
                optimizationParams.metric
            );
            
            setOptimizationResult({
                grid,
                xs: p1Range,
                ys: p2Range,
                best: best,
                param1: optimizationParams.param1,
                param2: optimizationParams.param2
            });

        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [dailyData, strategyParams, optimizationParams]);

    const indicators = useMemo(() => {
        const data = resampledData || dailyData;
        if (!data) return null;
        return calculateAllIndicators(data, strategyParams);
    }, [resampledData, dailyData, strategyParams]);

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 font-sans">
            <header className="text-center mb-8">
                <h1 className="text-4xl md:text-5xl font-extrabold text-slate-800 flex items-center justify-center gap-3">
                    <ChartLineIcon /> AI Trading Strategy Analyzer
                </h1>
                <p className="mt-2 text-slate-500 max-w-2xl mx-auto">
                    Backtest, optimize, and enhance your trading strategies with AI-powered insights.
                </p>
            </header>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}
            
            <main className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-200">
                <WorkflowStepper currentStep={currentStep} setStep={setCurrentStep} />
                
                {/* Step 1: Market Analysis */}
                {currentStep === AppStep.MarketAnalysis && (
                    <div className="animate-fade-in">
                        <h2 className="text-2xl font-bold text-slate-700 mb-4">Load Market Data</h2>
                        <form onSubmit={(e) => { e.preventDefault(); handleLoadData(); }} className="flex flex-col sm:flex-row gap-4">
                            <input
                                type="text"
                                value={stockSymbol}
                                onChange={(e) => setStockSymbol(e.target.value)}
                                placeholder="Enter stock symbol (e.g., AAPL)"
                                className="flex-grow p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                aria-label="Stock Symbol"
                            />
                            <button type="submit" disabled={isLoading} className="flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-slate-400">
                                <SearchIcon /> {isLoading ? 'Loading...' : 'Load Data'}
                            </button>
                        </form>
                         <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden h-[600px]">
                            <iframe 
                                key={stockSymbol}
                                title={`${stockSymbol} Market Overview Chart`}
                                id="stockChart"
                                className="w-full h-full"
                                src={`https://s.tradingview.com/widgetembed/?symbol=${stockSymbol.toUpperCase()}&interval=D&theme=light&style=1&hidesidetoolbar=1&symboledit=0`}
                            />
                        </div>
                    </div>
                )}

                {/* Step 2: Strategy Setup */}
                {currentStep === AppStep.StrategySetup && (
                     <div className="animate-fade-in">
                        <h2 className="text-2xl font-bold text-slate-700 mb-4">Configure Strategy Parameters</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                            {/* Parameter sections here */}
                            <div className="bg-slate-50 p-4 rounded-lg border">
                               <h3 className="font-bold mb-2 text-slate-600">Bollinger Bands</h3>
                               <label className="flex items-center gap-2"><input type="checkbox" checked={strategyParams.useBB} onChange={e => setStrategyParams(p => ({...p, useBB: e.target.checked}))} /> Use BB</label>
                               <label className="block mt-2 text-sm">Period: <input className="w-full p-1 border rounded" type="number" value={strategyParams.bbPeriod} onChange={e => setStrategyParams(p => ({...p, bbPeriod: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Std Dev: <input className="w-full p-1 border rounded" type="number" step="0.1" value={strategyParams.bbStd} onChange={e => setStrategyParams(p => ({...p, bbStd: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 p-4 rounded-lg border">
                               <h3 className="font-bold mb-2 text-slate-600">RSI</h3>
                               <label className="flex items-center gap-2"><input type="checkbox" checked={strategyParams.useRSI} onChange={e => setStrategyParams(p => ({...p, useRSI: e.target.checked}))} /> Use RSI</label>
                               <label className="block mt-2 text-sm">Period: <input className="w-full p-1 border rounded" type="number" value={strategyParams.rsiPeriod} onChange={e => setStrategyParams(p => ({...p, rsiPeriod: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Overbought: <input className="w-full p-1 border rounded" type="number" value={strategyParams.rsiOverbought} onChange={e => setStrategyParams(p => ({...p, rsiOverbought: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Oversold: <input className="w-full p-1 border rounded" type="number" value={strategyParams.rsiOversold} onChange={e => setStrategyParams(p => ({...p, rsiOversold: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 p-4 rounded-lg border">
                               <h3 className="font-bold mb-2 text-slate-600">MACD</h3>
                               <label className="flex items-center gap-2"><input type="checkbox" checked={strategyParams.useMACD} onChange={e => setStrategyParams(p => ({...p, useMACD: e.target.checked}))} /> Use MACD</label>
                               <label className="block mt-2 text-sm">Fast: <input className="w-full p-1 border rounded" type="number" value={strategyParams.macdFast} onChange={e => setStrategyParams(p => ({...p, macdFast: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Slow: <input className="w-full p-1 border rounded" type="number" value={strategyParams.macdSlow} onChange={e => setStrategyParams(p => ({...p, macdSlow: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Signal: <input className="w-full p-1 border rounded" type="number" value={strategyParams.macdSignal} onChange={e => setStrategyParams(p => ({...p, macdSignal: +e.target.value}))} /></label>
                           </div>
                           <div className="bg-slate-50 p-4 rounded-lg border">
                               <h3 className="font-bold mb-2 text-slate-600">Risk Management</h3>
                               <label className="block mt-2 text-sm">Risk/Trade (%): <input className="w-full p-1 border rounded" type="number" step="0.1" value={strategyParams.riskPct} onChange={e => setStrategyParams(p => ({...p, riskPct: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Stop Loss (ATR×): <input className="w-full p-1 border rounded" type="number" step="0.1" value={strategyParams.stopATR} onChange={e => setStrategyParams(p => ({...p, stopATR: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Slippage (bps): <input className="w-full p-1 border rounded" type="number" value={strategyParams.slipBps} onChange={e => setStrategyParams(p => ({...p, slipBps: +e.target.value}))} /></label>
                               <label className="block mt-2 text-sm">Commission ($): <input className="w-full p-1 border rounded" type="number" step="0.1" value={strategyParams.commission} onChange={e => setStrategyParams(p => ({...p, commission: +e.target.value}))} /></label>
                           </div>
                            <div className="bg-slate-50 p-4 rounded-lg border">
                               <h3 className="font-bold mb-2 text-slate-600">Filters & Exits</h3>
                               <label className="flex items-center gap-2"><input type="checkbox" checked={strategyParams.useTrendFilter} onChange={e => setStrategyParams(p => ({...p, useTrendFilter: e.target.checked}))} /> Use Trend Filter</label>
                               <label className="block mt-2 text-sm">Trend SMA Period: <input className="w-full p-1 border rounded" type="number" value={strategyParams.trendFilterPeriod} onChange={e => setStrategyParams(p => ({...p, trendFilterPeriod: +e.target.value}))} /></label>
                               
                               <label className="flex items-center gap-2 mt-4"><input type="checkbox" checked={strategyParams.useTakeProfit} onChange={e => setStrategyParams(p => ({...p, useTakeProfit: e.target.checked}))} /> Use Take Profit</label>
                               <label className="block mt-2 text-sm">Take Profit (ATR×): <input className="w-full p-1 border rounded" type="number" step="0.1" value={strategyParams.takeProfitATR} onChange={e => setStrategyParams(p => ({...p, takeProfitATR: +e.target.value}))} /></label>

                               <label className="flex items-center gap-2 mt-4"><input type="checkbox" checked={strategyParams.useMomentumEntry} onChange={e => setStrategyParams(p => ({...p, useMomentumEntry: e.target.checked}))} /> Use Momentum Entry</label>
                               <label className="block mt-2 text-sm">Momentum SMA Period: <input className="w-full p-1 border rounded" type="number" value={strategyParams.momentumSMAPeriod} onChange={e => setStrategyParams(p => ({...p, momentumSMAPeriod: +e.target.value}))} /></label>
                           </div>
                        </div>
                        <div className="mt-6 flex justify-end">
                             <button onClick={() => setCurrentStep(AppStep.Backtest)} className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition">
                                Proceed to Backtest &rarr;
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Step 3: Backtest */}
                {currentStep === AppStep.Backtest && (
                    <div className="animate-fade-in">
                        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                            <h2 className="text-2xl font-bold text-slate-700">Backtest & AI Analysis</h2>
                            <div className="flex items-center gap-4">
                                <TimeframeSelector selected={currentTimeframe} onSelect={setCurrentTimeframe} />
                                <button onClick={handleRunBacktest} disabled={isLoading} className="flex items-center justify-center gap-2 bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition disabled:bg-slate-400">
                                    <PlayIcon /> {isLoading ? 'Running...' : 'Run Backtest'}
                                </button>
                            </div>
                        </div>
                        {backtestResult && benchmarkResult && indicators && resampledData && (
                            <div className="mt-6 space-y-6">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <MetricCard label="Final Equity" value={`$${backtestResult.metrics.finalEquity.toFixed(2)}`} />
                                    <MetricCard label="Total Return" value={`${backtestResult.metrics.totalReturn.toFixed(2)}%`} colorClass={backtestResult.metrics.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'} />
                                    <MetricCard label="Buy & Hold Return" value={`${benchmarkResult.ret.toFixed(2)}%`} />
                                    <MetricCard label="Sharpe Ratio" value={backtestResult.metrics.sharpeRatio.toFixed(3)} />
                                    <MetricCard label="CAGR (Strategy)" value={`${backtestResult.metrics.cagr.toFixed(2)}%`} colorClass={backtestResult.metrics.cagr > benchmarkResult.cagr ? 'text-green-600' : 'text-red-600'} />
                                    <MetricCard label="CAGR (Buy & Hold)" value={`${benchmarkResult.cagr.toFixed(2)}%`} />
                                    <MetricCard label="Alpha (Annualized)" value={`${(backtestResult.metrics.cagr - benchmarkResult.cagr).toFixed(2)}%`} colorClass={(backtestResult.metrics.cagr - benchmarkResult.cagr) > 0 ? 'text-green-600' : 'text-red-600'}/>
                                    <MetricCard label="Max Drawdown" value={`${backtestResult.metrics.maxDrawdown.toFixed(2)}%`} colorClass="text-red-600" />
                                    <MetricCard label="Win Rate" value={`${backtestResult.metrics.winRate.toFixed(2)}%`} />
                                    <MetricCard label="Profit Factor" value={backtestResult.metrics.profitFactor === Infinity ? '∞' : backtestResult.metrics.profitFactor.toFixed(2)} />
                                    <MetricCard label="# Trades" value={backtestResult.metrics.numTrades} />
                                    <MetricCard label="Exposure" value={`${backtestResult.metrics.timeInMarketPct.toFixed(1)}%`} />
                                    <MetricCard label="Sortino Ratio" value={backtestResult.metrics.sortinoRatio.toFixed(3)} />
                                    <MetricCard label="Calmar Ratio" value={backtestResult.metrics.calmarRatio === Infinity ? '∞' : backtestResult.metrics.calmarRatio.toFixed(3)} />
                                    <MetricCard label="Avg Win / Loss" value={`${backtestResult.metrics.avgWin.toFixed(2)}% / ${backtestResult.metrics.avgLoss.toFixed(2)}%`} />
                                    <MetricCard label="Max Loss Streak" value={backtestResult.metrics.maxConsecLosses} />
                                </div>


                                <div className="flex justify-end items-center gap-3">
                                    <h3 className="text-sm font-semibold text-slate-600">Export Results:</h3>
                                    <button onClick={() => exportTradesCSV(backtestResult, stockSymbol)} className="flex items-center gap-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-lg transition"><DownloadIcon /> Trades</button>
                                    <button onClick={() => exportSummaryCSV(backtestResult, benchmarkResult, strategyParams, stockSymbol, currentTimeframe)} className="flex items-center gap-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-lg transition"><DownloadIcon /> Summary</button>
                                </div>
                                
                                <PriceAndIndicatorCharts stockData={resampledData} indicators={indicators} backtestResult={backtestResult} />

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <SignalList signals={backtestResult.signals} />
                                    <div className="bg-slate-50 p-4 sm:p-6 rounded-xl border border-slate-200">
                                        <h3 className="text-xl font-bold text-slate-700 mb-4 flex items-center gap-3"><BrainCircuitIcon /> Gemini AI Analysis Chat</h3>
                                         <GeminiChat 
                                            backtestResult={backtestResult}
                                            benchmarkResult={benchmarkResult}
                                            strategyParams={strategyParams}
                                            onReset={handleRunBacktest}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Step 4: Optimization */}
                {currentStep === AppStep.Optimization && (
                    <div className="animate-fade-in">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-slate-700">Strategy Optimization</h2>
                             <button onClick={handleRunOptimization} disabled={isLoading} className="flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-purple-700 transition disabled:bg-slate-400">
                                <CogsIcon /> {isLoading ? 'Optimizing...' : 'Run Optimization'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 bg-slate-50 p-4 rounded-lg border space-y-4">
                                <div>
                                    <label htmlFor="param1-select" className="font-semibold text-slate-600">Parameter 1</label>
                                    <select id="param1-select" value={optimizationParams.param1} onChange={e => setOptimizationParams(p => ({...p, param1: e.target.value}))} className="w-full p-2 border rounded mt-1">
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
                                        </optgroup>
                                    </select>
                                    <input type="text" value={optimizationParams.range1} onChange={e => setOptimizationParams(p => ({...p, range1: e.target.value}))} placeholder="min-max:step" className="w-full p-2 border rounded mt-1" aria-label="Parameter 1 Range" />
                                </div>
                                <div>
                                    <label htmlFor="param2-select" className="font-semibold text-slate-600">Parameter 2</label>
                                    <select id="param2-select" value={optimizationParams.param2} onChange={e => setOptimizationParams(p => ({...p, param2: e.target.value}))} className="w-full p-2 border rounded mt-1">
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
                                        </optgroup>
                                    </select>
                                    <input type="text" value={optimizationParams.range2} onChange={e => setOptimizationParams(p => ({...p, range2: e.target.value}))} placeholder="min-max:step" className="w-full p-2 border rounded mt-1" aria-label="Parameter 2 Range" />
                                </div>
                                <div>
                                    <label htmlFor="metric-select" className="font-semibold text-slate-600">Optimize For</label>
                                    <select id="metric-select" value={optimizationParams.metric} onChange={e => setOptimizationParams(p => ({...p, metric: e.target.value}))} className="w-full p-2 border rounded mt-1">
                                        <option value="sharpe">Sharpe Ratio</option>
                                        <option value="cagr">CAGR</option>
                                        <option value="alpha_cagr">Alpha vs B&H (CAGR)</option>
                                        <option value="win_rate">Win Rate</option>
                                        <option value="max_drawdown">Max Drawdown (Min)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="lg:col-span-2 space-y-4">
                                {optimizationResult?.best && (
                                    <div className="bg-slate-50 p-4 rounded-lg border">
                                        <h3 className="font-bold text-slate-600 mb-2">Best Parameters Found</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                                            <MetricCard label="Best Score" value={optimizationResult.best.score.toFixed(3)} colorClass="text-purple-600" />
                                            <MetricCard label="Sharpe" value={optimizationResult.best.bt.metrics.sharpeRatio.toFixed(3)} />
                                            <MetricCard label="CAGR" value={`${optimizationResult.best.bt.metrics.cagr.toFixed(2)}%`} />
                                            <MetricCard label="Max DD" value={`${optimizationResult.best.bt.metrics.maxDrawdown.toFixed(2)}%`} colorClass="text-red-600" />
                                        </div>
                                    </div>
                                )}
                                <div className="bg-white p-2 rounded-xl shadow-md border border-slate-200 h-[400px]">
                                    <h3 className="text-center font-semibold text-slate-700 mb-2">Optimization Heatmap</h3>
                                    {optimizationResult ? (
                                        <HeatmapChart optimizationResult={optimizationResult} />
                                    ): (
                                        <div className="flex items-center justify-center h-full text-slate-400">Run optimization to see heatmap.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;