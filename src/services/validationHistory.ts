import type { ValidationRecord } from './holdoutService.ts';

export interface Exposure { symbol: string; start: string; end: string; recordedAt: string; source: 'exploration' | 'development' | 'evaluation' }
interface History { version: 1; exposures: Exposure[]; records: ValidationRecord[] }
export const HISTORY_KEY = 'stock-analyzer-holdout-v1';
export interface HistoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const serializeRecord = (value: unknown) => JSON.stringify(value, (_key, v) =>
  typeof v === 'number' && !Number.isFinite(v) ? { nonfinite: String(v) } : v, 2);
function parse(text: string): unknown {
  return JSON.parse(text, (_key, v) => v && typeof v === 'object' && Object.keys(v).length === 1 &&
    ['Infinity', '-Infinity', 'NaN'].includes(v.nonfinite) ? Number(v.nonfinite) : v);
}
export function readHistory(storage: HistoryStorage): History {
  const text = storage.getItem(HISTORY_KEY);
  if (!text) return { version: 1, exposures: [], records: [] };
  const h = parse(text) as History;
  if (h?.version !== 1 || !Array.isArray(h.exposures) || !Array.isArray(h.records) ||
      !h.exposures.every(e => typeof e.symbol === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.start) && /^\d{4}-\d{2}-\d{2}$/.test(e.end)) ||
      !h.records.every(r => typeof r.id === 'string' && typeof r.lockedAt === 'string' && typeof r.symbol === 'string' && r.plan && typeof r.plan.evaluationStart === 'string')) {
    throw new Error('Saved validation history cannot be read. Prior exposure is unknown. Export any available results before clearing browser storage.');
  }
  return h;
}
export function overlappingExposure(exposures: Exposure[], symbol: string, start: string, end: string): boolean {
  // Deliberately ignore timeframe and fingerprint: changed data must not erase prior exposure.
  return exposures.some(e => e.symbol === symbol && e.start <= end && e.end >= start);
}
export function recordExposure(storage: HistoryStorage, exposure: Exposure): void {
  const history = readHistory(storage);
  if (!history.exposures.some(e => e.symbol === exposure.symbol && e.start <= exposure.start && e.end >= exposure.end)) history.exposures.push(exposure);
  storage.setItem(HISTORY_KEY, serializeRecord(history));
}
export function saveValidationRecord(storage: HistoryStorage, record: ValidationRecord): void {
  const history = readHistory(storage);
  history.records = [...history.records.filter(r => r.id !== record.id), record];
  storage.setItem(HISTORY_KEY, serializeRecord(history));
}
