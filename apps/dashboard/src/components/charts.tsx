'use client';

import { useState } from 'react';
import { usd, shortAddress } from '@/lib/api';

// Charts are hand-drawn SVG on purpose: the shapes are simple, and a charting
// dependency would be far heavier than the few lines of geometry below.

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export interface Series {
  label: string;
  color: string;
  points: number[];
}

export interface TooltipPoint {
  x: number;
  y: number;
  label: string;
  value: number;
  color: string;
}

function scaleY(max: number) {
  return max > 0 ? (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H : () => PAD.top + PLOT_H;
}

function niceStep(max: number) {
  if (max <= 0) return 1;
  const rough = max / 4;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow10;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow10;
}

function yTicks(max: number): number[] {
  const step = niceStep(max);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

function areaPath(points: number[], max: number) {
  if (points.length === 0) return '';
  const y = scaleY(max);
  const step = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${PAD.left + i * step} ${y(v)}`).join(' ');
  return `${line} L ${PAD.left + (points.length - 1) * step} ${PAD.top + PLOT_H} L ${PAD.left} ${PAD.top + PLOT_H} Z`;
}

function linePath(points: number[], max: number) {
  if (points.length === 0) return '';
  const y = scaleY(max);
  const step = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
  return points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${PAD.left + i * step} ${y(v)}`).join(' ');
}

/** AreaChart plots one or more USD series sharing a scale with axes and tooltips. */
export function AreaChart({
  series,
  labels,
}: {
  series: Series[];
  labels: string[];
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const ticks = yTicks(max);
  const [tip, setTip] = useState<TooltipPoint | null>(null);

  const step = labels.length > 1 ? PLOT_W / (labels.length - 1) : 0;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotX = (x / rect.width) * WIDTH;
    if (plotX < PAD.left || plotX > WIDTH - PAD.right) {
      setTip(null);
      return;
    }
    const idx = Math.min(labels.length - 1, Math.max(0, Math.round((plotX - PAD.left) / step)));
    const s = series[0];
    if (!s) return;
    const val = s.points[idx] ?? 0;
    setTip({
      x: e.clientX + 12,
      y: e.clientY - 40,
      label: `${labels[idx]}: ${usd(val)}`,
      value: val,
      color: s.color,
    });
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
      >
        {/* grid */}
        {ticks.map((t, i) => {
          const y = scaleY(max)(t);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                className="stroke-slate-800"
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {usd(t)}
              </text>
            </g>
          );
        })}
        {/* x-axis labels */}
        {labels.length > 0 &&
          [0, Math.floor(labels.length / 2), labels.length - 1].map((idx, i) => {
            if (idx >= labels.length) return null;
            const x = PAD.left + idx * step;
            return (
              <text key={i} x={x} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={10} fill="#64748b">
                {labels[idx]}
              </text>
            );
          })}
        {series.map((s) => (
          <g key={s.label}>
            <path d={areaPath(s.points, max)} fill={s.color} fillOpacity={0.12} />
            <path d={linePath(s.points, max)} fill="none" stroke={s.color} strokeWidth={2} />
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex gap-4">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <span>max {usd(max)}</span>
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 shadow"
          style={{ left: tip.x, top: tip.y }}
        >
          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: tip.color }} />
          {tip.label}
        </div>
      )}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  sub?: string;
  color?: string;
  href?: string;
}

/** BarList ranks categories by value, drawing each share as a filled row. */
export function BarList({ bars, color = '#38bdf8' }: { bars: Bar[]; color?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-2">
      {bars.map((b) => {
        const label = <span className="font-medium text-slate-200">{b.label}</span>;
        return (
          <div key={b.label} className="text-sm">
            <div className="flex items-baseline justify-between">
              {b.href ? (
                <a href={b.href} className="font-medium text-sky-300 hover:underline">
                  {b.label}
                </a>
              ) : (
                label
              )}
              <span className="tabular-nums text-slate-400">
                {usd(b.value)}
                {b.sub ? <span className="ml-2 text-xs text-slate-500">{b.sub}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${(b.value / max) * 100}%`, background: b.color ?? color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface HeatPoint {
  label: string;
  value: number;
  title?: string;
}

/** Heatmap draws a compact horizontal bar per label, colour-coded by intensity. */
export function Heatmap({ points, max }: { points: HeatPoint[]; max?: number }) {
  const top = Math.max(1, ...points.map((p) => p.value));
  const limit = max ?? top;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {points.map((p) => {
        const ratio = Math.min(1, p.value / limit);
        return (
          <div
            key={p.label}
            className="rounded border border-slate-800 bg-slate-900 px-2 py-2 text-center"
            title={p.title ?? `${p.label}: ${usd(p.value)}`}
          >
            <div className="text-xs text-slate-400">{p.label}</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">{usd(p.value)}</div>
            <div
              className="mx-auto mt-1 h-1 rounded-full"
              style={{
                width: `${Math.max(4, ratio * 100)}%`,
                background: `rgba(52, 211, 153, ${0.3 + ratio * 0.7})`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Donut chart for share breakdowns with a simple legend. */
export function Donut({ slices }: { slices: DonutSlice[] }) {
  const total = Math.max(1, slices.reduce((s, v) => s + v.value, 0));
  const radius = 80;
  const cx = 100;
  const cy = 100;
  let angle = -Math.PI / 2;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      <svg viewBox="0 0 200 200" className="h-40 w-40">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e293b" strokeWidth={24} />
        {slices.map((s) => {
          const frac = s.value / total;
          const arc = frac * Math.PI * 2;
          const x1 = cx + radius * Math.cos(angle);
          const y1 = cy + radius * Math.sin(angle);
          const x2 = cx + radius * Math.cos(angle + arc);
          const y2 = cy + radius * Math.sin(angle + arc);
          const large = arc > Math.PI ? 1 : 0;
          const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
          angle += arc;
          return <path key={s.label} d={d} fill={s.color} opacity={0.9} />;
        })}
        <circle cx={cx} cy={cy} r={52} fill="#0f172a" />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fill="#94a3b8" className="tabular-nums">
          {usd(total)}
        </text>
      </svg>
      <div className="space-y-1 text-sm">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-300">{s.label}</span>
            <span className="tabular-nums text-slate-500">{usd(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { usd, shortAddress };
