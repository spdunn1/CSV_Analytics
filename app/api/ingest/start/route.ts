import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { inngest } from '@/inngest/client';
import { z } from 'zod';

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  storagePath: z.string(),
  columnMapping: z.any(),
  sampleRateHz: z.number().min(1).max(10000),
});

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { sessionId, storagePath, columnMapping, sampleRateHz } = parsed.data;
  const admin = createAdminClient();

  // Verify session belongs to this user (or any authenticated user for shared workspace)
  const { data: session } = await admin
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Create job row
  const { data: job, error: jobError } = await admin
    .from('ingest_jobs')
    .insert({ session_id: sessionId, status: 'pending', progress: 0 })
    .select('id')
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: 'Failed to create ingest job' }, { status: 500 });
  }

  // Update session status
  await admin
    .from('sessions')
    .update({ ingest_status: 'processing' })
    .eq('id', sessionId);

  // Emit Inngest event
  await inngest.send({
    name: 'csv/uploaded',
    data: { sessionId, storagePath, jobId: job.id, columnMapping, sampleRateHz },
  });

  return NextResponse.json({ jobId: job.id });
}
