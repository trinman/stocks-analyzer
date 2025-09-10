import React, { useEffect, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceLine, Scatter, Cell } from 'recharts';
import { BacktestResult, Indicators, StockData, OptimizationResult } from '../types.ts';

interface PriceChartProps {
  stockData: StockData;
  indicators: Indicators;
  backtestResult: BacktestResult | null;
}

export const PriceAndIndicatorCharts: React.FC<PriceChartProps> = ({ stockData, indicators, backtestResult }) => {
  const chartData = stockData.dates.map((date, i) => {
    const dataPoint: any = {
      date,
      price: stockData.c[i],
      upperBB: indicators.bb.upper[i],
      middleBB: indicators.bb.middle[i],
      lowerBB: indicators.bb.lower[i],
      macd: indicators.macd.MACD[i],
      signal: indicators.macd.signal[i],
      histogram: indicators.macd.histogram[i],
      rsi: indicators.rsi[i],
    };
    
    // Merge trade data for scatter plot
    const tradeOnThisDate = backtestResult?.trades.find(t => t.date === date);
    if (tradeOnThisDate) {
        if (tradeOnThisDate.type === 'buy') {
            dataPoint.buy = tradeOnThisDate.price;
        } else {
            dataPoint.sell = tradeOnThisDate.price;
        }
    }

    return dataPoint;
  });


  return (
    <div className="space-y-6">
      <div className="p-4 bg-white rounded-xl shadow-md border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Price and Trading Signals</h3>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(d) => d.slice(0, 7)} />
            <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 12 }} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={(p) => typeof p === 'number' ? `$${p.toFixed(0)}` : p} />
            <Tooltip
              formatter={(value, name) => {
                  if (typeof value === 'number') {
                      if (name === 'Buy' || name === 'Sell') return [`$${value.toFixed(2)}`, name];
                      return value.toFixed(2);
                  }
                  return null;
              }}
              labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
              contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(2px)', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}
            />
            <Legend wrapperStyle={{fontSize: "14px"}} />
            
            <Area type="monotone" dataKey="price" name="Price" yAxisId="left" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} />
            <Line type="monotone" dataKey="upperBB" name="Upper BB" yAxisId="left" stroke="#ef4444" dot={false} strokeWidth={1} strokeDasharray="5 5" />
            <Line type="monotone" dataKey="middleBB" name="Middle BB" yAxisId="left" stroke="#64748b" dot={false} strokeWidth={1} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="lowerBB" name="Lower BB" yAxisId="left" stroke="#22c55e" dot={false} strokeWidth={1} strokeDasharray="5 5" />

            <Scatter yAxisId="left" name="Buy" dataKey="buy" fill="#22c55e" shape="triangle" legendType="triangle" />
            <Scatter yAxisId="left" name="Sell" dataKey="sell" fill="#ef4444" shape="diamond" legendType="diamond" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="p-4 bg-white rounded-xl shadow-md border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Technical Indicators (MACD & RSI)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(d) => d.slice(0, 7)} />
            <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} domain={[0, 100]} />
            <Tooltip
              formatter={(value) => {
                  if (typeof value === 'number') {
                      return value.toFixed(2);
                  }
                  return null;
              }}
              labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
              contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(2px)', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}
            />
            <Legend wrapperStyle={{fontSize: "14px"}} />

            <ReferenceLine yAxisId="right" y={70} label={{ value: 'Overbought', position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }} stroke="#ef4444" strokeDasharray="3 3" />
            <ReferenceLine yAxisId="right" y={30} label={{ value: 'Oversold', position: 'insideBottomRight', fill: '#22c55e', fontSize: 10 }} stroke="#22c55e" strokeDasharray="3 3" />

            <Line type="monotone" dataKey="macd" name="MACD" yAxisId="left" stroke="#f97316" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="signal" name="Signal" yAxisId="left" stroke="#0ea5e9" dot={false} strokeWidth={2} />
            <Bar yAxisId="left" dataKey="histogram" name="Histogram" barSize={5}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.histogram && entry.histogram > 0 ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="rsi" name="RSI" yAxisId="right" stroke="#8b5cf6" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};


interface HeatmapProps {
    optimizationResult: OptimizationResult | null;
}

const prettyParamLabel = (key: string) => {
    const labels: { [key: string]: string } = {
        rsi_period: 'RSI Period',
        rsi_overbought: 'RSI Overbought',
        rsi_oversold: 'RSI Oversold',
        bb_period: 'BB Period',
        bb_std: 'Bollinger Std Dev',
        macd_fast: 'MACD Fast',
        macd_slow: 'MACD Slow',
        macd_signal: 'MACD Signal',
        stop_loss_atr: 'Stop-Loss (ATR ×)',
        risk_per_trade: 'Risk per Trade (%)',
    };
    return labels[key] || key;
};

export const HeatmapChart: React.FC<HeatmapProps> = ({ optimizationResult }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !optimizationResult) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const { grid, xs, ys, param1, param2 } = optimizationResult;
        
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        const W = rect.width, H = rect.height;

        ctx.clearRect(0, 0, W, H);
        const cols = xs.length, rows = Math.max(1, ys.length);
        const m = { left: 60, right: 20, top: 20, bottom: 75 };
        const plotW = W - m.left - m.right, plotH = H - m.top - m.bottom;
        if (!cols) return;

        const cw = plotW / cols, rh = plotH / rows;
        const vals = grid.flat().filter((v): v is number => v !== null && isFinite(v));
        const min = Math.min(...vals), max = Math.max(...vals) || 1;

        const colorScale = (t: number) => {
            if (t < 0.25) return '#3d85c6'; // Blue (Low)
            if (t < 0.5) return '#e69138'; // Brown (Medium)
            if (t < 0.75) return '#8fce00'; // Green (Good)
            return '#ff0000'; // Red (High)
        };

        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const v = grid[j][i];
                if (v === null || !isFinite(v)) continue;
                const t = (v - min) / (max - min || 1);
                const x = m.left + i * cw;
                const y = m.top + (rows - 1 - j) * rh;
                ctx.fillStyle = colorScale(t);
                ctx.fillRect(x, y, Math.max(1, cw - 0.5), Math.max(1, rh - 0.5));
            }
        }
        
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(m.left, H - m.bottom);
        ctx.lineTo(W - m.right, H - m.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(m.left, m.top);
        ctx.lineTo(m.left, H - m.bottom);
        ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xMaxTicks = 10;
        const xStep = Math.max(1, Math.ceil(cols / xMaxTicks));
        for (let i = 0; i < cols; i += xStep) {
            const xc = m.left + i * cw + cw / 2;
            ctx.fillText(String(xs[i]), xc, H - m.bottom + 8);
        }

        if (param2 !== 'select' && ys.length > 0) {
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            const yMaxTicks = 8;
            const yStep = Math.max(1, Math.ceil(rows / yMaxTicks));
            for (let j = 0; j < rows; j += yStep) {
                const yc = m.top + (rows - 1 - j) * rh + rh / 2;
                ctx.fillText(String(ys[j]), m.left - 8, yc);
            }
        }

        ctx.textAlign = 'center';
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillText(prettyParamLabel(param1), m.left + plotW / 2, H - 55);

        if (param2 !== 'select' && ys.length > 0) {
            ctx.save();
            ctx.translate(20, m.top + plotH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textBaseline = 'bottom';
            ctx.fillText(prettyParamLabel(param2), 0, 0);
            ctx.restore();
        }

    }, [optimizationResult]);

    return (
        <div className="w-full h-full relative">
            <canvas ref={canvasRef} className="w-full h-full"></canvas>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 transform flex justify-center py-2 gap-4">
                <div className="flex items-center gap-2"><div className="w-4 h-4 rounded" style={{ background: '#3d85c6' }}></div><span className="text-xs">Low</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 rounded" style={{ background: '#e69138' }}></div><span className="text-xs">Medium</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 rounded" style={{ background: '#8fce00' }}></div><span className="text-xs">Good</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 rounded" style={{ background: '#ff0000' }}></div><span className="text-xs">High</span></div>
            </div>
        </div>
    );
};