'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { TimeSeries, phaseColor, invDash } from '@/components/charts/TimeSeries';
import { StatsTable } from './StatsTable';
import { Badge } from '@/components/ui/Badge';
import { ChartSkeleton } from '@/components/ui/Skeleton';
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

  const inverterLabels: Record<string, string> = {};
  session.session_inverters.forEach((si, idx) => {
    inverterLabels[si.inverter_id] = `Inv ${idx + 1}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [seriesRes, metricsRes] = await Promise.all([
        fetch(`/api/sessions/${session.id}/series?points=2000`),
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

  // Build chart data: shared timestamps + per-(inverter,phase) series
  const allTs = [...new Set(seriesData.flatMap((g) => g.series.map((p) => p.ts / 1000)))].sort((a, b) => a - b);

  function buildSeries(field: keyof SeriesDataPoint) {
    return seriesData.map((group, gIdx) => {
      const tsMap = new Map(group.series.map((p) => [Math.round(p.ts / 1000), p]));
      const invIdx = session.session_inverters.findIndex((si) => si.inverter_id === group.inverter_id);
      const phase = group.phase as 0 | 1 | 2;
      return {
        label: `${inverterLabels[group.inverter_id] ?? `Inv${gIdx}`} Ph${PHASE_LABELS[phase]}`,
        color: phaseColor(phase),
        dash: invDash(invIdx),
        data: allTs.map((t) => tsMap.get(Math.round(t))![field] as number ?? NaN),
      };
    });
  }

  const qualitySummary = session.quality_summary as { status?: string } | null;
  const status = (qualitySummary?.status ?? session.ingest_status) as Parameters<typeof Badge>[0]['status'];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{session.name}</h1>
            <Badge status={status} />
          </div>
          <p className="text-sm text-gray-500 mt-1 font-mono">
            {session.start_ts ? new Date(session.start_ts).toLocaleString() : 'No start time'}
            {session.duration_s ? ` · ${session.duration_s.toFixed(1)}s` : ''}
            {session.sample_rate_hz ? ` · ${session.sample_rate_hz} Hz` : ''}
            {session.row_count ? ` · ${session.row_count.toLocaleString()} rows` : ''}
          </p>
          {session.description && (
            <p className="text-sm text-gray-500 mt-1">{session.description}</p>
          )}
        </div>
        <div className="flex gap-2">
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
        <div className="card p-3 border-red-300 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {session.ingest_status !== 'complete' && (
        <div className="card p-4 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          Session is still processing — charts will appear when complete.
          <IngestJobPoller sessionId={session.id} onComplete={fetchData} />
        </div>
      )}

      {/* Charts */}
      {loading ? (
        <div className="space-y-4">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
        </div>
      ) : allTs.length > 0 ? (
        <div className="space-y-4">
          <TimeSeries
            title="Real Power"
            timestamps={allTs}
            series={buildSeries('p')}
            yLabel="W"
            height={220}
          />
          <TimeSeries
            title="Voltage RMS"
            timestamps={allTs}
            series={buildSeries('v')}
            yLabel="V RMS"
            height={220}
          />
          <TimeSeries
            title="Current RMS"
            timestamps={allTs}
            series={buildSeries('i')}
            yLabel="A RMS"
            height={220}
          />
          <TimeSeries
            title="THD — Voltage"
            timestamps={allTs}
            series={buildSeries('pf')}
            yLabel="%"
            height={180}
          />
        </div>
      ) : (
        session.ingest_status === 'complete' && (
          <div className="card p-8 text-center text-gray-400 text-sm">
            No time-series data found for this session.
          </div>
        )
      )}

      {/* Summary stats */}
      {metrics.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Summary statistics</h2>
          <StatsTable metrics={metrics} inverterLabels={inverterLabels} />
        </div>
      )}
    </div>
  );
}

// Polls ingest job status and calls onComplete when done
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
