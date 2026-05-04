'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { PHASE_COLORS } from './TimeSeries';
import { useSessionStore } from '@/lib/store/sessionStore';

interface WaveformData {
  windowStart: number;
  windowEnd: number;
  sampleCount: number;
  timestamps: number[];
  phaseA_v: number[];
  phaseB_v: number[];
  phaseC_v: number[];
  phaseA_i: number[];
  phaseB_i: number[];
  phaseC_i: number[];
}

interface WaveformChartProps {
  sessionId: string;
  inverterId?: string;
}

const WINDOW_PRESETS: { label: string; ms: number }[] = [
  { label: '1 cycle', ms: 16.7 },
  { label: '5 cycles', ms: 83.3 },
  { label: '10 cycles', ms: 166.7 },
  { label: '50 ms', ms: 50 },
  { label: '100 ms', ms: 100 },
  { label: '500 ms', ms: 500 },
];

export function WaveformChart({ sessionId, inverterId }: WaveformChartProps) {
  const vContainerRef = useRef<HTMLDivElement>(null);
  const iContainerRef = useRef<HTMLDivElement>(null);
  const vPlotRef = useRef<uPlot | null>(null);
  const iPlotRef = useRef<uPlot | null>(null);

  const [data, setData] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [windowMs, setWindowMs] = useState(50);
  const [isAutoRange, setIsAutoRange] = useState(false);

  const zoomRange = useSessionStore((s) => s.zoomRange);
  const collapsed = useSessionStore((s) => s.collapsed['waveform'] ?? false);
  const toggleCollapsed = useSessionStore((s) => s.toggleCollapsed);

  const fetchWaveform = useCallback(async (startMs?: number, endMs?: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ points: '5000' });
      if (startMs !== undefined && endMs !== undefined) {
        params.set('start', String(startMs));
        params.set('end', String(endMs));
      }
      if (inverterId) params.set('inverter', inverterId);
      const res = await fetch(`/api/sessions/${sessionId}/waveform?${params}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load waveform');
    } finally {
      setLoading(false);
    }
  }, [sessionId, inverterId]);

  // Initial load
  useEffect(() => { fetchWaveform(); }, [fetchWaveform]);

  // Auto-fetch when RMS zoom narrows to < 500 ms
  useEffect(() => {
    if (!zoomRange) {
      if (isAutoRange) { setIsAutoRange(false); fetchWaveform(); }
      return;
    }
    const durationMs = (zoomRange[1] - zoomRange[0]) * 1000;
    if (durationMs < 500) {
      setIsAutoRange(true);
      setWindowMs(durationMs);
      fetchWaveform(zoomRange[0] * 1000, zoomRange[1] * 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRange]);

  // Handle preset window button
  const applyPreset = (ms: number) => {
    setWindowMs(ms);
    setIsAutoRange(false);
    if (data) {
      fetchWaveform(data.windowStart, data.windowStart + ms);
    } else {
      fetchWaveform();
    }
  };

  // Build / rebuild uPlot instances when data changes
  useEffect(() => {
    if (!data || !vContainerRef.current || !iContainerRef.current) return;
    const ts = new Float64Array(data.timestamps); // ms relative to windowStart

    const buildChart = (
      container: HTMLDivElement,
      plotRef: { current: uPlot | null },
      signals: { label: string; color: string; values: number[] }[],
      yLabel: string,
      refZero = true,
    ) => {
      const uSeries: uPlot.Series[] = [
        { label: 'ms' },
        ...signals.map((s) => ({ label: s.label, stroke: s.color, width: 1.5 })),
      ];
      const chartData: uPlot.AlignedData = [
        ts,
        ...signals.map((s) => new Float64Array(s.values)),
      ];
      const opts: uPlot.Options = {
        width: container.offsetWidth || 800,
        height: 180,
        padding: [8, 16, 0, 8],
        cursor: { sync: { key: 'waveform-sync' } },
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          {
            stroke: '#9ca3af',
            grid: { stroke: '#374151', width: 0.5 },
            ticks: { stroke: '#374151', width: 0.5 },
            values: (_u, vals) => vals.map((v) => `${v.toFixed(1)} ms`),
            font: '11px monospace',
          },
          {
            label: yLabel,
            labelSize: 20,
            stroke: '#9ca3af',
            grid: { stroke: '#374151', width: 0.5 },
            ticks: { stroke: '#374151', width: 0.5 },
            font: '11px monospace',
            labelFont: '11px system-ui',
          },
        ],
        series: uSeries,
        plugins: refZero ? [zeroLinePlugin()] : undefined,
      };
      plotRef.current?.destroy();
      plotRef.current = new uPlot(opts, chartData, container);
      const ro = new ResizeObserver(() => {
        plotRef.current?.setSize({ width: container.offsetWidth, height: 180 });
      });
      ro.observe(container);
      return () => { ro.disconnect(); };
    };

    const cleanV = buildChart(
      vContainerRef.current,
      vPlotRef,
      [
        { label: 'Ph A V', color: PHASE_COLORS[0], values: data.phaseA_v },
        { label: 'Ph B V', color: PHASE_COLORS[1], values: data.phaseB_v },
        { label: 'Ph C V', color: PHASE_COLORS[2], values: data.phaseC_v },
      ],
      'V',
    );
    const cleanI = buildChart(
      iContainerRef.current,
      iPlotRef,
      [
        { label: 'Ph A I', color: PHASE_COLORS[0], values: data.phaseA_i },
        { label: 'Ph B I', color: PHASE_COLORS[1], values: data.phaseB_i },
        { label: 'Ph C I', color: PHASE_COLORS[2], values: data.phaseC_i },
      ],
      'A',
    );

    return () => { cleanV?.(); cleanI?.(); vPlotRef.current?.destroy(); iPlotRef.current?.destroy(); };
  }, [data]);

  return (
    <div className="card overflow-hidden bg-gray-950 border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 select-none">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-gray-200 hover:text-white"
          onClick={() => toggleCollapsed('waveform')}
        >
          <span className="text-gray-500 text-xs">{collapsed ? '▶' : '▼'}</span>
          Raw Waveform
        </button>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-800">
            3 kHz · raw samples
          </span>
          {isAutoRange && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-800">
              Viewing raw samples
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Window presets */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-800 flex-wrap">
            <span className="text-xs text-gray-500 mr-1">Window:</span>
            {WINDOW_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.ms)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  Math.abs(windowMs - p.ms) < 1
                    ? 'bg-blue-800 border-blue-600 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
            {data && (
              <span className="ml-auto text-xs text-gray-500 font-mono">
                {data.sampleCount.toLocaleString()} samples
              </span>
            )}
          </div>

          {/* Charts */}
          {loading && (
            <div className="flex items-center justify-center h-40 text-sm text-gray-500">
              Loading waveform…
            </div>
          )}
          {error && (
            <div className="px-4 py-3 text-sm text-red-400">{error}</div>
          )}
          {!loading && !error && (
            <>
              <div className="px-2 pt-1">
                <div className="text-xs text-gray-500 px-2 pb-1">Voltage (V)</div>
                <div ref={vContainerRef} className="w-full bg-gray-950" style={{ minHeight: 180 }} />
              </div>
              <div className="px-2 pt-1 pb-2">
                <div className="text-xs text-gray-500 px-2 pb-1">Current (A)</div>
                <div ref={iContainerRef} className="w-full bg-gray-950" style={{ minHeight: 180 }} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function zeroLinePlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx;
        const { left, width } = u.bbox;
        const y = Math.round(u.valToPos(0, 'y', true));
        ctx.save();
        ctx.strokeStyle = 'rgba(156,163,175,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + width, y);
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}
