import type { ParsedSample } from '@/types/csv';
import type { Database } from '@/types/db';

type WindowMetricInsert = Database['public']['Tables']['window_metrics_1s']['Insert'];

// Group samples into 1-second windows and compute aggregates.
export function computeWindows(
  samples: ParsedSample[],
  sessionId: string,
  inverterUuidMap: Map<number, string>, // inverterId (1-3) → DB uuid
  windowSizeMs = 1000
): WindowMetricInsert[] {
  if (samples.length === 0) return [];

  const startTs = Math.min(...samples.map((s) => s.ts));
  const endTs = Math.max(...samples.map((s) => s.ts));
  const results: WindowMetricInsert[] = [];

  // Group by (inverterId, phase, windowIndex)
  type Key = string;
  const groups = new Map<Key, ParsedSample[]>();

  for (const s of samples) {
    const windowIdx = Math.floor((s.ts - startTs) / windowSizeMs);
    const key = `${s.inverterId}:${s.phase}:${windowIdx}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  // For phase imbalance we need all 3 phases per inverter per window
  const phaseVoltages = new Map<string, number[]>(); // invId:windowIdx → [vA,vB,vC]

  for (const [key, windowSamples] of groups.entries()) {
    const [invIdStr, phaseStr, windowIdxStr] = key.split(':');
    const invId = parseInt(invIdStr);
    const phase = parseInt(phaseStr) as 0 | 1 | 2;
    const windowIdx = parseInt(windowIdxStr);
    const windowStart = new Date(startTs + windowIdx * windowSizeMs).toISOString();

    const vs = windowSamples.map((s) => s.voltageRms);
    const is_ = windowSamples.map((s) => s.currentRms);
    // True RMS: sqrt(mean(v²)) — correct whether samples are instantaneous or already-RMS.
    const vMean = rms(vs);
    const iMean = rms(is_);
    const ps = windowSamples.map((s) => s.voltageRms * s.currentRms);
    const freqs = windowSamples.map((s) => s.freqHz).filter((f): f is number => f !== undefined);

    // Store mean voltage for phase imbalance calc
    const imbalKey = `${invId}:${windowIdx}`;
    if (!phaseVoltages.has(imbalKey)) phaseVoltages.set(imbalKey, [NaN, NaN, NaN]);
    phaseVoltages.get(imbalKey)![phase] = vMean;

    const pf = vMean > 0 && iMean > 0 ? mean(ps) / (vMean * iMean) : 0;

    const inverterUuid = inverterUuidMap.get(invId);
    if (!inverterUuid) continue;

    results.push({
      session_id: sessionId,
      inverter_id: inverterUuid,
      phase,
      window_start: windowStart,
      v_rms_mean: vMean,
      v_rms_min: Math.min(...vs),
      v_rms_max: Math.max(...vs),
      i_rms_mean: iMean,
      i_rms_min: Math.min(...is_),
      i_rms_max: Math.max(...is_),
      power_mean_w: mean(ps),
      power_min_w: Math.min(...ps),
      power_max_w: Math.max(...ps),
      pf_mean: pf,
      freq_mean_hz: freqs.length > 0 ? mean(freqs) : null,
      freq_min_hz: freqs.length > 0 ? Math.min(...freqs) : null,
      freq_max_hz: freqs.length > 0 ? Math.max(...freqs) : null,
      thd_v_pct: null, // filled in by fft.ts
      thd_i_pct: null,
      imbalance_pct: null, // filled in below after all phases
      sample_count: windowSamples.length,
    });
  }

  // Back-fill imbalance_pct
  for (const row of results) {
    const windowIdx = Math.floor(
      (new Date(row.window_start).getTime() - startTs) / windowSizeMs
    );
    const invId = [...inverterUuidMap.entries()].find(([, v]) => v === row.inverter_id)?.[0];
    if (invId === undefined) continue;
    const imbalKey = `${invId}:${windowIdx}`;
    const voltages = phaseVoltages.get(imbalKey)?.filter((v) => !isNaN(v));
    if (!voltages || voltages.length < 2) continue;
    const avgV = mean(voltages);
    if (avgV === 0) continue;
    const phaseV = phaseVoltages.get(imbalKey)![row.phase];
    if (!isNaN(phaseV)) {
      row.imbalance_pct = (Math.abs(phaseV - avgV) / avgV) * 100;
    }
  }

  return results;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function rms(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.sqrt(arr.reduce((a, v) => a + v * v, 0) / arr.length);
}
