import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { ingestCsv } from '@/inngest/functions/ingestCsv';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestCsv],
});
