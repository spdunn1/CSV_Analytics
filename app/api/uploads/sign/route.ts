import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullish(),
  test_type: z.string().nullish(),
  sample_rate_hz: z.number().min(1).max(10000),
  fileName: z.string(),
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

  const { name, description, test_type, sample_rate_hz, fileName } = parsed.data;
  const admin = createAdminClient();

  // Create the session row first so we have the ID for the Storage path
  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .insert({
      name,
      description: description ?? null,
      test_type: test_type ?? null,
      sample_rate_hz,
      storage_path: 'pending', // will update below
      ingest_status: 'pending',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }

  const storagePath = `${session.id}/original${getExtension(fileName)}`;

  // Update storage_path with actual path
  await admin
    .from('sessions')
    .update({ storage_path: storagePath })
    .eq('id', session.id);

  // Mint a signed upload URL (valid 1 hour)
  const { data: urlData, error: urlError } = await admin.storage
    .from('raw')
    .createSignedUploadUrl(storagePath);

  if (urlError || !urlData) {
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }

  return NextResponse.json({
    sessionId: session.id,
    storagePath,
    signedUrl: urlData.signedUrl,
    token: urlData.token,
  });
}

function getExtension(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '.csv';
}
