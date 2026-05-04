import { parse } from 'csv-parse/sync';
import type { ColumnMapping, ParsedSample } from '@/types/csv';

export interface ParsedCsvData {
  samples: ParsedSample[];
  startTs: number; // unix ms
  endTs: number;
  sampleRateHz: number;
  rowCount: number;
}

// Sniff sample rate from the delta between the first two timestamps.
// Uses sub-millisecond precision so 3 kHz FDR files resolve correctly.
export function detectSampleRate(rows: Record<string, string>[], tsCol: string): number {
  if (rows.length < 2) return 1;
  const t0 = parseTimestampHiRes(rows[0][tsCol]);
  const t1 = parseTimestampHiRes(rows[1][tsCol]);
  const dtMs = Math.abs(t1 - t0);
  if (dtMs <= 0) return 1;
  return Math.round(1000 / dtMs);
}

// Returns float milliseconds with sub-ms precision.
// For FDR format "2026/04/29 18:59:40.000333333":
//   - parse base to ms via Date (covers digits 1-3 after the decimal point)
//   - add sub-ms contribution from digits 4+ of the fractional seconds field
function parseTimestampHiRes(raw: string | number | undefined): number {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const normalized = raw.replace(/\//g, '-').substring(0, 23); // "YYYY-MM-DD HH:MM:SS.mmm"
  const baseMs = new Date(normalized).getTime();
  if (isNaN(baseMs)) return new Date(String(raw)).getTime() || 0;
  // Digits beyond the 3rd fractional-second digit represent sub-ms precision.
  // e.g. "18:59:40.000333333" → frac group = "000333333", sub-ms = "333333"
  const m = raw.match(/:\d{2}\.(\d{4,})/);
  if (!m) return baseMs;
  return baseMs + parseFloat('0.' + m[1].slice(3));
}

export function parseTimestamp(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  if (!isNaN(n)) {
    // Assume seconds if < 1e10, else milliseconds
    return n < 1e10 ? n * 1000 : n;
  }
  // FDR format: "2026/04/29 18:59:40.000000000" — Date can't handle 9-digit
  // fractional seconds or '/' separators in all engines.
  if (/^\d{4}\/\d{2}\/\d{2}/.test(raw)) {
    return new Date(raw.replace(/\//g, '-').substring(0, 23)).getTime();
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

  const SQRT2 = Math.sqrt(2);
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
        // For waveform files, columns hold instantaneous V/I; convert to an
        // RMS approximation. For phasor files, columns are already RMS magnitude.
        const voltageRms = mapping.fileFormat === 'waveform' ? Math.abs(v) / SQRT2 : v;
        const currentRms = mapping.fileFormat === 'waveform' ? Math.abs(i) / SQRT2 : i;
        samples.push({ ts, inverterId: inv.inverterId, phase, voltageRms, currentRms });
      }
    }
  }

  const startTs = parseTimestamp(rows[0][mapping.timestamp]);
  const endTs = parseTimestamp(rows[rows.length - 1][mapping.timestamp]);
  return { samples, startTs, endTs, sampleRateHz, rowCount: rows.length };
}

// Regexes for the two real FDR export formats.
const WAVEFORM_RE = /CARD\d+:Phase([ABC])\.(Voltage|Current)/i;
const PHASOR_RE = /SWGR_B_(FDR\d+)_Phase([ABC])(?:_(?:Voltage|Current))?:Phase[ABC]\.(Voltage|Current)\.(Magnitude|Angle)/i;

// Sniff column headers to produce a best-guess ColumnMapping
export function sniffMapping(headers: string[]): ColumnMapping {
  const h = headers.map((s) => s.toLowerCase().trim());
  const tsCol = headers.find((_, i) =>
    ['timestamp', 'time', 'ts', 't', 'index'].includes(h[i])
  ) ?? headers[0];

  // FORMAT 1: Waveform — CARDn:Phase{A,B,C}.{Voltage,Current}
  if (headers.some((c) => WAVEFORM_RE.test(c))) {
    const cols: Record<string, string> = {};
    for (const col of headers) {
      const m = col.match(WAVEFORM_RE);
      if (!m) continue;
      const phase = m[1].toUpperCase();
      const kind = m[2].toLowerCase(); // 'voltage' | 'current'
      cols[`phase${phase}_${kind}`] = col;
    }
    return {
      timestamp: tsCol,
      fileFormat: 'waveform',
      inverters: [
        {
          inverterId: 1,
          phaseA_voltage: cols['phaseA_voltage'] ?? '',
          phaseA_current: cols['phaseA_current'] ?? '',
          phaseB_voltage: cols['phaseB_voltage'],
          phaseB_current: cols['phaseB_current'],
          phaseC_voltage: cols['phaseC_voltage'],
          phaseC_current: cols['phaseC_current'],
        },
      ],
    };
  }

  // FORMAT 2: Phasor — SWGR_B_FDRnn_Phase{A,B,C}_…:Phase{A,B,C}.{Voltage,Current}.{Magnitude,Angle}
  const phasorMatches = headers
    .map((col) => ({ col, m: col.match(PHASOR_RE) }))
    .filter((x): x is { col: string; m: RegExpMatchArray } => x.m !== null);

  if (phasorMatches.length > 0) {
    // Group by FDR id; pick the first (typically only one per file).
    const byFdr = new Map<string, Record<string, string>>();
    for (const { col, m } of phasorMatches) {
      const fdrId = m[1].toUpperCase(); // e.g. FDR08
      const phase = m[2].toUpperCase();
      const kind = m[3].toLowerCase();   // 'voltage' | 'current'
      const part = m[4].toLowerCase();   // 'magnitude' | 'angle'
      if (!byFdr.has(fdrId)) byFdr.set(fdrId, {});
      const key = part === 'magnitude'
        ? `phase${phase}_${kind}`
        : `phase${phase}_${kind}_angle`;
      byFdr.get(fdrId)![key] = col;
    }

    const inverters = Array.from(byFdr.entries()).map(([fdrId, cols]) => ({
      inverterId: parseInt(fdrId.replace(/\D/g, ''), 10) || 1,
      phaseA_voltage: cols['phaseA_voltage'] ?? '',
      phaseA_current: cols['phaseA_current'] ?? '',
      phaseB_voltage: cols['phaseB_voltage'],
      phaseB_current: cols['phaseB_current'],
      phaseC_voltage: cols['phaseC_voltage'],
      phaseC_current: cols['phaseC_current'],
      phaseA_voltage_angle: cols['phaseA_voltage_angle'],
      phaseA_current_angle: cols['phaseA_current_angle'],
      phaseB_voltage_angle: cols['phaseB_voltage_angle'],
      phaseB_current_angle: cols['phaseB_current_angle'],
      phaseC_voltage_angle: cols['phaseC_voltage_angle'],
      phaseC_current_angle: cols['phaseC_current_angle'],
    }));

    return { timestamp: tsCol, fileFormat: 'phasor', inverters };
  }

  // Legacy fallback: generic inv{N}_ph{A,B,C}_{voltage,current} columns
  const inverterMap: Map<number, { [k: string]: string }> = new Map();
  for (const col of headers) {
    const lc = col.toLowerCase();
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
    const vCol = headers.find((c) => c.toLowerCase().includes('volt')) ?? headers[1];
    const iCol = headers.find((c) => c.toLowerCase().includes('curr') || c.toLowerCase().includes('amp')) ?? headers[2];
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

  return { timestamp: tsCol, fileFormat: 'waveform', inverters, pmu };
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
