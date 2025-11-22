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
      <div className="p-5 bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800">Price Action & Signals</h3>
            <div className="flex gap-4 text-sm text-slate-500">
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Buy</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-500"></span> Sell</div>
            </div>
        </div>
        
        <ResponsiveContainer width="100%" height={450}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11, fill: '#64748b' }} 
                tickFormatter={(d) => d.slice(0, 7)} 
                axisLine={false}
                tickLine={false}
                minTickGap={40}
            />
            <YAxis 
                yAxisId="left" 
                orientation="right" 
                tick={{ fontSize: 11, fill: '#64748b' }} 
                domain={['dataMin - 5', 'dataMax + 5']} 
                tickFormatter={(p) => typeof p === 'number' ? `$${p.toFixed(0)}` : p} 
                axisLine={false}
                tickLine={false}
            />
            <Tooltip
              formatter={(value, name) => {
                  if (typeof value === 'number') {
                      if (name === 'Buy' || name === 'Sell') return [`$${value.toFixed(2)}`, name];
                      return [`$${value.toFixed(2)}`, name];
                  }
                  return null;
              }}
              labelFormatter={(label: string) => new Date(label).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              contentStyle={{ backgroundColor: '#1e293b', color: '#f8fafc', borderRadius: '8px', border: 'none', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", paddingTop: "10px"}} iconType="circle" />
            
            <Area type="monotone" dataKey="price" name="Price" yAxisId="left" stroke="#3b82f6" strokeWidth={2} fill="url(#colorPrice)" activeDot={{ r: 4, strokeWidth: 0 }} />
            <Line type="monotone" dataKey="upperBB" name="Upper BB" yAxisId="left" stroke="#94a3b8" dot={false} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
            <Line type="monotone" dataKey="middleBB" name="Middle BB" yAxisId="left" stroke="#cbd5e1" dot={false} strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
            <Line type="monotone" dataKey="lowerBB" name="Lower BB" yAxisId="left" stroke="#94a3b8" dot={false} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />

            <Scatter yAxisId="left" name="Buy" dataKey="buy" fill="#10b981" shape={(props: any) => {
                const { cx, cy } = props;
                return <path d={`M${cx},${cy+6}L${cx-5},${cy-4}L${cx+5},${cy-4}Z`} fill="#10b981" stroke="none" />
            }} legendType="triangle" />
            <Scatter yAxisId="left" name="Sell" dataKey="sell" fill="#f43f5e" shape={(props: any) => {
                const { cx, cy } = props;
                return <path d={`M${cx},${cy-6}L${cx-5},${cy+4}L${cx+5},${cy+4}Z`} fill="#f43f5e" stroke="none" />
            }} legendType="diamond" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="p-5 bg-white rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-6">Market Momentum (MACD & RSI)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11, fill: '#64748b' }} 
                tickFormatter={(d) => d.slice(0, 7)} 
                axisLine={false}
                tickLine={false}
                minTickGap={40}
            />
            <YAxis yAxisId="left" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="left" tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, 100]} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value}
              labelFormatter={(label: string) => new Date(label).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              contentStyle={{ backgroundColor: '#1e293b', color: '#f8fafc', borderRadius: '8px', border: 'none', fontSize: '12px' }}
              itemStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", paddingTop: "10px"}} iconType="circle" />

            <ReferenceLine yAxisId="right" y={70} stroke="#f43f5e" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine yAxisId="right" y={30} stroke="#10b981" strokeDasharray="3 3" opacity={0.5} />

            <Line type="monotone" dataKey="macd" name="MACD" yAxisId="left" stroke="#f97316" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="signal" name="Signal" yAxisId="left" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
            <Bar yAxisId="left" dataKey="histogram" name="Histogram" barSize={4}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.histogram && entry.histogram > 0 ? '#10b981' : '#f43f5e'} opacity={0.6} />
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

        // Updated color scale for better aesthetic (Blue -> Purple -> Red)
        const colorScale = (t: number) => {
            if (t < 0.33) return `rgba(59, 130, 246, ${0.4 + t})`; // Blue
            if (t < 0.66) return `rgba(139, 92, 246, ${0.4 + t})`; // Purple
            return `rgba(16, 185, 129, ${0.4 + t})`; // Emerald for high performance
        };

        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const v = grid[j][i];
                if (v === null || !isFinite(v)) continue;
                const t = (v - min) / (max - min || 1);
                const x = m.left + i * cw;
                const y = m.top + (rows - 1 - j) * rh;
                
                // Draw cell
                ctx.fillStyle = colorScale(t);
                ctx.fillRect(x + 1, y + 1, Math.max(1, cw - 2), Math.max(1, rh - 2));
            }
        }
        
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(m.left, H - m.bottom);
        ctx.lineTo(W - m.right, H - m.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(m.left, m.top);
        ctx.lineTo(m.left, H - m.bottom);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '500 11px Inter, sans-serif';
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

        ctx.fillStyle = '#334155';
        ctx.textAlign = 'center';
        ctx.font = '600 13px Inter, sans-serif';
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
        <div className="w-full h-full relative bg-white rounded-xl">
            <canvas ref={canvasRef} className="w-full h-full"></canvas>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 transform flex justify-center py-2 gap-4 bg-white/80 backdrop-blur-sm rounded-full px-4 mb-2 border border-slate-100">
                <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Performance</span>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div><span className="text-[10px] text-slate-600">Low</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div><span className="text-[10px] text-slate-600">Med</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[10px] text-slate-600">High</span></div>
            </div>
        </div>
    );
};
