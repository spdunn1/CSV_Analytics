import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lttb } from '@/lib/dsp/lttb';

const DEFAULT_POINTS = 5000;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const points = parseInt(url.searchParams.get('points') ?? String(DEFAULT_POINTS));
  const inverter = url.searchParams.get('inverter'); // filter by inverter uuid
  const phase = url.searchParams.get('phase');       // '0','1','2'
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  let query = supabase
    .from('samples_decimated')
    .select('ts, inverter_id, phase, voltage_rms, current_rms, power_w, power_factor, freq_hz, thd_v_pct, thd_i_pct')
    .eq('session_id', params.id)
    .order('ts', { ascending: true })
    .limit(50000);

  if (inverter) query = query.eq('inverter_id', inverter);
  if (phase) query = query.eq('phase', parseInt(phase));
  if (start) query = query.gte('ts', start);
  if (end) query = query.lte('ts', end);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json([]);

  // Group by (inverter_id, phase) and downsample each series independently
  type SeriesKey = string;
  const seriesMap = new Map<SeriesKey, typeof data>();

  for (const row of data) {
    const key = `${row.inverter_id}:${row.phase}`;
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(row);
  }

  const result: {
    inverter_id: string;
    phase: number;
    series: { ts: number; v: number | null; i: number | null; p: number | null; pf: number | null; freq: number | null }[];
  }[] = [];

  for (const [key, rows] of seriesMap.entries()) {
    const [inverter_id, phaseStr] = key.split(':');
    const phase = parseInt(phaseStr);

    const powerPoints = rows
      .filter((r) => r.power_w !== null)
      .map((r) => ({ x: new Date(r.ts).getTime(), y: r.power_w! }));

    const downsampled = points > 0 ? lttb(powerPoints, points) : powerPoints;
    const dsSet = new Set(downsampled.map((p) => p.x));

    const series = rows
      .filter((r) => dsSet.has(new Date(r.ts).getTime()))
      .map((r) => ({
        ts: new Date(r.ts).getTime(),
        v: r.voltage_rms,
        i: r.current_rms,
        p: r.power_w !== null ? r.power_w / 1000 : null, // W → kW
        pf: r.power_factor,
        freq: r.freq_hz,
      }));

    result.push({ inverter_id, phase, series });
  }

  return NextResponse.json(result);
}
