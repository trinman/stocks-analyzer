import type { StockData } from '../types.ts';
import { validateStockData } from './validation.ts';

export const fetchDailyData = async (symbol: string): Promise<StockData> => {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-^]{0,14}$/.test(normalized)) throw new Error('Enter a valid stock symbol.');
  const response = await fetch(`/.netlify/functions/market-data?symbol=${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Market data is unavailable. Please try again later.');
  }
  const data = await response.json();
  validateStockData(data);
  return data;
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
