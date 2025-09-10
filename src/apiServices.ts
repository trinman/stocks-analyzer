import { StockData } from '../types';

// Hardcoded FMP API key as requested by the user.
// In a real-world application, this should be managed securely on a backend server.
const FMP_API_KEY = 'wLz89G8i6AbvhsSVP2PgiSKs7P71REs6';
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

/**
 * Fetches 5 years of daily historical data for a given stock symbol from the FMP API.
 * @param symbol The stock symbol (e.g., 'AAPL') to fetch data for.
 * @returns A promise that resolves to the stock data.
 */
export const fetchDailyData = async (symbol: string): Promise<StockData> => {
    if (!symbol) {
        throw new Error("Stock symbol cannot be empty.");
    }

    const today = new Date();
    const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    const fromDate = fiveYearsAgo.toISOString().slice(0, 10);

    const url = `${FMP_BASE_URL}/historical-price-full/${symbol}?from=${fromDate}&apikey=${FMP_API_KEY}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            // Try to parse the error message from FMP if possible
            let errorMessage = `Failed to fetch stock data for ${symbol}. Status: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData && (errorData['Error Message'] || errorData['error-message'])) {
                    errorMessage = `Failed to fetch stock data for ${symbol}: ${errorData['Error Message'] || errorData['error-message']}`;
                }
            } catch (e) {
                // Ignore JSON parsing error if response is not JSON
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // FMP can return an object with an error message even with a 200 status
        if (data['Error Message'] || data['error-message']) {
            throw new Error(`FMP API Error for ${symbol}: ${data['Error Message'] || data['error-message']}`);
        }
        
        if (!data.historical || !Array.isArray(data.historical) || data.historical.length === 0) {
            throw new Error(`No historical data found for symbol: ${symbol}`);
        }

        // The FMP API returns data in reverse chronological order (newest first).
        // The backtesting engine expects chronological order (oldest first), so we reverse it.
        const historicalData = data.historical.reverse();

        const stockData: StockData = {
            dates: [], o: [], h: [], l: [], c: [], v: [],
        };

        for (const record of historicalData) {
            stockData.dates.push(record.date);
            stockData.o.push(record.open);
            stockData.h.push(record.high);
            stockData.l.push(record.low);
            stockData.c.push(record.close);
            stockData.v.push(record.volume);
        }

        return stockData;

    } catch (error) {
        console.error("Error fetching data from FMP:", error);
        // Re-throw the error to be handled by the UI
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('An unknown network error occurred while fetching stock data.');
    }
};


type Timeframe = 'daily' | 'weekly' | 'monthly';

export const resampleOHLC = (data: StockData, timeframe: Timeframe): StockData => {
    if (timeframe === 'daily' || data.dates.length === 0) return { ...data };

    const groups = new Map<string, number[]>();
    
    for (let i = 0; i < data.dates.length; i++) {
        const d = new Date(data.dates[i]);
        let key: string;
        if (timeframe === 'weekly') {
            const dayOfWeek = d.getUTCDay();
            const firstDayOfWeek = new Date(d);
            firstDayOfWeek.setUTCDate(d.getUTCDate() - dayOfWeek);
            key = firstDayOfWeek.toISOString().slice(0, 10);
        } else { // monthly
            key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        }
        
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(i);
    }
    
    const dates: string[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
    
    for (const indices of groups.values()) {
        if (indices.length === 0) continue;
        
        const firstIdx = indices[0];
        const lastIdx = indices[indices.length - 1];

        dates.push(data.dates[lastIdx]);
        o.push(data.o[firstIdx]);
        c.push(data.c[lastIdx]);
        
        let high = -Infinity, low = Infinity, volume = 0;
        for (const idx of indices) {
            high = Math.max(high, data.h[idx]);
            low = Math.min(low, data.l[idx]);
            volume += data.v[idx];
        }
        h.push(high);
        l.push(low);
        v.push(volume);
    }
    
    return { dates, o, h, l, c, v };
};