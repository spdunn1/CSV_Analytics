'use client';

import { useEffect, useRef, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useSessionStore } from '@/lib/store/sessionStore';

export interface SeriesConfig {
  label: string;
  color: string;
  dash?: number[];
  data: number[];
}

interface TimeSeriesProps {
  chartId: string;
  title: string;
  timestamps: number[];
  series: SeriesConfig[];
  yLabel?: string;
  height?: number;
  refLine?: number;
}

export const PHASE_COLORS: [string, string, string] = ['#E53935', '#1E88E5', '#43A047'];
const INV_DASH: Record<number, number[]> = { 0: [], 1: [6, 3], 2: [2, 3] };

export function phaseColor(phase: 0 | 1 | 2) { return PHASE_COLORS[phase]; }
export function invDash(invIndex: number) { return INV_DASH[invIndex % 3] ?? []; }

// Shared uPlot cursor-sync group (syncs crosshair position across all charts)
const SYNC_KEY = 'derconnect';

export function TimeSeries({
  chartId,
  title,
  timestamps,
  series,
  yLabel,
  height = 280,
  refLine,
}: TimeSeriesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const syncingRef = useRef(false); // prevent zoom-sync feedback loop

  const zoomRange = useSessionStore((s) => s.zoomRange);
  const setZoomRange = useSessionStore((s) => s.setZoomRange);
  const collapsed = useSessionStore((s) => s.collapsed[chartId] ?? false);
  const toggleCollapsed = useSessionStore((s) => s.toggleCollapsed);
  const hiddenPhases = useSessionStore((s) => s.hiddenPhases[chartId]);
  const togglePhase = useSessionStore((s) => s.togglePhase);

  // Build / rebuild the uPlot instance
  const buildPlot = useCallback(() => {
    if (!containerRef.current || timestamps.length === 0) return;
    const container = containerRef.current;

    const uSeries: uPlot.Series[] = [
      { label: 'Time' },
      ...series.map((s) => ({
        label: s.label,
        stroke: s.color,
        width: 1.5,
        dash: s.dash,
        show: true,
      })),
    ];

    const data: uPlot.AlignedData = [
      new Float64Array(timestamps),
      ...series.map((s) => new Float64Array(s.data)),
    ];

    const opts: uPlot.Options = {
      width: container.offsetWidth || 800,
      height,
      padding: [12, 16, 0, 8],
      cursor: {
        sync: { key: SYNC_KEY },
        drag: { x: true, y: false },
      },
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      axes: [
        {
          stroke: '#9ca3af',
          grid: { stroke: '#374151', width: 0.5 },
          ticks: { stroke: '#374151', width: 0.5 },
          values: (_u, vals) =>
            vals.map((v) => new Date(v * 1000).toISOString().slice(11, 19)),
          font: '11px monospace',
        },
        {
          label: yLabel ?? '',
          labelSize: 20,
          stroke: '#9ca3af',
          grid: { stroke: '#374151', width: 0.5 },
          ticks: { stroke: '#374151', width: 0.5 },
          font: '11px monospace',
          labelFont: '11px system-ui',
        },
      ],
      series: uSeries,
      hooks: {
        setScale: [
          (u, key) => {
            if (key === 'x' && !syncingRef.current) {
              const min = u.scales.x.min!;
              const max = u.scales.x.max!;
              // Only broadcast if genuinely zoomed (not full reset by uPlot)
              const fullMin = timestamps[0];
              const fullMax = timestamps[timestamps.length - 1];
              if (Math.abs(min - fullMin) > 0.001 || Math.abs(max - fullMax) > 0.001) {
                setZoomRange([min, max]);
              }
            }
          },
        ],
        ready: [(u) => {
          // Double-click resets zoom on all charts
          u.root.addEventListener('dblclick', () => setZoomRange(null));
        }],
      },
      plugins: refLine !== undefined ? [refLinePlugin(refLine)] : undefined,
    };

    plotRef.current?.destroy();
    plotRef.current = new uPlot(opts, data, container);

    // Apply initial hidden phases
    if (hiddenPhases) {
      hiddenPhases.forEach((phase) => {
        plotRef.current?.setSeries(phase + 1, { show: false });
      });
    }

    const ro = new ResizeObserver(() => {
      plotRef.current?.setSize({ width: container.offsetWidth, height });
    });
    ro.observe(container);
    return () => { ro.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamps, series, height, yLabel, setZoomRange]);

  useEffect(() => {
    const cleanup = buildPlot();
    return cleanup;
  }, [buildPlot]);

  // Sync external zoom into this chart
  useEffect(() => {
    if (!plotRef.current) return;
    syncingRef.current = true;
    if (zoomRange) {
      plotRef.current.setScale('x', { min: zoomRange[0], max: zoomRange[1] });
    } else if (timestamps.length > 0) {
      plotRef.current.setScale('x', { min: timestamps[0], max: timestamps[timestamps.length - 1] });
    }
    syncingRef.current = false;
  }, [zoomRange, timestamps]);

  // Sync phase visibility into this chart
  useEffect(() => {
    if (!plotRef.current) return;
    series.forEach((_, idx) => {
      plotRef.current!.setSeries(idx + 1, { show: !(hiddenPhases?.has(idx) ?? false) });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenPhases]);

  // Zoom range display string
  const zoomLabel = zoomRange
    ? `${new Date(zoomRange[0] * 1000).toISOString().slice(11, 19)} — ${new Date(zoomRange[1] * 1000).toISOString().slice(11, 19)}`
    : null;

  const handleDownload = () => {
    const canvas = plotRef.current?.ctx?.canvas;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${chartId}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  return (
    <div className="card overflow-hidden bg-gray-950 border-gray-800">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 select-none">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-gray-200 hover:text-white"
          onClick={() => toggleCollapsed(chartId)}
        >
          <span className="text-gray-500 text-xs">{collapsed ? '▶' : '▼'}</span>
          {title}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Phase toggles */}
            {['A', 'B', 'C'].map((ph, idx) => {
              const hidden = hiddenPhases?.has(idx) ?? false;
              return (
                <button
                  key={ph}
                  onClick={() => togglePhase(chartId, idx)}
                  className="px-2 py-0.5 rounded text-xs font-bold border transition-opacity"
                  style={{
                    color: PHASE_COLORS[idx],
                    borderColor: PHASE_COLORS[idx],
                    opacity: hidden ? 0.3 : 1,
                  }}
                >
                  {ph}
                </button>
              );
            })}

            {/* Zoom range */}
            {zoomLabel && (
              <span className="text-xs font-mono text-gray-400 hidden sm:block">{zoomLabel}</span>
            )}

            {/* Reset zoom */}
            <button
              onClick={() => setZoomRange(null)}
              className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500"
            >
              Reset zoom
            </button>

            {/* Download PNG */}
            <button
              onClick={handleDownload}
              className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500"
              title="Download PNG"
            >
              ↓ PNG
            </button>
          </div>
        )}
      </div>

      {/* Chart body */}
      {!collapsed && (
        <div
          ref={containerRef}
          className="w-full bg-gray-950"
          style={{ minHeight: height }}
        />
      )}
    </div>
  );
}

function refLinePlugin(value: number): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;
        const y = Math.round(u.valToPos(value, 'y', true));
        if (y < top || y > top + height) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(250,204,21,0.5)';
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
