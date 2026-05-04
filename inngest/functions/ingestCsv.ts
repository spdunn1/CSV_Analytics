import { inngest } from '@/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseCsvBuffer } from '@/lib/dsp/parse';
import { decimate } from '@/lib/dsp/decimate';
import { computeWindows } from '@/lib/dsp/windows';
import { computeFftResults } from '@/lib/dsp/fft';
import { detectQualityFlags, summarizeFlags } from '@/lib/dsp/quality';
import type { ParsedSample } from '@/types/csv';
import type { SampleDecimated, WindowMetric } from '@/types/db';

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
    const { sessionId, storagePath, jobId, columnMapping } = event.data;
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

    // ── Step 2: Parse + resolve inverters + write decimated samples ───────────
    // Returns only small metadata — no samples array crosses the step boundary.
    const parsed = await step.run('parse-and-write', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ status: 'parsing', progress: 10 })
        .eq('id', jobId);

      const buffer = Buffer.from(csvBuffer, 'base64');
      const result = parseCsvBuffer(buffer, columnMapping);

      // Resolve / create inverter UUIDs
      const invIds = [...new Set(result.samples.map((s) => s.inverterId))].sort();
      const uuidMap: Record<number, string> = {};
      for (const invId of invIds) {
        const { data: existing } = await supabase
          .from('inverters')
          .select('id')
          .eq('serial', `slot-${invId}`)
          .maybeSingle();

        if (existing) {
          uuidMap[invId] = existing.id;
        } else {
          const { data: created, error } = await supabase
            .from('inverters')
            .insert({ serial: `slot-${invId}`, model: 'EG4 FlexBOSS18' })
            .select('id')
            .single();
          if (error) throw error;
          uuidMap[invId] = created.id;
        }

        await supabase
          .from('session_inverters')
          .upsert({ session_id: sessionId, inverter_id: uuidMap[invId], role: `inv${invId}` });
      }

      const invUuidMap = new Map(Object.entries(uuidMap).map(([k, v]) => [parseInt(k), v]));

      // Decimate and write to samples_decimated in batches of BATCH_SIZE
      await supabase
        .from('ingest_jobs')
        .update({ progress: 20 })
        .eq('id', jobId);

      const decimated = decimate(result.samples, result.sampleRateHz, DECIMATE_TARGET_HZ);
      const rows: SampleDecimated[] = decimated.map((s) => ({
        session_id: sessionId,
        inverter_id: invUuidMap.get(s.inverterId) ?? '',
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
        const { error } = await supabase.from('samples_decimated').insert(rows.slice(i, i + BATCH_SIZE));
        if (error) throw new Error(`Decimated insert failed: ${error.message}`);
      }

      // Persist the true detected sample rate back to the session row
      await supabase
        .from('sessions')
        .update({ sample_rate_hz: result.sampleRateHz })
        .eq('id', sessionId);

      return {
        rowCount: result.rowCount,
        startTs: result.startTs,
        endTs: result.endTs,
        sampleRateHz: result.sampleRateHz,
        inverterUuidMap: uuidMap, // Record<number, string> — small object
      };
    });

    const uuidMap = new Map<number, string>(
      Object.entries(parsed.inverterUuidMap).map(([k, v]) => [parseInt(k), v])
    );
    // Reverse map for converting DB rows back to numeric inverter IDs
    const uuidToInvId = new Map<string, number>(
      Object.entries(parsed.inverterUuidMap).map(([k, v]) => [v, parseInt(k)])
    );

    // ── Step 3: Compute 1s window metrics (reads from DB) ─────────────────────
    const windows = await step.run('compute-windows', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 50 })
        .eq('id', jobId);

      const samples = await queryDecimatedSamples(supabase, sessionId, uuidToInvId);
      return computeWindows(samples, sessionId, uuidMap);
    });

    await step.run('write-windows', async () => {
      for (let i = 0; i < windows.length; i += BATCH_SIZE) {
        const { error } = await supabase.from('window_metrics_1s').insert(windows.slice(i, i + BATCH_SIZE));
        if (error) throw new Error(`Windows insert failed: ${error.message}`);
      }
    });

    // ── Step 4: Compute FFT / THD (reads from DB) ─────────────────────────────
    const fftResults = await step.run('compute-fft', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 65 })
        .eq('id', jobId);

      const samples = await queryDecimatedSamples(supabase, sessionId, uuidToInvId);
      return computeFftResults(samples, sessionId, uuidMap, parsed.sampleRateHz);
    });

    await step.run('write-fft', async () => {
      for (let i = 0; i < fftResults.length; i += BATCH_SIZE) {
        const { error } = await supabase.from('fft_results').insert(fftResults.slice(i, i + BATCH_SIZE));
        if (error) throw new Error(`FFT insert failed: ${error.message}`);
      }
    });

    // ── Step 5: Back-fill THD into window_metrics ─────────────────────────────
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

    // ── Step 6: Detect quality flags (reads from DB) ──────────────────────────
    const qualityFlags = await step.run('detect-quality', async () => {
      await supabase
        .from('ingest_jobs')
        .update({ progress: 85 })
        .eq('id', jobId);

      const samples = await queryDecimatedSamples(supabase, sessionId, uuidToInvId);

      const { data: windowRows, error } = await supabase
        .from('window_metrics_1s')
        .select('*')
        .eq('session_id', sessionId)
        .limit(100000);
      if (error) throw new Error(`Window query failed: ${error.message}`);

      return detectQualityFlags(
        samples,
        (windowRows ?? []) as WindowMetric[],
        sessionId,
        uuidMap,
        parsed.sampleRateHz,
      );
    });

    await step.run('write-quality', async () => {
      if (qualityFlags.length > 0) {
        const { error } = await supabase.from('quality_flags').insert(qualityFlags);
        if (error) throw new Error(`Quality flags insert failed: ${error.message}`);
      }
    });

    // ── Step 7: Finalize session ──────────────────────────────────────────────
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

// Query samples_decimated for a session and convert to ParsedSample[].
// Supabase default page limit is 1000 rows — use explicit limit to cover large sessions.
async function queryDecimatedSamples(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  uuidToInvId: Map<string, number>,
): Promise<ParsedSample[]> {
  const { data, error } = await supabase
    .from('samples_decimated')
    .select('*')
    .eq('session_id', sessionId)
    .order('ts', { ascending: true })
    .limit(100000);

  if (error) throw new Error(`samples_decimated query failed: ${error.message}`);

  return (data ?? [] as SampleDecimated[]).map((r: SampleDecimated) => ({
    ts: new Date(r.ts).getTime(),
    inverterId: uuidToInvId.get(r.inverter_id) ?? 1,
    phase: r.phase as 0 | 1 | 2,
    voltageRms: r.voltage_rms ?? 0,
    currentRms: r.current_rms ?? 0,
    freqHz: r.freq_hz ?? undefined,
  }));
}
