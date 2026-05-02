'use client';

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface SeriesConfig {
  label: string;
  color: string;
  dash?: number[];
  data: number[]; // y values aligned to shared x
}

interface TimeSeriesProps {
  title: string;
  timestamps: number[]; // unix seconds (uPlot uses seconds)
  series: SeriesConfig[];
  yLabel?: string;
  height?: number;
  events?: { ts: number; label: string }[];
  refLine?: number; // horizontal reference line value
}

const PHASE_COLORS = ['#E53935', '#1E88E5', '#43A047'];
const INV_DASH: Record<number, number[]> = { 0: [], 1: [4, 4], 2: [2, 2] };

export function phaseColor(phase: 0 | 1 | 2) {
  return PHASE_COLORS[phase];
}

export function invDash(invIndex: number) {
  return INV_DASH[invIndex % 3] ?? [];
}

export function TimeSeries({
  title,
  timestamps,
  series,
  yLabel,
  height = 200,
  events = [],
  refLine,
}: TimeSeriesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current || timestamps.length === 0) return;

    const container = containerRef.current;

    // Build uPlot series config
    const uSeries: uPlot.Series[] = [
      { label: 'Time' },
      ...series.map((s) => ({
        label: s.label,
        stroke: s.color,
        width: 1.5,
        dash: s.dash,
      })),
    ];

    const data: uPlot.AlignedData = [
      new Float64Array(timestamps),
      ...series.map((s) => new Float64Array(s.data)),
    ];

    const opts: uPlot.Options = {
      title,
      width: container.offsetWidth,
      height,
      scales: { x: { time: true }, y: {} },
      axes: [
        {
          stroke: '#6b7280',
          grid: { stroke: '#374151', width: 0.5 },
          ticks: { stroke: '#374151' },
          values: (_u, vals) =>
            vals.map((v) => new Date(v * 1000).toISOString().slice(11, 19)),
        },
        {
          label: yLabel ?? '',
          stroke: '#6b7280',
          grid: { stroke: '#374151', width: 0.5 },
          ticks: { stroke: '#374151' },
        },
      ],
      series: uSeries,
      plugins: refLine !== undefined
        ? [refLinePlugin(refLine)]
        : undefined,
    };

    if (plotRef.current) {
      plotRef.current.destroy();
    }

    plotRef.current = new uPlot(opts, data, container);

    const resizeObserver = new ResizeObserver(() => {
      plotRef.current?.setSize({ width: container.offsetWidth, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamps, series, height, yLabel, title]);

  return (
    <div className="card p-0 overflow-hidden">
      <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
      {timestamps.length === 0 && (
        <div className="flex items-center justify-center h-40 text-sm text-gray-400">
          No data
        </div>
      )}
    </div>
  );
}

// uPlot plugin to draw a horizontal reference line
function refLinePlugin(value: number): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;
        const y = Math.round(u.valToPos(value, 'y', true));
        if (y < top || y > top + height) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(250,204,21,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + width, y);
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}
