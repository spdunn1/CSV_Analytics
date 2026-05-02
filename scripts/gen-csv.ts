#!/usr/bin/env tsx
/**
 * Synthetic CSV generator for DERConnect testing.
 *
 * Usage:
 *   npm run gen:csv -- --hz 10 --seconds 60 --out fixtures/10hz_60s.csv
 *   npm run gen:csv -- --hz 1000 --seconds 10 --harmonics 0.05 --out fixtures/1khz_10s.csv
 *   npm run gen:csv -- --hz 3000 --seconds 30 --sag 10 --out fixtures/3khz_30s.csv
 */

import fs from 'fs';
import path from 'path';

interface Args {
  hz: number;
  seconds: number;
  inverters: number;
  out: string;
  harmonics: number; // 5th harmonic fraction, e.g. 0.05 = 5%
  sag: number;       // inject a voltage sag starting at this second (0 = none)
  gap: number;       // inject a sample gap at this second (0 = none)
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : def;
  };
  return {
    hz: parseInt(get('--hz', '100')),
    seconds: parseInt(get('--seconds', '60')),
    inverters: parseInt(get('--inverters', '3')),
    out: get('--out', 'fixtures/test.csv'),
    harmonics: parseFloat(get('--harmonics', '0')),
    sag: parseInt(get('--sag', '0')),
    gap: parseInt(get('--gap', '0')),
  };
}

function generateWaveform(
  t: number,
  nominalV: number,
  nominalI: number,
  phaseOffsetRad: number,
  harmonicFraction: number,
  hasSag: boolean
): { v: number; i: number } {
  const freq = 60; // Hz
  const omega = 2 * Math.PI * freq;
  let v = nominalV * Math.sin(omega * t + phaseOffsetRad);
  const i = nominalI * Math.sin(omega * t + phaseOffsetRad - 0.1); // slight lag

  // Inject 5th harmonic
  if (harmonicFraction > 0) {
    v += nominalV * harmonicFraction * Math.sin(5 * omega * t + phaseOffsetRad);
  }

  // Voltage sag
  if (hasSag) v *= 0.85;

  // Compute RMS over one cycle (approximation for single sample: use peak/√2)
  const vRms = Math.abs(v) / Math.sqrt(2) + nominalV * 0.707;
  const iRms = Math.abs(i) / Math.sqrt(2) + nominalI * 0.707;

  return { v: Math.max(0, vRms), i: Math.max(0, iRms) };
}

function main() {
  const args = parseArgs();
  const dt = 1 / args.hz;
  const totalSamples = Math.round(args.seconds * args.hz);

  const outDir = path.dirname(args.out);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Build header
  const headers = ['timestamp'];
  for (let inv = 1; inv <= args.inverters; inv++) {
    for (const ph of ['A', 'B', 'C']) {
      headers.push(`inv${inv}_ph${ph}_voltage`);
      headers.push(`inv${inv}_ph${ph}_current`);
    }
  }
  headers.push('pmu_voltage_mag', 'pmu_voltage_angle', 'pmu_frequency', 'pmu_rocof');

  const phaseOffsets = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]; // 120° apart
  const nominalV = [120, 118, 121]; // slight variation per inverter
  const nominalI = [10, 9.5, 10.2];

  const rows: string[] = [headers.join(',')];

  for (let n = 0; n < totalSamples; n++) {
    const t = n * dt;

    // Inject gap: skip 50ms worth of samples
    if (args.gap > 0 && t > args.gap && t < args.gap + 0.05) continue;

    const hasSag = args.sag > 0 && t > args.sag && t < args.sag + 0.1;

    const cols: (number | string)[] = [t.toFixed(6)];

    for (let inv = 0; inv < args.inverters; inv++) {
      for (let ph = 0; ph < 3; ph++) {
        const { v, i } = generateWaveform(
          t,
          nominalV[inv],
          nominalI[inv],
          phaseOffsets[ph],
          args.harmonics,
          hasSag
        );
        cols.push(v.toFixed(4), i.toFixed(4));
      }
    }

    // PMU (based on inverter 1 phase A)
    const pmuMag = nominalV[0] * 0.707;
    const pmuAngle = ((2 * Math.PI * 60 * t) % (2 * Math.PI)) * (180 / Math.PI);
    const pmuFreq = 60 + (hasSag ? 0.3 : 0) * Math.sin(2 * Math.PI * 0.5 * t);
    cols.push(pmuMag.toFixed(4), pmuAngle.toFixed(4), pmuFreq.toFixed(6), '0.000000');

    rows.push(cols.join(','));
  }

  fs.writeFileSync(args.out, rows.join('\n') + '\n');

  const sizeMB = (fs.statSync(args.out).size / 1e6).toFixed(2);
  console.log(`Generated: ${args.out}`);
  console.log(`  Samples: ${rows.length - 1} @ ${args.hz} Hz`);
  console.log(`  Duration: ${args.seconds}s`);
  console.log(`  Inverters: ${args.inverters}`);
  console.log(`  Size: ${sizeMB} MB`);
  if (args.harmonics > 0) console.log(`  5th harmonic: ${(args.harmonics * 100).toFixed(1)}%`);
  if (args.sag > 0) console.log(`  Voltage sag at t=${args.sag}s (100ms)`);
  if (args.gap > 0) console.log(`  Sample gap at t=${args.gap}s (50ms)`);
}

main();
