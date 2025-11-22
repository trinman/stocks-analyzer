import React, { useState, useCallback, useMemo, ReactNode, useRef, useEffect } from 'react';
import { AppStep, BacktestResult, Benchmark, Indicators, OptimizationResult, StockData, StrategyParameters, Timeframe, Signal } from './types.ts';
import { calculateAllIndicators, runBacktest, runOptimization } from './services/tradingService.ts';
import { fetchDailyData, resampleOHLC } from './services/apiServices.ts';
import { getInitialAnalysis, createChatSession, getAnalysisPrompt } from './services/geminiService.ts';
import { BrainCircuitIcon, ChartLineIcon, CogsIcon, DownloadIcon, PlayIcon, SearchIcon, SendIcon, SlidersIcon, ShieldIcon, FilterIcon } from './components/Icons.tsx';
import { PriceAndIndicatorCharts, HeatmapChart } from './components/Charts.tsx';
import { parseRangeSpec } from './utils.ts';
import { exportTradesCSV, exportSummaryCSV } from './services/exportService.ts';
import { Chat } from '@google/genai';


// Default state for strategy parameters
const defaultStrategyParams: StrategyParameters = {
    useBB: true, useRSI: true, useMACD: true,
    bbPeriod: 20, bbStd: 2,
    rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    riskPct: 1, stopATR: 2, commission: 0, slipBps: 5,
    useTrendFilter: true,
    trendFilterPeriod: 200,
    useTakeProfit: true,
    takeProfitATR: 3.0,
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

// --- Reusable UI Components ---

const WorkflowStepper: React.FC<{ currentStep: AppStep; setStep: (step: AppStep) => void }> = ({ currentStep, setStep }) => {
    const steps = [
        { id: AppStep.MarketAnalysis, label: 'Market Data' },
        { id: AppStep.StrategySetup, label: 'Strategy' },
        { id: AppStep.Backtest, label: 'Results & AI' },
        { id: AppStep.Optimization, label: 'Optimize' },
    ];
    
    const progressPercentage = ((currentStep - 1) / (steps.length - 1)) * 100;

    return (
        <div className="mb-10">
             {/* Mobile/Compact view */}
             <div className="flex justify-between text-xs font-medium text-slate-500 mb-2 md:hidden">
                 <span>Step {currentStep} of 4</span>
                 <span>{steps.find(s => s.id === currentStep)?.label}</span>
             </div>
             
             {/* Desktop View */}
            <div className="relative w-full h-2 bg-slate-100 rounded-full mb-6 hidden md:block">
                <div 
                    className="absolute top-0 left-0 h-full bg-indigo-600 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                ></div>
                {steps.map((step) => {
                    const isActive = currentStep >= step.id;
                    const isCurrent = currentStep === step.id;
                    // Calculate position based on index
                    const position = ((step.id - 1) / (steps.length - 1)) * 100;
                    
                    return (
                        <div 
                            key={step.id} 
                            className="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 flex flex-col items-center cursor-pointer group"
                            style={{ left: `${position}%` }}
                            onClick={() => currentStep > step.id || (step.id === AppStep.MarketAnalysis) ? setStep(step.id) : null}
                        >
                            <div className={`w-4 h-4 rounded-full border-2 transition-all duration-300 
                                ${isActive ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300 group-hover:border-indigo-400'}
                                ${isCurrent ? 'ring-4 ring-indigo-100' : ''}
                            `}></div>
                            <span className={`mt-3 text-xs font-semibold uppercase tracking-wide transition-colors duration-300 
                                ${isActive ? 'text-indigo-900' : 'text-slate-400'}`}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const MetricCard: React.FC<{ label: string; value: string | number; subValue?: string; type?: 'neutral' | 'good' | 'bad' | 'info' }> = ({ label, value, subValue, type = 'neutral' }) => {
    const colorStyles = {
        neutral: 'text-slate-900',
        good: 'text-emerald-600',
        bad: 'text-rose-600',
        info: 'text-blue-600'
    };

    return (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
            <div>
                <div className={`text-2xl font-bold tracking-tight ${colorStyles[type]}`}>{value}</div>
                {subValue && <div className="text-xs text-slate-400 mt-1">{subValue}</div>}
            </div>
        </div>
    );
};

const TimeframeSelector: React.FC<{ selected: Timeframe, onSelect: (tf: Timeframe) => void }> = ({ selected, onSelect }) => {
    const timeframes: Timeframe[] = ['daily', 'weekly', 'monthly'];
    return (
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            {timeframes.map(tf => (
                <button
                    key={tf}
                    onClick={() => onSelect(tf)}
                    className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all capitalize
                        ${selected === tf ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
};

const SignalList: React.FC<{ signals: Signal[] }> = ({ signals }) => {
    if (signals.length === 0) return <div className="text-slate-400 text-sm text-center py-8">No trade signals generated.</div>;

    // Show last 20 signals max
    const displaySignals = [...signals].reverse().slice(0, 20);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-700">Recent Signals</h3>
                <span className="text-xs font-medium bg-slate-200 text-slate-600 px-2 py-1 rounded-full">{signals.length} Total</span>
            </div>
            <div className="overflow-y-auto flex-grow p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0 text-slate-500 font-medium text-xs uppercase">
                        <tr>
                            <th className="px-4 py-3 font-semibold">Type</th>
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold text-right">Price</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {displaySignals.map((s, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border
                                        ${s.type === 'buy' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                        {s.type.toUpperCase()}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{s.date}</td>
                                <td className="px-4 py-3 text-right text-slate-900 font-mono">${s.price.toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Gemini Chat Component ---

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
    const chatHistoryRef = useRef<HTMLDivElement>(null);

     useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatMessages, isChatLoading]);
    
    useEffect(() => {
        setChatMessages([]);
        setChatSession(null);
        setIsChatLoading(false);
        setChatInput('');
    }, [backtestResult]);

    const handleGetAIAnalysis = async () => {
        setIsChatLoading(true);
        try {
            const prompt = getAnalysisPrompt(backtestResult.metrics, strategyParams, benchmarkResult);
            setInitialAiPrompt(prompt);
            const initialResponse = await getInitialAnalysis(backtestResult.metrics, strategyParams, benchmarkResult);
            setChatSession(null);
            setChatMessages([{ role: 'model', content: initialResponse }]);
        } catch (e) {
            setChatMessages([{ role: 'model', content: `Error: ${(e as Error).message}` }]);
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
            if (!session) throw new Error("Chat session init failed.");
            const responseStream = await session.sendMessageStream({ message: currentChatInput });
            for await (const chunk of responseStream) {
                setChatMessages(prev => {
                    const lastIndex = prev.length - 1;
                    const lastMessage = prev[lastIndex];
                    if (lastMessage.role === 'model') {
                        const updatedMessages = [...prev];
                        updatedMessages[lastIndex] = { ...lastMessage, content: lastMessage.content + chunk.text };
                        return updatedMessages;
                    }
                    return prev;
                });
            }
        } catch (err) {
             setChatMessages(prev => [...prev, { role: 'model' as const, content: "Sorry, I encountered an error." }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[600px] bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-indigo-600 p-4 flex items-center justify-between text-white">
                 <div className="flex items-center gap-2 font-semibold">
                    <BrainCircuitIcon /> <span>Strategy Analyst</span>
                 </div>
                 <span className="text-xs bg-indigo-500 px-2 py-1 rounded text-indigo-100">Gemini 2.5 Flash</span>
            </div>

            {chatMessages.length === 0 && !isChatLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
                    <div className="w-16 h-16 bg-white rounded-full shadow-md flex items-center justify-center text-indigo-600 mb-4">
                        <BrainCircuitIcon />
                    </div>
                    <h4 className="text-lg font-bold text-slate-800 mb-2">AI-Powered Insights</h4>
                    <p className="text-slate-500 max-w-sm text-sm mb-6">
                        Get a professional quantitative analysis of your strategy's strengths, weaknesses, and improvement opportunities.
                    </p>
                    <button
                        onClick={handleGetAIAnalysis}
                        className="flex items-center gap-2 bg-indigo-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-indigo-700 transition shadow-lg shadow-indigo-200"
                    >
                        <BrainCircuitIcon /> Analyze Results
                    </button>
                </div>
            ) : (
                <>
                    <div ref={chatHistoryRef} className="flex-1 p-4 space-y-4 overflow-y-auto bg-slate-50">
                        {chatMessages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] p-3.5 rounded-2xl text-sm shadow-sm 
                                    ${msg.role === 'user' 
                                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                                        : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'}`}>
                                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:text-current prose-strong:text-current" 
                                         dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/(\r\n|\n|\r)/g, "<br />").replace(/• /g, "<br/>• ") }} />
                                </div>
                            </div>
                        ))}
                        {isChatLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-200 shadow-sm flex gap-2 items-center">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                                </div>
                            </div>
                        )}
                    </div>
                    <form onSubmit={handleSendChatMessage} className="p-4 bg-white border-t border-slate-200 flex gap-2">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Ask about drawdowns, alpha, or improvements..."
                            className="flex-grow bg-slate-100 text-sm text-slate-800 p-3 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition"
                            disabled={isChatLoading}
                        />
                        <button type="submit" disabled={!chatInput.trim() || isChatLoading} className="p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                            <SendIcon />
                        </button>
                    </form>
                </>
            )}
        </div>
    );
};

// --- Main App Component ---

function App() {
    const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.MarketAnalysis);
    const [stockSymbol, setStockSymbol] = useState<string>('');
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

    // Tabs for Strategy Setup
    const [strategyTab, setStrategyTab] = useState<'indicators' | 'risk' | 'filters'>('indicators');

    const handleLoadData = useCallback(async (symbol: string) => {
        if (!symbol) {
            setError('Please enter a stock symbol.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setStockSymbol(symbol.toUpperCase());
        try {
            const data = await fetchDailyData(symbol.toUpperCase());
            setDailyData(data);
            setCurrentStep(AppStep.StrategySetup);
        } catch (err) {
            setError((err as Error).message);
            setDailyData(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleRunBacktest = useCallback(async () => {
        if (!dailyData) return;
        setIsLoading(true);
        setError(null);
        setBacktestResult(null);
        
        // Allow UI render cycle to show loading state
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const dataForBacktest = resampleOHLC(dailyData, currentTimeframe);
        setResampledData(dataForBacktest);

        const indicators = calculateAllIndicators(dataForBacktest, strategyParams);
        const result = runBacktest(dataForBacktest, indicators, strategyParams, currentTimeframe);
        setBacktestResult(result);

        const { c } = dataForBacktest;
        // Approximation for benchmark (Buy & Hold)
        const startPrice = c[0];
        const endPrice = c[c.length-1];
        const ret = (endPrice - startPrice) / startPrice;
        
        // Annualize for CAGR
        const years = (dataForBacktest.dates.length) / (currentTimeframe === 'daily' ? 252 : currentTimeframe === 'weekly' ? 52 : 12);
        const cagr = years > 0 ? (Math.pow(1 + ret, 1/years) - 1) * 100 : 0;

        const benchmark: Benchmark = {
            equity: c.map(price => 10000 * (price / startPrice)),
            ret: ret * 100,
            cagr: cagr,
        };
        setBenchmarkResult(benchmark);
        setIsLoading(false);

    }, [dailyData, strategyParams, currentTimeframe]);

    const handleRunOptimization = useCallback(async () => {
        if (!dailyData) return;
        setIsLoading(true);
        setError(null);
        setOptimizationResult(null);

        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const p1Range = parseRangeSpec(optimizationParams.range1);
            const p2Range = parseRangeSpec(optimizationParams.range2);
            if(p1Range.length === 0) throw new Error("Invalid range spec for Param 1.");

            const { grid, best } = runOptimization(
                dailyData, strategyParams, 
                optimizationParams.param1, p1Range, 
                optimizationParams.param2, p2Range, 
                optimizationParams.metric
            );
            
            setOptimizationResult({
                grid, xs: p1Range, ys: p2Range, best,
                param1: optimizationParams.param1, param2: optimizationParams.param2
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
        <div className="min-h-screen bg-slate-50 font-sans pb-12">
            {/* Navigation Bar */}
            <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
                <div className="container mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentStep(AppStep.MarketAnalysis)}>
                        <div className="bg-indigo-600 p-2 rounded-lg text-white">
                             <ChartLineIcon />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-800 leading-none">QuantAI</h1>
                            <span className="text-xs text-slate-500 font-medium">Strategy Analyzer</span>
                        </div>
                    </div>
                    {stockSymbol && (
                        <div className="hidden md:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full text-sm font-semibold text-slate-700">
                            <span className="text-slate-400">Active:</span> {stockSymbol}
                        </div>
                    )}
                </div>
            </nav>

            <div className="container mx-auto px-4 sm:px-6 mt-8 max-w-7xl">
                <WorkflowStepper currentStep={currentStep} setStep={setCurrentStep} />
                
                {error && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl mb-6 flex items-start gap-3 shadow-sm">
                        <div className="mt-0.5 font-bold text-lg">!</div>
                        <div>
                            <strong className="font-semibold block">Error</strong>
                            <span className="text-sm">{error}</span>
                        </div>
                    </div>
                )}
                
                {/* Step 1: Market Analysis */}
                {currentStep === AppStep.MarketAnalysis && (
                    <div className="max-w-4xl mx-auto animate-fade-in">
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-bold text-slate-800 mb-2">Market Data Analysis</h2>
                            <p className="text-slate-500">Load historical price data to begin your strategy research.</p>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-100">
                            <form onSubmit={(e) => { e.preventDefault(); handleLoadData(stockSymbol); }} className="flex flex-col md:flex-row gap-4 mb-6">
                                <div className="flex-grow relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <SearchIcon />
                                    </div>
                                    <input
                                        type="text"
                                        value={stockSymbol}
                                        onChange={(e) => setStockSymbol(e.target.value.toUpperCase())}
                                        placeholder="Search Ticker (e.g. NVDA)"
                                        className="w-full pl-10 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition font-medium text-lg"
                                    />
                                </div>
                                <button type="submit" disabled={isLoading} className="md:w-40 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                                    {isLoading ? <span className="animate-pulse">Loading...</span> : 'Load Data'}
                                </button>
                            </form>

                            <div className="flex flex-wrap gap-2 items-center justify-center">
                                <span className="text-sm text-slate-400 mr-1">Popular:</span>
                                {['AAPL', 'TSLA', 'SPY', 'AMD', 'GOOGL'].map(sym => (
                                    <button 
                                        key={sym} 
                                        onClick={() => handleLoadData(sym)}
                                        className="px-3 py-1 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 rounded-full text-sm font-medium transition-colors"
                                    >
                                        {sym}
                                    </button>
                                ))}
                            </div>
                        </div>
                        
                        {dailyData && (
                             <div className="mt-8 border border-slate-200 rounded-2xl overflow-hidden h-[500px] shadow-lg">
                                <iframe 
                                    key={stockSymbol}
                                    title="Chart"
                                    className="w-full h-full"
                                    src={`https://s.tradingview.com/widgetembed/?symbol=${stockSymbol}&interval=D&theme=light&style=1&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=[]&hideideas=1&theme=light&style=1&timezone=Etc%2FUTC&withdateranges=1&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=en&utm_source=localhost&utm_medium=widget&utm_campaign=chart&utm_term=${stockSymbol}`}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Step 2: Strategy Setup */}
                {currentStep === AppStep.StrategySetup && (
                     <div className="max-w-5xl mx-auto animate-fade-in">
                        <div className="flex flex-col md:flex-row justify-between items-center mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-800">Configure Strategy</h2>
                                <p className="text-slate-500 text-sm">Define entry/exit logic and risk parameters.</p>
                            </div>
                             <button onClick={() => setCurrentStep(AppStep.Backtest)} className="mt-4 md:mt-0 bg-indigo-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 flex items-center gap-2">
                                Run Backtest <PlayIcon />
                            </button>
                        </div>

                        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                            <div className="flex border-b border-slate-200">
                                <button onClick={() => setStrategyTab('indicators')} className={`flex-1 py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${strategyTab === 'indicators' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <SlidersIcon /> Technical Indicators
                                </button>
                                <button onClick={() => setStrategyTab('risk')} className={`flex-1 py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${strategyTab === 'risk' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <ShieldIcon /> Risk Management
                                </button>
                                <button onClick={() => setStrategyTab('filters')} className={`flex-1 py-4 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${strategyTab === 'filters' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <FilterIcon /> Entry/Exit Filters
                                </button>
                            </div>

                            <div className="p-8">
                                {strategyTab === 'indicators' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="font-bold text-slate-700">Bollinger Bands</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useBB} onChange={e => setStrategyParams(p => ({...p, useBB: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <div className={!strategyParams.useBB ? 'opacity-50 pointer-events-none' : ''}>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <label className="text-sm text-slate-600">Length
                                                        <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.bbPeriod} onChange={e => setStrategyParams(p => ({...p, bbPeriod: +e.target.value}))} />
                                                    </label>
                                                    <label className="text-sm text-slate-600">Std Dev
                                                        <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" step="0.1" value={strategyParams.bbStd} onChange={e => setStrategyParams(p => ({...p, bbStd: +e.target.value}))} />
                                                    </label>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="font-bold text-slate-700">RSI (Relative Strength)</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useRSI} onChange={e => setStrategyParams(p => ({...p, useRSI: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <div className={!strategyParams.useRSI ? 'opacity-50 pointer-events-none' : ''}>
                                                <label className="block text-sm text-slate-600 mb-2">Period
                                                    <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.rsiPeriod} onChange={e => setStrategyParams(p => ({...p, rsiPeriod: +e.target.value}))} />
                                                </label>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <label className="text-sm text-slate-600">Overbought
                                                        <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.rsiOverbought} onChange={e => setStrategyParams(p => ({...p, rsiOverbought: +e.target.value}))} />
                                                    </label>
                                                    <label className="text-sm text-slate-600">Oversold
                                                        <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.rsiOversold} onChange={e => setStrategyParams(p => ({...p, rsiOversold: +e.target.value}))} />
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="md:col-span-2 pt-6 border-t border-slate-100">
                                             <div className="flex items-center justify-between mb-4">
                                                <h3 className="font-bold text-slate-700">MACD (Moving Average Convergence Divergence)</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useMACD} onChange={e => setStrategyParams(p => ({...p, useMACD: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <div className={`grid grid-cols-3 gap-4 ${!strategyParams.useMACD ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <label className="text-sm text-slate-600">Fast Length
                                                    <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.macdFast} onChange={e => setStrategyParams(p => ({...p, macdFast: +e.target.value}))} />
                                                </label>
                                                <label className="text-sm text-slate-600">Slow Length
                                                    <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.macdSlow} onChange={e => setStrategyParams(p => ({...p, macdSlow: +e.target.value}))} />
                                                </label>
                                                <label className="text-sm text-slate-600">Signal Smoothing
                                                    <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.macdSignal} onChange={e => setStrategyParams(p => ({...p, macdSignal: +e.target.value}))} />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {strategyTab === 'risk' && (
                                    <div className="max-w-2xl mx-auto space-y-6">
                                        <div className="grid grid-cols-2 gap-6">
                                             <label className="block text-sm font-semibold text-slate-700">Risk Per Trade (% Equity)
                                                <div className="relative mt-1">
                                                    <input className="w-full p-3 border border-slate-300 rounded-lg pl-3" type="number" step="0.1" value={strategyParams.riskPct} onChange={e => setStrategyParams(p => ({...p, riskPct: +e.target.value}))} />
                                                    <span className="absolute right-3 top-3 text-slate-400">%</span>
                                                </div>
                                            </label>
                                            <label className="block text-sm font-semibold text-slate-700">Stop Loss (ATR Multiple)
                                                <div className="relative mt-1">
                                                    <input className="w-full p-3 border border-slate-300 rounded-lg" type="number" step="0.1" value={strategyParams.stopATR} onChange={e => setStrategyParams(p => ({...p, stopATR: +e.target.value}))} />
                                                    <span className="absolute right-3 top-3 text-slate-400 text-xs mt-0.5">x ATR</span>
                                                </div>
                                            </label>
                                        </div>
                                        
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="font-bold text-slate-700">Take Profit Target</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useTakeProfit} onChange={e => setStrategyParams(p => ({...p, useTakeProfit: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <label className={`block text-sm text-slate-600 ${!strategyParams.useTakeProfit ? 'opacity-50' : ''}`}>Target Distance (ATR Multiple)
                                                <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg bg-white" type="number" step="0.1" value={strategyParams.takeProfitATR} onChange={e => setStrategyParams(p => ({...p, takeProfitATR: +e.target.value}))} disabled={!strategyParams.useTakeProfit}/>
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-2 gap-6 pt-4 border-t">
                                            <label className="block text-sm text-slate-600">Commission per Trade ($)
                                                <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" step="0.1" value={strategyParams.commission} onChange={e => setStrategyParams(p => ({...p, commission: +e.target.value}))} />
                                            </label>
                                            <label className="block text-sm text-slate-600">Slippage (Basis Points)
                                                <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.slipBps} onChange={e => setStrategyParams(p => ({...p, slipBps: +e.target.value}))} />
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {strategyTab === 'filters' && (
                                    <div className="max-w-2xl mx-auto space-y-8">
                                         <div className="p-5 border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors">
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="font-bold text-slate-800 text-lg">Trend Filter</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useTrendFilter} onChange={e => setStrategyParams(p => ({...p, useTrendFilter: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <p className="text-sm text-slate-500 mb-4">Only take long positions if price is above the long-term Moving Average.</p>
                                            <label className={`block text-sm font-semibold text-slate-700 ${!strategyParams.useTrendFilter ? 'opacity-50' : ''}`}>SMA Period
                                                <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.trendFilterPeriod} onChange={e => setStrategyParams(p => ({...p, trendFilterPeriod: +e.target.value}))} disabled={!strategyParams.useTrendFilter}/>
                                            </label>
                                        </div>

                                        <div className="p-5 border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors">
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="font-bold text-slate-800 text-lg">Momentum Entry</h3>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={strategyParams.useMomentumEntry} onChange={e => setStrategyParams(p => ({...p, useMomentumEntry: e.target.checked}))} />
                                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                </label>
                                            </div>
                                            <p className="text-sm text-slate-500 mb-4">Enter when price crosses above a short-term SMA with strong RSI.</p>
                                            <label className={`block text-sm font-semibold text-slate-700 ${!strategyParams.useMomentumEntry ? 'opacity-50' : ''}`}>SMA Period
                                                <input className="w-full mt-1 p-2 border border-slate-300 rounded-lg" type="number" value={strategyParams.momentumSMAPeriod} onChange={e => setStrategyParams(p => ({...p, momentumSMAPeriod: +e.target.value}))} disabled={!strategyParams.useMomentumEntry}/>
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Step 3: Backtest Results */}
                {currentStep === AppStep.Backtest && backtestResult && benchmarkResult && (
                    <div className="animate-fade-in space-y-6">
                        {/* Header Actions */}
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">Backtest Results</h2>
                                <p className="text-sm text-slate-500">{stockSymbol} • {backtestResult.trades.length} Trades</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <TimeframeSelector selected={currentTimeframe} onSelect={setCurrentTimeframe} />
                                <button onClick={handleRunBacktest} disabled={isLoading} className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition">
                                    <PlayIcon />
                                </button>
                                <div className="h-6 w-px bg-slate-300 mx-1"></div>
                                <button onClick={() => exportTradesCSV(backtestResult, stockSymbol)} className="text-slate-500 hover:text-indigo-600 transition" title="Export Trades">
                                    <DownloadIcon />
                                </button>
                            </div>
                        </div>

                        {/* Hero Metrics */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <MetricCard 
                                label="Net Profit" 
                                value={`${backtestResult.metrics.totalReturn > 0 ? '+' : ''}${backtestResult.metrics.totalReturn.toFixed(2)}%`} 
                                type={backtestResult.metrics.totalReturn > 0 ? 'good' : 'bad'}
                                subValue={`$${(backtestResult.metrics.finalEquity - 10000).toFixed(2)}`}
                            />
                            <MetricCard 
                                label="Sharpe Ratio" 
                                value={backtestResult.metrics.sharpeRatio.toFixed(2)} 
                                type={backtestResult.metrics.sharpeRatio > 1 ? 'good' : backtestResult.metrics.sharpeRatio > 0 ? 'neutral' : 'bad'}
                                subValue="Risk-Adjusted Return"
                            />
                             <MetricCard 
                                label="Win Rate" 
                                value={`${backtestResult.metrics.winRate.toFixed(1)}%`} 
                                type={backtestResult.metrics.winRate > 50 ? 'good' : 'neutral'}
                                subValue={`${backtestResult.metrics.profitFactor.toFixed(2)} Profit Factor`}
                            />
                            <MetricCard 
                                label="Max Drawdown" 
                                value={`-${backtestResult.metrics.maxDrawdown.toFixed(2)}%`} 
                                type="bad"
                                subValue="Peak to Valley"
                            />
                        </div>

                        {/* Main Chart Area */}
                        {resampledData && indicators && (
                            <PriceAndIndicatorCharts stockData={resampledData} indicators={indicators} backtestResult={backtestResult} />
                        )}

                        {/* Detailed Stats & Analysis Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-[600px]">
                             {/* Column 1: Stats */}
                            <div className="lg:col-span-1 flex flex-col gap-4 h-full">
                                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-grow">
                                    <h3 className="font-bold text-slate-700 mb-4">Performance Statistics</h3>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Total Trades</span>
                                            <span className="font-mono font-semibold">{backtestResult.metrics.numTrades}</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">CAGR (Strategy)</span>
                                            <span className={`font-mono font-semibold ${backtestResult.metrics.cagr > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{backtestResult.metrics.cagr.toFixed(2)}%</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">CAGR (Buy & Hold)</span>
                                            <span className="font-mono font-semibold">{benchmarkResult.cagr.toFixed(2)}%</span>
                                        </div>
                                         <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Alpha (Annualized)</span>
                                            <span className={`font-mono font-semibold ${backtestResult.metrics.cagr > benchmarkResult.cagr ? 'text-emerald-600' : 'text-rose-600'}`}>{((backtestResult.metrics.cagr - benchmarkResult.cagr)).toFixed(2)}%</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Avg Win</span>
                                            <span className="font-mono text-emerald-600">+{backtestResult.metrics.avgWin.toFixed(2)}%</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Avg Loss</span>
                                            <span className="font-mono text-rose-600">-{backtestResult.metrics.avgLoss.toFixed(2)}%</span>
                                        </div>
                                         <div className="flex justify-between py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Market Exposure</span>
                                            <span className="font-mono font-semibold">{backtestResult.metrics.timeInMarketPct.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="h-1/3 min-h-[200px]">
                                     <SignalList signals={backtestResult.signals} />
                                </div>
                            </div>
                            
                            {/* Column 2 & 3: Chat */}
                            <div className="lg:col-span-2 h-full">
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
                
                {/* Step 4: Optimization */}
                {currentStep === AppStep.Optimization && (
                    <div className="max-w-5xl mx-auto animate-fade-in">
                         <div className="flex flex-col sm:flex-row justify-between items-center mb-6">
                             <div>
                                <h2 className="text-2xl font-bold text-slate-800">Walk-Forward Optimization</h2>
                                <p className="text-sm text-slate-500">Find the optimal parameters to maximize Sharpe Ratio or Returns.</p>
                            </div>
                             <button onClick={handleRunOptimization} disabled={isLoading} className="mt-4 sm:mt-0 bg-purple-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-purple-700 transition disabled:bg-slate-400 flex items-center gap-2 shadow-lg shadow-purple-200">
                                <CogsIcon /> {isLoading ? 'Optimizing...' : 'Run Optimization'}
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Configuration Panel */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
                                <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">Search Grid Config</h3>
                                
                                <div className="space-y-5">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">Parameter X (Horizontal)</label>
                                        <select value={optimizationParams.param1} onChange={e => setOptimizationParams(p => ({...p, param1: e.target.value}))} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-purple-500 outline-none">
                                            <optgroup label="Bollinger Bands">
                                                <option value="bb_period">BB Period</option>
                                                <option value="bb_std">BB Std Dev</option>
                                            </optgroup>
                                            <optgroup label="RSI">
                                                <option value="rsi_period">RSI Period</option>
                                                <option value="rsi_overbought">RSI Overbought</option>
                                                <option value="rsi_oversold">RSI Oversold</option>
                                            </optgroup>
                                             <optgroup label="Risk">
                                                <option value="stop_loss_atr">Stop-Loss ATR</option>
                                                <option value="risk_per_trade">Risk %</option>
                                            </optgroup>
                                        </select>
                                        <input type="text" value={optimizationParams.range1} onChange={e => setOptimizationParams(p => ({...p, range1: e.target.value}))} placeholder="start-end:step" className="w-full p-2 text-sm border border-slate-300 rounded-lg" />
                                        <p className="text-[10px] text-slate-400 mt-1">Ex: 10-30:2 (Tests 10, 12, 14... 30)</p>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">Parameter Y (Vertical)</label>
                                        <select value={optimizationParams.param2} onChange={e => setOptimizationParams(p => ({...p, param2: e.target.value}))} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-purple-500 outline-none">
                                            <option value="select">-- None (Single Param) --</option>
                                            <optgroup label="Risk">
                                                <option value="stop_loss_atr">Stop-Loss ATR</option>
                                                <option value="risk_per_trade">Risk %</option>
                                            </optgroup>
                                            <optgroup label="RSI">
                                                <option value="rsi_period">RSI Period</option>
                                            </optgroup>
                                        </select>
                                        <input type="text" value={optimizationParams.range2} onChange={e => setOptimizationParams(p => ({...p, range2: e.target.value}))} placeholder="start-end:step" className="w-full p-2 text-sm border border-slate-300 rounded-lg" disabled={optimizationParams.param2 === 'select'}/>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">Objective Function</label>
                                        <select value={optimizationParams.metric} onChange={e => setOptimizationParams(p => ({...p, metric: e.target.value}))} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                                            <option value="sharpe">Maximize Sharpe Ratio</option>
                                            <option value="cagr">Maximize CAGR</option>
                                            <option value="win_rate">Maximize Win Rate</option>
                                            <option value="max_drawdown">Minimize Drawdown</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Results Panel */}
                            <div className="lg:col-span-2 space-y-6">
                                {optimizationResult?.best ? (
                                    <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex flex-wrap justify-between items-center gap-4">
                                        <div>
                                            <h4 className="font-bold text-emerald-800">Optimization Complete</h4>
                                            <p className="text-sm text-emerald-600">Best Result: {optimizationResult.best.score.toFixed(3)} ({optimizationParams.metric})</p>
                                        </div>
                                        <div className="flex gap-4 text-center">
                                             <div>
                                                 <div className="text-xs text-emerald-600 font-semibold">Sharpe</div>
                                                 <div className="font-mono text-emerald-900">{optimizationResult.best.bt.metrics.sharpeRatio.toFixed(2)}</div>
                                             </div>
                                             <div>
                                                 <div className="text-xs text-emerald-600 font-semibold">CAGR</div>
                                                 <div className="font-mono text-emerald-900">{optimizationResult.best.bt.metrics.cagr.toFixed(2)}%</div>
                                             </div>
                                             <div>
                                                 <div className="text-xs text-emerald-600 font-semibold">Drawdown</div>
                                                 <div className="font-mono text-emerald-900">{optimizationResult.best.bt.metrics.maxDrawdown.toFixed(2)}%</div>
                                             </div>
                                        </div>
                                    </div>
                                ) : (
                                     <div className="bg-purple-50 border border-purple-100 p-4 rounded-xl text-purple-800 text-sm">
                                        Tip: Optimization runs backtests on 5 years of daily data. Keep range steps reasonable to avoid browser timeouts.
                                     </div>
                                )}

                                <div className="bg-white p-4 rounded-2xl shadow-md border border-slate-200 h-[500px]">
                                    <h3 className="text-center font-semibold text-slate-700 mb-4">Performance Heatmap</h3>
                                    {optimizationResult ? (
                                        <HeatmapChart optimizationResult={optimizationResult} />
                                    ): (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-300">
                                            <CogsIcon />
                                            <span className="mt-2 text-sm font-medium">Awaiting Optimization Run</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
