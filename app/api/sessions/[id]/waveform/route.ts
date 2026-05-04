import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lttb } from '@/lib/dsp/lttb';

const DEFAULT_POINTS = 5000;
const DEFAULT_WINDOW_MS = 50; // 50 ms default view

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const points = parseInt(url.searchParams.get('points') ?? String(DEFAULT_POINTS));
  const startMs = url.searchParams.get('start') ? parseFloat(url.searchParams.get('start')!) : null;
  const endMs = url.searchParams.get('end') ? parseFloat(url.searchParams.get('end')!) : null;
  const inverter = url.searchParams.get('inverter');

  // Determine time range: use explicit start/end if provided, otherwise first window of session.
  let startIso: string | null = null;
  let endIso: string | null = null;

  if (startMs !== null && endMs !== null) {
    startIso = new Date(startMs).toISOString();
    endIso = new Date(endMs).toISOString();
  } else {
    // Fetch earliest timestamp in waveform_samples for this session
    const { data: firstRow } = await supabase
      .from('waveform_samples')
      .select('ts')
      .eq('session_id', params.id)
      .order('ts', { ascending: true })
      .limit(1)
      .single();

    if (firstRow) {
      const t0 = new Date(firstRow.ts).getTime();
      startIso = new Date(t0).toISOString();
      endIso = new Date(t0 + DEFAULT_WINDOW_MS).toISOString();
    }
  }

  if (!startIso || !endIso) {
    return NextResponse.json({ error: 'No waveform data found' }, { status: 404 });
  }

  let query = supabase
    .from('waveform_samples')
    .select('ts, phase, voltage, current')
    .eq('session_id', params.id)
    .gte('ts', startIso)
    .lte('ts', endIso)
    .order('ts', { ascending: true })
    .limit(200000);

  if (inverter) query = query.eq('inverter_id', inverter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No waveform data in range' }, { status: 404 });
  }

  // Collect per-phase arrays, keyed by phase number
  const phaseData: Record<number, { tsMs: number; v: number; i: number }[]> = { 0: [], 1: [], 2: [] };
  for (const r of data) {
    phaseData[r.phase]?.push({
      tsMs: new Date(r.ts).getTime(),
      v: r.voltage ?? 0,
      i: r.current ?? 0,
    });
  }

  // Use phase A voltage as reference signal for LTTB index selection; apply same indices to all
  const refSignal = phaseData[0].map((p) => ({ x: p.tsMs, y: p.v }));
  const downsampled = points > 0 && refSignal.length > points ? lttb(refSignal, points) : refSignal;
  const dsSet = new Set(downsampled.map((p) => p.x));

  // Build filtered per-phase arrays aligned to the downsampled timestamps
  function filterPhase(rows: typeof phaseData[0]) {
    return rows.filter((r) => dsSet.has(r.tsMs));
  }

  const pA = filterPhase(phaseData[0]);
  const pB = filterPhase(phaseData[1]);
  const pC = filterPhase(phaseData[2]);

  const windowStart = new Date(startIso).getTime();

  return NextResponse.json({
    windowStart,
    windowEnd: new Date(endIso).getTime(),
    sampleCount: data.length,
    // Timestamps in ms relative to window start — matches user's spec for x-axis
    timestamps: pA.map((r) => r.tsMs - windowStart),
    phaseA_v: pA.map((r) => r.v),
    phaseB_v: pB.map((r) => r.v),
    phaseC_v: pC.map((r) => r.v),
    phaseA_i: pA.map((r) => r.i),
    phaseB_i: pB.map((r) => r.i),
    phaseC_i: pC.map((r) => r.i),
  });
}
