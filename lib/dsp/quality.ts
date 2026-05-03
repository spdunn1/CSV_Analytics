import type { ParsedSample } from '@/types/csv';
import type { Database } from '@/types/db';
import type { WindowMetric } from '@/types/db';

type QualityFlagInsert = Omit<Database['public']['Tables']['quality_flags']['Insert'], 'id'>;

interface QualityConfig {
  nominalVoltage?: number;    // V RMS, default 120
  nominalFreq?: number;       // Hz, default 60
  sagThreshold?: number;      // fraction below nominal, default 0.1 (10%)
  imbalanceWarnPct?: number;  // default 5
  imbalanceAlertPct?: number; // default 10
  thdWarnPct?: number;        // default 5
  thdAlertPct?: number;       // default 8
  freqDeviationHz?: number;   // default 0.5
  clipConsecutive?: number;   // default 5
  gapMultiplier?: number;     // default 2 (2× expected interval)
}

export function detectQualityFlags(
  samples: ParsedSample[],
  windows: WindowMetric[],
  sessionId: string,
  inverterUuidMap: Map<number, string>,
  sampleRateHz: number,
  config: QualityConfig = {}
): QualityFlagInsert[] {
  const {
    nominalVoltage = 120,
    nominalFreq = 60,
    sagThreshold = 0.1,
    imbalanceWarnPct = 5,
    imbalanceAlertPct = 10,
    thdWarnPct = 5,
    thdAlertPct = 8,
    freqDeviationHz = 0.5,
    clipConsecutive = 5,
    gapMultiplier = 2,
  } = config;

  const flags: QualityFlagInsert[] = [];
  const expectedIntervalMs = 1000 / sampleRateHz;

  // ── Voltage sag detection ────────────────────────────────────────────────
  const sagLevel = nominalVoltage * (1 - sagThreshold);
  let sagStart: ParsedSample | null = null;
  let prevTs: number | null = null;

  for (const s of samples) {
    // Gap detection
    if (prevTs !== null) {
      const gap = s.ts - prevTs;
      if (gap > expectedIntervalMs * gapMultiplier) {
        flags.push({
          session_id: sessionId,
          ts_start: new Date(prevTs).toISOString(),
          ts_end: new Date(s.ts).toISOString(),
          inverter_id: inverterUuidMap.get(s.inverterId) ?? null,
          phase: s.phase,
          code: 'gap',
          severity: 2,
          details: { gap_ms: gap, expected_ms: expectedIntervalMs },
        });
      }
    }
    prevTs = s.ts;

    // Voltage sag
    if (s.voltageRms < sagLevel) {
      if (!sagStart) sagStart = s;
    } else if (sagStart) {
      flags.push({
        session_id: sessionId,
        ts_start: new Date(sagStart.ts).toISOString(),
        ts_end: new Date(s.ts).toISOString(),
        inverter_id: inverterUuidMap.get(sagStart.inverterId) ?? null,
        phase: sagStart.phase,
        code: 'voltage_sag',
        severity: 2,
        details: { min_v: sagStart.voltageRms, threshold_v: sagLevel },
      });
      sagStart = null;
    }
  }

  // ── Clipping: N consecutive samples at/near zero ─────────────────────────
  // (ADC lower clamp; upper clamp would be > nominalVoltage * 1.5)
  const groups = new Map<string, ParsedSample[]>();
  for (const s of samples) {
    const key = `${s.inverterId}:${s.phase}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  for (const [, gSamples] of groups.entries()) {
    let clipRun = 0;
    let clipStart: ParsedSample | null = null;
    for (const s of gSamples) {
      if (s.voltageRms < 1 || s.voltageRms > nominalVoltage * 1.5) {
        clipRun++;
        if (!clipStart) clipStart = s;
        if (clipRun >= clipConsecutive) {
          flags.push({
            session_id: sessionId,
            ts_start: new Date(clipStart.ts).toISOString(),
            ts_end: new Date(s.ts).toISOString(),
            inverter_id: inverterUuidMap.get(s.inverterId) ?? null,
            phase: s.phase,
            code: 'clip',
            severity: 3,
            details: { voltage_rms: s.voltageRms },
          });
          clipRun = 0;
          clipStart = null;
        }
      } else {
        clipRun = 0;
        clipStart = null;
      }
    }
  }

  // ── Window-level checks (imbalance, THD, frequency) ──────────────────────
  for (const w of windows) {
    if (w.imbalance_pct !== null) {
      if (w.imbalance_pct > imbalanceAlertPct) {
        flags.push({
          session_id: sessionId,
          ts_start: w.window_start,
          ts_end: null,
          inverter_id: w.inverter_id,
          phase: w.phase,
          code: 'imbalance',
          severity: 3,
          details: { imbalance_pct: w.imbalance_pct },
        });
      } else if (w.imbalance_pct > imbalanceWarnPct) {
        flags.push({
          session_id: sessionId,
          ts_start: w.window_start,
          ts_end: null,
          inverter_id: w.inverter_id,
          phase: w.phase,
          code: 'imbalance',
          severity: 2,
          details: { imbalance_pct: w.imbalance_pct },
        });
      }
    }

    if (w.thd_v_pct !== null && w.thd_v_pct > thdAlertPct) {
      flags.push({
        session_id: sessionId,
        ts_start: w.window_start,
        ts_end: null,
        inverter_id: w.inverter_id,
        phase: w.phase,
        code: 'high_thd',
        severity: w.thd_v_pct > thdAlertPct ? 3 : 2,
        details: { thd_v_pct: w.thd_v_pct },
      });
    }

    if (w.freq_mean_hz !== null && Math.abs(w.freq_mean_hz - nominalFreq) > freqDeviationHz) {
      flags.push({
        session_id: sessionId,
        ts_start: w.window_start,
        ts_end: null,
        inverter_id: w.inverter_id,
        phase: w.phase,
        code: 'freq_deviation',
        severity: 2,
        details: { freq_hz: w.freq_mean_hz, nominal_hz: nominalFreq },
      });
    }
  }

  return flags;
}

export function summarizeFlags(flags: QualityFlagInsert[]): {
  status: 'clean' | 'issues' | 'limited';
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  for (const f of flags) {
    counts[f.code] = (counts[f.code] ?? 0) + 1;
  }
  const alertCount = flags.filter((f) => f.severity === 3).length;
  const warnCount = flags.filter((f) => f.severity === 2).length;
  const status = alertCount > 0 ? 'issues' : warnCount > 0 ? 'limited' : 'clean';
  return { status, counts };
}
