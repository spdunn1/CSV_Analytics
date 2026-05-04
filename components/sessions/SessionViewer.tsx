'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { TimeSeries, phaseColor, invDash } from '@/components/charts/TimeSeries';
import { WaveformChart } from '@/components/charts/WaveformChart';
import { StatsTable } from './StatsTable';
import { Badge } from '@/components/ui/Badge';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { useSessionStore } from '@/lib/store/sessionStore';
import type { Session } from '@/types/db';
import type { WindowMetric } from '@/types/db';

interface SessionInverterJoin {
  inverter_id: string;
  role: string | null;
  inverters: { id: string; serial: string; model: string } | null;
}

interface SessionWithInverters extends Session {
  session_inverters: SessionInverterJoin[];
}

interface SeriesDataPoint {
  ts: number;
  v: number | null;
  i: number | null;
  p: number | null;
  pf: number | null;
  freq: number | null;
}

interface SeriesGroup {
  inverter_id: string;
  phase: number;
  series: SeriesDataPoint[];
}

const PHASE_LABELS = ['A', 'B', 'C'];

export function SessionViewer({ session }: { session: SessionWithInverters }) {
  const [seriesData, setSeriesData] = useState<SeriesGroup[]>([]);
  const [metrics, setMetrics] = useState<WindowMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const setZoomRange = useSessionStore((s) => s.setZoomRange);

  const inverterLabels: Record<string, string> = {};
  session.session_inverters.forEach((si, idx) => {
    inverterLabels[si.inverter_id] = `Inv ${idx + 1}`;
  });

  // First inverter UUID for waveform panel (shows one inverter at a time)
  const firstInverterId = session.session_inverters[0]?.inverter_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [seriesRes, metricsRes] = await Promise.all([
        fetch(`/api/sessions/${session.id}/series?points=5000`),
        fetch(`/api/sessions/${session.id}/metrics`),
      ]);
      if (!seriesRes.ok || !metricsRes.ok) throw new Error('Failed to load data');
      const [series, metricsData] = await Promise.all([seriesRes.json(), metricsRes.json()]);
      setSeriesData(series);
      setMetrics(metricsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Shared timestamps (unix seconds) across all RMS series
  const tsSet: Set<number> = new Set<number>();
  seriesData.forEach((g) => g.series.forEach((p) => tsSet.add(p.ts / 1000)));
  const allTs: number[] = [...tsSet].sort((a, b) => a - b);

  function buildSeries(field: keyof SeriesDataPoint) {
    return seriesData.map((group, gIdx) => {
      const tsMap = new Map<number, SeriesDataPoint>(
        group.series.map((p) => [Math.round(p.ts / 1000), p])
      );
      const invIdx = session.session_inverters.findIndex((si) => si.inverter_id === group.inverter_id);
      const phase = group.phase as 0 | 1 | 2;
      return {
        label: `${inverterLabels[group.inverter_id] ?? `Inv${gIdx}`} Ph${PHASE_LABELS[phase]}`,
        color: phaseColor(phase),
        dash: invDash(invIdx),
        data: allTs.map((t) => {
          const pt = tsMap.get(Math.round(t));
          const val = pt ? pt[field] : undefined;
          return typeof val === 'number' ? val : NaN;
        }),
      };
    });
  }

  const qualitySummary = session.quality_summary as { status?: string } | null;
  const status = (qualitySummary?.status ?? session.ingest_status) as Parameters<typeof Badge>[0]['status'];
  const isWaveform = session.sample_rate_hz > 100;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">{session.name}</h1>
            <Badge status={status} />
            {session.row_count && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {session.row_count.toLocaleString()} rows
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 font-mono">
            {session.start_ts ? new Date(session.start_ts).toLocaleString() : 'No start time'}
            {session.duration_s != null ? ` · ${session.duration_s.toFixed(1)} s` : ''}
            {session.sample_rate_hz ? ` · ${session.sample_rate_hz.toLocaleString()} Hz` : ''}
          </p>
          {session.description && (
            <p className="text-sm text-gray-500 mt-1">{session.description}</p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setZoomRange(null)}
            className="px-3 py-1.5 rounded text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
          >
            Reset all zoom
          </button>
          <a
            href={`/api/sessions/${session.id}/export`}
            className="btn-ghost text-xs"
            download
          >
            Export CSV
          </a>
          <Link href="/" className="btn-ghost text-xs">← Dashboard</Link>
        </div>
      </div>

      {error && (
        <div className="card p-3 border-red-800 bg-red-950/50">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {session.ingest_status !== 'complete' && (
        <div className="card p-4 text-sm text-amber-400 bg-amber-950/30 border-amber-800">
          Session is still processing — charts will appear when complete.
          <IngestJobPoller sessionId={session.id} onComplete={fetchData} />
        </div>
      )}

      {/* ── Charts ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          <ChartSkeleton height={280} />
          <ChartSkeleton height={280} />
          <ChartSkeleton height={280} />
        </div>
      ) : allTs.length > 0 ? (
        <div className="space-y-3">
          <TimeSeries
            chartId="power"
            title="Real Power"
            timestamps={allTs}
            series={buildSeries('p')}
            yLabel="kW"
            height={280}
          />
          <TimeSeries
            chartId="voltage"
            title="Voltage RMS"
            timestamps={allTs}
            series={buildSeries('v')}
            yLabel="V"
            height={280}
          />
          <TimeSeries
            chartId="current"
            title="Current RMS"
            timestamps={allTs}
            series={buildSeries('i')}
            yLabel="A"
            height={280}
          />
          <TimeSeries
            chartId="pf"
            title="Power Factor"
            timestamps={allTs}
            series={buildSeries('pf')}
            yLabel="PF"
            height={220}
          />
          <TimeSeries
            chartId="freq"
            title="Frequency"
            timestamps={allTs}
            series={buildSeries('freq')}
            yLabel="Hz"
            height={220}
          />

          {/* Raw waveform panel — only meaningful for high-rate waveform files */}
          {isWaveform && (
            <WaveformChart
              sessionId={session.id}
              inverterId={firstInverterId}
            />
          )}
        </div>
      ) : (
        session.ingest_status === 'complete' && (
          <div className="card p-8 text-center text-gray-500 text-sm bg-gray-950 border-gray-800">
            No time-series data found for this session.
          </div>
        )
      )}

      {/* ── Summary stats ──────────────────────────────────────────────── */}
      {metrics.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-400">Summary statistics</h2>
          <StatsTable metrics={metrics} inverterLabels={inverterLabels} />
        </div>
      )}
    </div>
  );
}

function IngestJobPoller({ sessionId, onComplete }: { sessionId: string; onComplete: () => void }) {
  useEffect(() => {
    let active = true;
    const poll = async () => {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.ingest_status === 'complete' && active) {
        onComplete();
      } else if (active) {
        setTimeout(poll, 3000);
      }
    };
    setTimeout(poll, 3000);
    return () => { active = false; };
  }, [sessionId, onComplete]);
  return null;
}
