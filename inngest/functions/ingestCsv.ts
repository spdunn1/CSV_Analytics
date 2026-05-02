import { inngest } from '@/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseCsvBuffer } from '@/lib/dsp/parse';
import { decimate } from '@/lib/dsp/decimate';
import { computeWindows } from '@/lib/dsp/windows';
import { computeFftResults } from '@/lib/dsp/fft';
import { detectQualityFlags, summarizeFlags } from '@/lib/dsp/quality';
import type { SampleDecimated } from '@/types/db';

const BATCH_SIZE = 5000;
const DECIMATE_TARGET_HZ = 10;

export const ingestCsv = inngest.createFunction(
  {
    id: 'ingest-csv',
    concurrency: { limit: 4 },
    retries: 3,
  },
  { event: 'csv/uploaded' },
  async ({ event, step }) => {
    const { sessionId, storagePath, jobId, columnMapping, sampleRateHz } = event.data;
    const supabase = createAdminClient();

    // ── Step 1: Download CSV from Storage ────────────────────────────────────
    const csvBuffer = await step.run('download', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ status: 'downloading', started_at: new Date().toISOString() })
        .eq('id', jobId);

      const { data, error } = await supabase.storage
        .from('raw')
        .download(storagePath);

      if (error) throw new Error(`Storage download failed: ${error.message}`);
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    });

    // ── Step 2: Parse CSV ─────────────────────────────────────────────────────
    const parsed = await step.run('parse', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ status: 'parsing', progress: 10 })
        .eq('id', jobId);

      const buffer = Buffer.from(csvBuffer, 'base64');
      const result = parseCsvBuffer(buffer, columnMapping);
      return {
        samples: result.samples,
        startTs: result.startTs,
        endTs: result.endTs,
        rowCount: result.rowCount,
      };
    });

    // ── Step 3: Resolve / create inverter UUIDs ───────────────────────────────
    const inverterUuidMap = await step.run('resolve-inverters', async () => {
      const invIds = [...new Set(parsed.samples.map((s) => s.inverterId))].sort();
      const map: Record<number, string> = {};
      for (const invId of invIds) {
        const serial = `FLX${invId}-${sessionId.slice(0, 8)}`;
        const { data: existing } = await supabase
          .from('inverters')
          .select('id')
          .eq('serial', `slot-${invId}`)
          .maybeSingle();

        if (existing) {
          map[invId] = existing.id;
        } else {
          const { data: created, error } = await supabase
            .from('inverters')
            .insert({ serial: `slot-${invId}`, model: 'EG4 FlexBOSS18' })
            .select('id')
            .single();
          if (error) throw error;
          map[invId] = created.id;
        }

        await supabase
          .from('session_inverters')
          .upsert({ session_id: sessionId, inverter_id: map[invId], role: `inv${invId}` });
      }
      return map;
    });

    const uuidMap = new Map<number, string>(
      Object.entries(inverterUuidMap).map(([k, v]) => [parseInt(k), v])
    );

    // ── Step 4: Decimate + insert samples ─────────────────────────────────────
    await step.run('write-decimated', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ status: 'computing', progress: 30 })
        .eq('id', jobId);

      const decimated = decimate(parsed.samples, sampleRateHz, DECIMATE_TARGET_HZ);

      const rows: SampleDecimated[] = decimated.map((s) => ({
        session_id: sessionId,
        inverter_id: uuidMap.get(s.inverterId) ?? '',
        phase: s.phase,
        ts: new Date(s.ts).toISOString(),
        voltage_rms: s.voltageRms,
        current_rms: s.currentRms,
        power_w: s.voltageRms * s.currentRms,
        power_factor: null,
        freq_hz: s.freqHz ?? null,
        thd_v_pct: null,
        thd_i_pct: null,
      }));

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('samples_decimated').insert(batch);
        if (error) throw new Error(`Decimated insert failed: ${error.message}`);
      }
    });

    // ── Step 5: Compute 1s window metrics ────────────────────────────────────
    const windows = await step.run('compute-windows', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 50 })
        .eq('id', jobId);

      return computeWindows(parsed.samples, sessionId, uuidMap);
    });

    await step.run('write-windows', async () => {
      for (let i = 0; i < windows.length; i += BATCH_SIZE) {
        const batch = windows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('window_metrics_1s').insert(batch);
        if (error) throw new Error(`Windows insert failed: ${error.message}`);
      }
    });

    // ── Step 6: Compute FFT / THD ─────────────────────────────────────────────
    const fftResults = await step.run('compute-fft', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 65 })
        .eq('id', jobId);

      return computeFftResults(parsed.samples, sessionId, uuidMap, sampleRateHz);
    });

    await step.run('write-fft', async () => {
      for (let i = 0; i < fftResults.length; i += BATCH_SIZE) {
        const batch = fftResults.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('fft_results').insert(batch);
        if (error) throw new Error(`FFT insert failed: ${error.message}`);
      }
    });

    // ── Step 7: Back-fill THD into window_metrics ─────────────────────────────
    await step.run('backfill-thd', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 75 })
        .eq('id', jobId);

      for (const f of fftResults) {
        const col = f.signal_kind === 'voltage' ? 'thd_v_pct' : 'thd_i_pct';
        await supabase
          .from('window_metrics_1s')
          .update({ [col]: f.thd_pct })
          .eq('session_id', sessionId)
          .eq('inverter_id', f.inverter_id!)
          .eq('phase', f.phase!)
          .eq('window_start', f.window_start!);
      }
    });

    // ── Step 8: Detect quality flags ─────────────────────────────────────────
    const qualityFlags = await step.run('detect-quality', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 85 })
        .eq('id', jobId);

      const windowRows = windows.map((w) => ({
        ...w,
        id: 0, // placeholder — not actually stored yet
      })) as import('@/types/db').WindowMetric[];

      return detectQualityFlags(parsed.samples, windowRows, sessionId, uuidMap, sampleRateHz);
    });

    await step.run('write-quality', async () => {
      if (qualityFlags.length > 0) {
        const { error } = await supabase.from('quality_flags').insert(qualityFlags);
        if (error) throw new Error(`Quality flags insert failed: ${error.message}`);
      }
    });

    // ── Step 9: Finalize session ──────────────────────────────────────────────
    await step.run('finalize', async () => {
      const { status, counts } = summarizeFlags(qualityFlags);

      await supabase
        .from('sessions')
        .update({
          start_ts: new Date(parsed.startTs).toISOString(),
          end_ts: new Date(parsed.endTs).toISOString(),
          row_count: parsed.rowCount,
          quality_summary: { status, counts },
          ingest_status: 'complete',
        })
        .eq('id', sessionId);

      await supabase
        .from('ingest_jobs')
        .update({
          status: 'complete',
          progress: 100,
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    });

    return { sessionId, rowCount: parsed.rowCount };
  }
);
