'use client';

import type { WindowMetric } from '@/types/db';

interface Props {
  metrics: WindowMetric[];
  inverterLabels?: Record<string, string>;
}

const PHASE_LABELS = ['A', 'B', 'C'];
const PHASE_COLORS = ['#E53935', '#1E88E5', '#43A047'];

function thdColor(v: number | null) {
  if (v === null) return '';
  if (v >= 8) return 'bg-red-900/50 text-red-300';
  if (v >= 5) return 'bg-amber-900/40 text-amber-300';
  return 'bg-green-900/20 text-green-300';
}

function imbalColor(v: number | null) {
  if (v === null) return '';
  if (v >= 5) return 'bg-red-900/50 text-red-300';
  if (v >= 2) return 'bg-amber-900/40 text-amber-300';
  return 'bg-green-900/20 text-green-300';
}

function pfColor(v: number | null) {
  if (v === null) return '';
  if (v < 0.85) return 'bg-red-900/50 text-red-300';
  if (v < 0.9) return 'bg-amber-900/40 text-amber-300';
  return 'bg-green-900/20 text-green-300';
}

interface AggRow {
  inverter_id: string;
  phase: number;
  v_peak: number;
  i_rms: number;
  p_kw: number;
  pf: number;
  thd_v: number | null;
  imbalance: number | null;
  windowCount: number;
}

export function StatsTable({ metrics, inverterLabels = {} }: Props) {
  const aggMap = new Map<string, AggRow>();

  for (const m of metrics) {
    const key = `${m.inverter_id}:${m.phase}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        inverter_id: m.inverter_id,
        phase: m.phase,
        v_peak: 0, i_rms: 0, p_kw: 0, pf: 0,
        thd_v: null, imbalance: null, windowCount: 0,
      });
    }
    const row = aggMap.get(key)!;
    row.windowCount++;
    if ((m.v_rms_max ?? 0) > row.v_peak) row.v_peak = m.v_rms_max ?? 0;
    row.i_rms += m.i_rms_mean ?? 0;
    row.p_kw += (m.power_mean_w ?? 0) / 1000;
    row.pf += m.pf_mean ?? 0;
    if (m.thd_v_pct !== null) row.thd_v = Math.max(row.thd_v ?? 0, m.thd_v_pct);
    if (m.imbalance_pct !== null) row.imbalance = Math.max(row.imbalance ?? 0, m.imbalance_pct);
  }

  for (const row of aggMap.values()) {
    const n = row.windowCount || 1;
    row.i_rms /= n;
    row.p_kw /= n;
    row.pf /= n;
  }

  const rows = [...aggMap.values()].sort(
    (a, b) => a.inverter_id.localeCompare(b.inverter_id) || a.phase - b.phase,
  );

  if (rows.length === 0) {
    return <div className="card p-4 text-sm text-gray-400">No metrics available</div>;
  }

  const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));

  return (
    <div className="card overflow-x-auto bg-gray-950 border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            {['Inverter', 'Phase', 'Peak V', 'RMS I (A)', 'Power (kW)', 'PF', 'THD-V %', 'Imbalance %'].map((h) => (
              <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.inverter_id}:${row.phase}`} className="border-b border-gray-800 hover:bg-gray-900/40">
              <td className="px-3 py-2 font-medium text-gray-300">
                {inverterLabels[row.inverter_id] ?? row.inverter_id.slice(0, 8)}
              </td>
              <td className="px-3 py-2 font-bold" style={{ color: PHASE_COLORS[row.phase] }}>
                Ph {PHASE_LABELS[row.phase]}
              </td>
              <td className="px-3 py-2 font-mono text-gray-200">{fmt(row.v_peak, 1)} V</td>
              <td className="px-3 py-2 font-mono text-gray-200">{fmt(row.i_rms, 2)}</td>
              <td className="px-3 py-2 font-mono text-gray-200">{fmt(row.p_kw, 3)}</td>
              <td className={`px-3 py-2 font-mono rounded ${pfColor(row.pf)}`}>
                {fmt(row.pf, 3)}
              </td>
              <td className={`px-3 py-2 font-mono rounded ${thdColor(row.thd_v)}`}>
                {fmt(row.thd_v)}
              </td>
              <td className={`px-3 py-2 font-mono rounded ${imbalColor(row.imbalance)}`}>
                {fmt(row.imbalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
