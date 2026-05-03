import { parse } from 'csv-parse/sync';
import type { ColumnMapping, ParsedSample } from '@/types/csv';

export interface ParsedCsvData {
  samples: ParsedSample[];
  startTs: number; // unix ms
  endTs: number;
  sampleRateHz: number;
  rowCount: number;
}

// Sniff sample rate from timestamps in the first N rows
export function detectSampleRate(rows: Record<string, string>[], tsCol: string): number {
  if (rows.length < 2) return 1;
  const t0 = parseTimestamp(rows[0][tsCol]);
  const t1 = parseTimestamp(rows[1][tsCol]);
  const dt = Math.abs(t1 - t0);
  if (dt <= 0) return 1;
  return Math.round(1000 / dt); // ms → Hz
}

export function parseTimestamp(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  if (!isNaN(n)) {
    // Assume seconds if < 1e10, else milliseconds
    return n < 1e10 ? n * 1000 : n;
  }
  return new Date(raw).getTime();
}

export function parseCsvBuffer(
  buffer: Buffer | string,
  mapping: ColumnMapping,
  sessionStartTs?: number
): ParsedCsvData {
  const rows: Record<string, string>[] = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: false,
  });

  if (rows.length === 0) {
    return { samples: [], startTs: 0, endTs: 0, sampleRateHz: 0, rowCount: 0 };
  }

  const sampleRateHz = detectSampleRate(rows.slice(0, 100), mapping.timestamp);
  const baseTs = sessionStartTs ?? parseTimestamp(rows[0][mapping.timestamp]);
  const samples: ParsedSample[] = [];

  for (const row of rows) {
    const ts = parseTimestamp(row[mapping.timestamp]);
    for (const inv of mapping.inverters) {
      const phases: [0 | 1 | 2, string | undefined, string | undefined][] = [
        [0, inv.phaseA_voltage, inv.phaseA_current],
        [1, inv.phaseB_voltage, inv.phaseB_current],
        [2, inv.phaseC_voltage, inv.phaseC_current],
      ];
      for (const [phase, vcol, icol] of phases) {
        if (!vcol || !icol) continue;
        const v = parseFloat(row[vcol]);
        const i = parseFloat(row[icol]);
        if (isNaN(v) || isNaN(i)) continue;
        samples.push({ ts, inverterId: inv.inverterId, phase, voltageRms: v, currentRms: i });
      }
    }
  }

  const startTs = parseTimestamp(rows[0][mapping.timestamp]);
  const endTs = parseTimestamp(rows[rows.length - 1][mapping.timestamp]);
  return { samples, startTs, endTs, sampleRateHz, rowCount: rows.length };
}

// Sniff column headers to produce a best-guess ColumnMapping
export function sniffMapping(headers: string[]): ColumnMapping {
  const h = headers.map((s) => s.toLowerCase().trim());
  const tsCol = headers.find((_, i) =>
    ['timestamp', 'time', 'ts', 't', 'index'].includes(h[i])
  ) ?? headers[0];

  const inverterMap: Map<number, { [k: string]: string }> = new Map();

  for (const col of headers) {
    const lc = col.toLowerCase();
    // e.g. inv1_phA_voltage, inverter2_phase_b_current, etc.
    const invMatch = lc.match(/inv(?:erter)?(\d)/);
    const phaseMatch = lc.match(/ph(?:ase)?_?([abc])/);
    const kindMatch = lc.match(/(volt|current|amp)/);
    if (!invMatch || !phaseMatch || !kindMatch) continue;

    const invNum = parseInt(invMatch[1]);
    const phase = phaseMatch[1].toUpperCase();
    const kind = kindMatch[1].startsWith('volt') ? 'voltage' : 'current';

    if (!inverterMap.has(invNum)) inverterMap.set(invNum, {});
    inverterMap.get(invNum)![`phase${phase}_${kind}`] = col;
  }

  const inverters = Array.from(inverterMap.entries()).map(([inverterId, cols]) => ({
    inverterId,
    phaseA_voltage: cols['phaseA_voltage'] ?? '',
    phaseA_current: cols['phaseA_current'] ?? '',
    phaseB_voltage: cols['phaseB_voltage'],
    phaseB_current: cols['phaseB_current'],
    phaseC_voltage: cols['phaseC_voltage'],
    phaseC_current: cols['phaseC_current'],
  }));

  if (inverters.length === 0) {
    // Fallback: treat first voltage/current pair as inverter 1 phase A
    const vCol = headers.find((h) => h.toLowerCase().includes('volt')) ?? headers[1];
    const iCol = headers.find((h) => h.toLowerCase().includes('curr') || h.toLowerCase().includes('amp')) ?? headers[2];
    inverters.push({ inverterId: 1, phaseA_voltage: vCol, phaseA_current: iCol });
  }

  const hasPmu = h.some((c) => c.includes('pmu') || c.includes('phasor'));
  const pmu = hasPmu
    ? {
        voltage_mag: headers.find((c) => c.toLowerCase().includes('pmu_voltage_mag') || c.toLowerCase().includes('mag')) ?? '',
        voltage_angle: headers.find((c) => c.toLowerCase().includes('pmu_voltage_angle') || c.toLowerCase().includes('angle')) ?? '',
        frequency: headers.find((c) => c.toLowerCase().includes('pmu_freq') || c.toLowerCase().includes('frequency')) ?? '',
        rocof: headers.find((c) => c.toLowerCase().includes('rocof')),
      }
    : undefined;

  return { timestamp: tsCol, inverters, pmu };
}

// Validate that numeric columns are parseable
export function validateColumnData(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const checkCols = mapping.inverters.flatMap((inv) =>
    [inv.phaseA_voltage, inv.phaseA_current, inv.phaseB_voltage, inv.phaseB_current,
     inv.phaseC_voltage, inv.phaseC_current].filter(Boolean) as string[]
  );

  for (const col of checkCols) {
    for (let i = 0; i < Math.min(100, rows.length); i++) {
      const val = rows[i][col];
      if (val !== undefined && val !== '' && isNaN(parseFloat(val))) {
        errors.push(`Non-numeric data in column "${col}" at row ${i + 1}: "${val}"`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
