import type { ParsedSample } from '@/types/csv';

export interface DecimatedGroup {
  inverterId: number;
  phase: 0 | 1 | 2;
  samples: { ts: number; voltageRms: number; currentRms: number }[];
}

// Block decimation: reduce samples to ~targetHz.
// mode='rms'  → compute true RMS (sqrt(mean(v²))) per block — use for raw instantaneous waveform data.
// mode='mean' → block-average — use for data already in RMS/magnitude form (phasor).
export function decimate(
  samples: ParsedSample[],
  sourceSampleRateHz: number,
  targetHz = 10,
  mode: 'rms' | 'mean' = 'mean',
): ParsedSample[] {
  if (sourceSampleRateHz <= targetHz) return samples;

  const blockSize = Math.floor(sourceSampleRateHz / targetHz);
  const result: ParsedSample[] = [];

  // Group by (inverterId, phase)
  const groups = new Map<string, ParsedSample[]>();
  for (const s of samples) {
    const key = `${s.inverterId}:${s.phase}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  for (const groupSamples of groups.values()) {
    for (let i = 0; i < groupSamples.length; i += blockSize) {
      const block = groupSamples.slice(i, i + blockSize);
      if (block.length === 0) continue;

      const midTs = block[Math.floor(block.length / 2)].ts;

      let vOut: number;
      let iOut: number;
      if (mode === 'rms') {
        vOut = Math.sqrt(block.reduce((a, s) => a + s.voltageRms * s.voltageRms, 0) / block.length);
        iOut = Math.sqrt(block.reduce((a, s) => a + s.currentRms * s.currentRms, 0) / block.length);
      } else {
        vOut = block.reduce((a, s) => a + s.voltageRms, 0) / block.length;
        iOut = block.reduce((a, s) => a + s.currentRms, 0) / block.length;
      }

      result.push({
        ts: midTs,
        inverterId: block[0].inverterId,
        phase: block[0].phase,
        voltageRms: vOut,
        currentRms: iOut,
        freqHz: block[0].freqHz,
      });
    }
  }

  return result.sort((a, b) => a.ts - b.ts);
}
