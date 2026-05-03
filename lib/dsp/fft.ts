// FFT and THD computation using fft.js (Indutny).
// Cap window to 4096 samples (1 s at 3 kHz).

import FFT from 'fft.js';
import type { ParsedSample } from '@/types/csv';
import type { Database } from '@/types/db';

type FftInsert = Database['public']['Tables']['fft_results']['Insert'];

interface HarmonicBin {
  n: number;   // harmonic number (1 = fundamental)
  hz: number;
  mag: number;
}

// Next power-of-2 ≥ n, capped at 4096
function nextPow2(n: number): number {
  let p = 1;
  while (p < n && p < 4096) p <<= 1;
  return p;
}

export function runFft(signal: number[], sampleRateHz: number): { magnitudes: number[]; freqResolution: number } {
  const size = nextPow2(signal.length);
  const padded = new Array(size).fill(0);
  for (let i = 0; i < signal.length && i < size; i++) padded[i] = signal[i];

  const f = new FFT(size);
  const out = f.createComplexArray();
  f.realTransform(out, padded);
  f.completeSpectrum(out);

  const magnitudes: number[] = [];
  for (let i = 0; i < size / 2; i++) {
    const re = out[2 * i];
    const im = out[2 * i + 1];
    magnitudes.push(Math.sqrt(re * re + im * im) / size);
  }

  return { magnitudes, freqResolution: sampleRateHz / size };
}

export function computeThd(magnitudes: number[], fundamentalBin: number, maxHarmonic = 50): number {
  const h1 = magnitudes[fundamentalBin];
  if (h1 === 0) return 0;
  let sumSq = 0;
  for (let n = 2; n <= maxHarmonic; n++) {
    const bin = fundamentalBin * n;
    if (bin >= magnitudes.length) break;
    sumSq += magnitudes[bin] ** 2;
  }
  return (Math.sqrt(sumSq) / h1) * 100;
}

export function extractHarmonics(
  magnitudes: number[],
  fundamentalBin: number,
  freqResolution: number,
  maxHarmonic = 20
): HarmonicBin[] {
  const harmonics: HarmonicBin[] = [];
  for (let n = 1; n <= maxHarmonic; n++) {
    const bin = fundamentalBin * n;
    if (bin >= magnitudes.length) break;
    harmonics.push({ n, hz: bin * freqResolution, mag: magnitudes[bin] });
  }
  return harmonics;
}

// Group samples by (inverterId, phase) and compute FFT per 1-second window
export function computeFftResults(
  samples: ParsedSample[],
  sessionId: string,
  inverterUuidMap: Map<number, string>,
  sampleRateHz: number,
  windowSizeMs = 1000
): FftInsert[] {
  if (samples.length === 0) return [];

  const results: FftInsert[] = [];
  const startTs = Math.min(...samples.map((s) => s.ts));

  // Group by (inverterId, phase, windowIdx)
  const groups = new Map<string, ParsedSample[]>();
  for (const s of samples) {
    const windowIdx = Math.floor((s.ts - startTs) / windowSizeMs);
    const key = `${s.inverterId}:${s.phase}:${windowIdx}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const nominalFreq = 60; // Hz

  for (const [key, windowSamples] of groups.entries()) {
    const [invIdStr, phaseStr, windowIdxStr] = key.split(':');
    const invId = parseInt(invIdStr);
    const phase = parseInt(phaseStr) as 0 | 1 | 2;
    const windowIdx = parseInt(windowIdxStr);
    const windowStart = new Date(startTs + windowIdx * windowSizeMs).toISOString();
    const inverterUuid = inverterUuidMap.get(invId);
    if (!inverterUuid) continue;

    const vSignal = windowSamples.map((s) => s.voltageRms);
    const iSignal = windowSamples.map((s) => s.currentRms);

    for (const [kind, signal] of [['voltage', vSignal], ['current', iSignal]] as const) {
      const { magnitudes, freqResolution } = runFft(signal, sampleRateHz);
      const fundamentalBin = Math.round(nominalFreq / freqResolution);
      const thd = computeThd(magnitudes, fundamentalBin);
      const harmonics = extractHarmonics(magnitudes, fundamentalBin, freqResolution);

      results.push({
        session_id: sessionId,
        inverter_id: inverterUuid,
        phase,
        window_start: windowStart,
        signal_kind: kind,
        fundamental_hz: fundamentalBin * freqResolution,
        thd_pct: thd,
        harmonics_jsonb: harmonics as unknown as import('@/types/db').Json,
        parquet_offset: null,
      });
    }
  }

  return results;
}
