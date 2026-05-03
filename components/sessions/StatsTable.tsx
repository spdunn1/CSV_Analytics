'use client';

import type { WindowMetric } from '@/types/db';

interface Props {
  metrics: WindowMetric[];
  inverterLabels?: Record<string, string>; // uuid → 'Inv 1'
}

function cellColor(value: number | null, warn: number, alert: number): string {
  if (value === null) return '';
  if (value >= alert) return 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200';
  if (value >= warn) return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
  return 'bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-200';
}

const PHASE_LABELS = ['A', 'B', 'C'];

interface AggRow {
  inverter_id: string;
  phase: number;
  v_peak: number;
  i_peak: number;
  p_mean_kw: number;
  p_peak_kw: number;
  pf: number;
  thd_v: number | null;
  thd_i: number | null;
  imbalance: number | null;
}

export function StatsTable({ metrics, inverterLabels = {} }: Props) {
  // Aggregate across all windows per (inverter, phase)
  const aggMap = new Map<string, AggRow>();

  for (const m of metrics) {
    const key = `${m.inverter_id}:${m.phase}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        inverter_id: m.inverter_id,
        phase: m.phase,
        v_peak: 0, i_peak: 0, p_mean_kw: 0, p_peak_kw: 0,
        pf: 0, thd_v: null, thd_i: null, imbalance: null,
      });
    }
    const row = aggMap.get(key)!;
    if ((m.v_rms_max ?? 0) > row.v_peak) row.v_peak = m.v_rms_max ?? 0;
    if ((m.i_rms_max ?? 0) > row.i_peak) row.i_peak = m.i_rms_max ?? 0;
    if ((m.power_max_w ?? 0) > row.p_peak_kw * 1000) row.p_peak_kw = (m.power_max_w ?? 0) / 1000;
    row.p_mean_kw += (m.power_mean_w ?? 0) / 1000;
    row.pf += m.pf_mean ?? 0;
    if (m.thd_v_pct !== null) row.thd_v = Math.max(row.thd_v ?? 0, m.thd_v_pct);
    if (m.thd_i_pct !== null) row.thd_i = Math.max(row.thd_i ?? 0, m.thd_i_pct);
    if (m.imbalance_pct !== null) row.imbalance = Math.max(row.imbalance ?? 0, m.imbalance_pct);
  }

  // Normalize averages
  const countMap = new Map<string, number>();
  for (const m of metrics) {
    const key = `${m.inverter_id}:${m.phase}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  for (const [key, row] of aggMap.entries()) {
    const n = countMap.get(key) ?? 1;
    row.p_mean_kw /= n;
    row.pf /= n;
  }

  const rows = [...aggMap.values()].sort((a, b) =>
    a.inverter_id.localeCompare(b.inverter_id) || a.phase - b.phase
  );

  if (rows.length === 0) {
    return <div className="card p-4 text-sm text-gray-400">No metrics available</div>;
  }

  const fmt = (v: number | null, decimals = 2) =>
    v === null ? '—' : v.toFixed(decimals);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            {['Inverter', 'Phase', 'Peak V', 'Peak I', 'Mean P (kW)', 'Peak P (kW)', 'PF', 'THD-V %', 'THD-I %', 'Imbalance %'].map((h) => (
              <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.inverter_id}:${row.phase}`} className="border-b border-gray-100 dark:border-gray-800">
              <td className="px-3 py-2 font-medium">
                {inverterLabels[row.inverter_id] ?? row.inverter_id.slice(0, 8)}
              </td>
              <td className="px-3 py-2 font-bold" style={{ color: ['#E53935','#1E88E5','#43A047'][row.phase] }}>
                Ph {PHASE_LABELS[row.phase]}
              </td>
              <td className="px-3 py-2 font-mono">{fmt(row.v_peak, 1)} V</td>
              <td className="px-3 py-2 font-mono">{fmt(row.i_peak, 2)} A</td>
              <td className="px-3 py-2 font-mono">{fmt(row.p_mean_kw, 3)}</td>
              <td className="px-3 py-2 font-mono">{fmt(row.p_peak_kw, 3)}</td>
              <td className={`px-3 py-2 font-mono ${cellColor(row.pf < 0.9 ? (1 - row.pf) * 100 : null, 15, 30)}`}>
                {fmt(row.pf, 3)}
              </td>
              <td className={`px-3 py-2 font-mono ${cellColor(row.thd_v, 5, 8)}`}>
                {fmt(row.thd_v)}
              </td>
              <td className={`px-3 py-2 font-mono ${cellColor(row.thd_i, 5, 8)}`}>
                {fmt(row.thd_i)}
              </td>
              <td className={`px-3 py-2 font-mono ${cellColor(row.imbalance, 5, 10)}`}>
                {fmt(row.imbalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
