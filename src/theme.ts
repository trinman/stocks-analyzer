import { useEffect, useState } from 'react';

/**
 * Dark mode is a `dark` class on <html>, set before first paint by index.html and
 * kept in sync by App.tsx. SVG attributes (Recharts) and canvas drawing cannot use
 * Tailwind classes, so they read the same state through this hook.
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/** Colours for chart text and chrome, chosen to keep contrast in both themes. */
export const chartColors = (dark: boolean) => ({
  axis: dark ? '#94a3b8' : '#64748b',
  axisLine: dark ? '#475569' : '#cbd5e1',
  grid: dark ? '#334155' : '#f1f5f9',
  label: dark ? '#e2e8f0' : '#334155',
  tooltipBg: dark ? '#0f172a' : '#1e293b',
  tooltipBorder: dark ? '1px solid #334155' : '1px solid #1e293b',
});

/** Canvas text uses the same family as the surrounding interface. */
export const chartFont = (size: number, weight = 500) => {
  const family = typeof document === 'undefined' ? '' : getComputedStyle(document.body).fontFamily;
  return `${weight} ${size}px ${family || 'system-ui, sans-serif'}`;
};
