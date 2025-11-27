import { GoogleGenAI, Chat } from "@google/genai";
import { BacktestMetrics, StrategyParameters, Benchmark } from '../types.ts';

if (!process.env.API_KEY) {
  console.warn("API_KEY environment variable not set. Gemini features will be disabled.");
}

const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

function formatParameters(params: StrategyParameters): string {
  let paramString = "Indicator Settings:\n";
  if (params.useBB) paramString += `• Bollinger Bands: Period=${params.bbPeriod}, StdDev=${params.bbStd}\n`;
  if (params.useRSI) paramString += `• RSI: Period=${params.rsiPeriod}, Overbought=${params.rsiOverbought}, Oversold=${params.rsiOversold}\n`;
  if (params.useMACD) paramString += `• MACD: Fast=${params.macdFast}, Slow=${params.macdSlow}, Signal=${params.macdSignal}\n`;
  
  paramString += "\nRisk Management:\n";
  paramString += `• Risk Per Trade: ${params.riskPct}%\n`;
  paramString += `• Stop Loss: ${params.stopATR}x ATR\n`;
  paramString += `• Slippage: ${params.slipBps} bps\n`;
  paramString += `• Commission: $${params.commission}\n`;

  return paramString;
}

const getInitialPrompt = (metrics: BacktestMetrics, params: StrategyParameters, benchmark: Benchmark): string => {
    return `
I have just completed a backtest of a trading strategy. Please provide your initial analysis. Here are the backtest results and the parameters used:

**Backtest Metrics:**
- Total Return: ${metrics.totalReturn.toFixed(2)}%
- Buy & Hold Return: ${benchmark.ret.toFixed(2)}%
- CAGR (Strategy): ${metrics.cagr.toFixed(2)}%
- CAGR (Buy & Hold): ${benchmark.cagr.toFixed(2)}%
- Alpha (Annualized): ${(metrics.cagr - benchmark.cagr).toFixed(2)}%
- Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}
- Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%
- Win Rate: ${metrics.winRate.toFixed(2)}%
- Number of Trades: ${metrics.numTrades}
- Profit Factor: ${metrics.profitFactor === Infinity ? "Infinity" : metrics.profitFactor.toFixed(2)}
- Time in Market (Exposure): ${metrics.timeInMarketPct.toFixed(2)}%
- Max Consecutive Losses: ${metrics.maxConsecLosses}

**Strategy Parameters:**
${formatParameters(params)}

**Your Initial Analysis:**
Based on these results, please provide:
1.  **A quick summary** of the strategy's performance (e.g., "This strategy shows potential but struggles with risk management...").
2.  **Two to three key observations**, pointing out specific strengths or weaknesses based on the metrics (e.g., "The low Sharpe Ratio despite a decent win rate suggests that losing trades are significantly larger than winning trades.").
3.  **A list of concrete, actionable suggestions for improvement.** These could involve adjusting parameters, adding new rules (like a trend filter), or changing risk management settings.
`;
};

export const getAnalysisPrompt = getInitialPrompt;

export const getInitialAnalysis = async (metrics: BacktestMetrics, params: StrategyParameters, benchmark: Benchmark): Promise<string> => {
    if (!ai) {
        throw new Error("Gemini AI is not initialized. Please set your API key in the environment variables.");
    }
    const systemInstruction = `You are a world-class quantitative trading analyst. Your task is to provide concise, insightful analysis of a trading strategy's backtest results and offer actionable suggestions for improvement. When asked a question, provide a helpful and direct answer based on the data provided. Use markdown for formatting (bolding, and bullet points). Do not use markdown headers (e.g., #, ##).`;
    const prompt = getInitialPrompt(metrics, params, benchmark);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
            },
        });
        return response.text;
    } catch (error) {
        console.error("Error getting initial analysis from Gemini:", error);
        if (error instanceof Error && error.message.includes('API key not valid')) {
            throw new Error("An error occurred while getting AI analysis. The API key is invalid.");
        }
        throw new Error("An error occurred while getting AI analysis. The service may be unavailable.");
    }
};

export const createChatSession = (initialPrompt: string, initialResponse: string): Chat | null => {
    if (!ai) return null;
    
    const systemInstruction = `You are a world-class quantitative trading analyst. Your task is to provide concise, insightful analysis of a trading strategy's backtest results and offer actionable suggestions for improvement. When asked a question, provide a helpful and direct answer based on the data provided. Use markdown for formatting (bolding, and bullet points). Do not use markdown headers (e.g., #, ##).`;

    const history = [
        {
            role: 'user' as const,
            parts: [{ text: initialPrompt }],
        },
        {
            role: 'model' as const,
            parts: [{ text: initialResponse }],
        },
    ];

    return ai.chats.create({
        model: 'gemini-2.5-flash',
        history: history,
        config: {
            systemInstruction: systemInstruction,
        },
    });
};