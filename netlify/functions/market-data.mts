import type { Config } from '@netlify/functions';
import { validateStockData } from '../../src/services/validation.ts';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
  const symbol = new URL(req.url).searchParams.get('symbol')?.toUpperCase() ?? '';
  if (!/^[A-Z0-9][A-Z0-9.\-^]{0,14}$/.test(symbol)) return Response.json({ error: 'Enter a valid stock symbol.' }, { status: 400, headers });
  const key = Netlify.env.get('FMP_API_KEY');
  if (!key) return Response.json({ error: 'Market data is not configured. Contact the site administrator.' }, { status: 503, headers });
  const from = new Date(); from.setUTCFullYear(from.getUTCFullYear() - 5);
  const url = new URL(`https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}`);
  url.searchParams.set('from', from.toISOString().slice(0, 10)); url.searchParams.set('apikey', key);
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) return Response.json({ error: 'Market-data provider is unavailable. Please try again later.' }, { status: upstream.status === 429 ? 429 : 502, headers });
    const payload = await upstream.json();
    if (!Array.isArray(payload.historical) || !payload.historical.length) return Response.json({ error: 'No historical data returned for this symbol.' }, { status: 422, headers });
    const rows = payload.historical.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
    const data = { dates: rows.map((r: any) => r.date), o: rows.map((r: any) => r.open), h: rows.map((r: any) => r.high), l: rows.map((r: any) => r.low), c: rows.map((r: any) => r.close), v: rows.map((r: any) => r.volume) };
    validateStockData(data);
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600' } });
  } catch {
    return Response.json({ error: 'Market data could not be loaded or validated. Please try again.' }, { status: 502, headers });
  }
};

export const config: Config = { rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 20 } };
