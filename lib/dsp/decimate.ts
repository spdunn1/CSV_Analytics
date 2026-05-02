import type { ParsedSample } from '@/types/csv';

export interface DecimatedGroup {
  inverterId: number;
  phase: 0 | 1 | 2;
  samples: { ts: number; voltageRms: number; currentRms: number }[];
}

// Block-mean decimation: reduce samples to ~targetHz via averaging over windows.
export function decimate(
  samples: ParsedSample[],
  sourceSampleRateHz: number,
  targetHz = 10
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

      const sumV = block.reduce((a, s) => a + s.voltageRms, 0);
      const sumI = block.reduce((a, s) => a + s.currentRms, 0);
      const midTs = block[Math.floor(block.length / 2)].ts;

      result.push({
        ts: midTs,
        inverterId: block[0].inverterId,
        phase: block[0].phase,
        voltageRms: sumV / block.length,
        currentRms: sumI / block.length,
        freqHz: block[0].freqHz,
      });
    }
  }

  return result.sort((a, b) => a.ts - b.ts);
}
