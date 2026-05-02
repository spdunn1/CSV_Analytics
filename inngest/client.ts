import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'derconnect' });

export type CsvUploadedEvent = {
  name: 'csv/uploaded';
  data: {
    sessionId: string;
    storagePath: string;
    jobId: string;
    columnMapping: import('@/types/csv').ColumnMapping;
    sampleRateHz: number;
  };
};
