'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { sniffMapping, validateColumnData } from '@/lib/dsp/parse';
import type { CsvPreview, ColumnMapping } from '@/types/csv';
import { SchemaPreview } from './SchemaPreview';
import { ProgressBar } from './ProgressBar';
import { createClient } from '@/lib/supabase/client';

type Step = 'select' | 'preview' | 'metadata' | 'uploading' | 'done';

export function UploadWizard() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [sessionDesc, setSessionDesc] = useState('');
  const [testType, setTestType] = useState('');
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');

  const handleFileSelect = useCallback((f: File) => {
    if (!f.name.match(/\.csv$/i)) {
      setError('Only CSV files are supported');
      return;
    }
    setFile(f);
    setError('');

    // Client-side preview parse
    Papa.parse(f, {
      preview: 200,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, string>[];
        if (rows.length < 2) {
          setError('CSV must have at least 2 rows');
          return;
        }
        const headers = Object.keys(rows[0]);
        const sniffed = sniffMapping(headers);

        // Sniff sample rate from timestamp deltas
        const tsCol = sniffed.timestamp;
        const t0 = parseFloat(rows[0][tsCol]);
        const t1 = parseFloat(rows[1][tsCol]);
        const dtSec = Math.abs(t1 - t0);
        const sampleRateHz = dtSec > 0 ? Math.round(1 / dtSec) : 1;

        // Validate
        const { valid, errors } = validateColumnData(rows, sniffed);
        setValidationErrors(errors);

        const csvPreview: CsvPreview = {
          headers,
          rows: rows.slice(0, 20),
          rowCount: Math.round(f.size / (f.size / rows.length * results.data.length / results.data.length)),
          detectedSampleRateHz: sampleRateHz,
          detectedInverterCount: sniffed.inverters.length,
          detectedPhaseCount: sniffed.inverters[0]
            ? [sniffed.inverters[0].phaseA_voltage, sniffed.inverters[0].phaseB_voltage, sniffed.inverters[0].phaseC_voltage].filter(Boolean).length
            : 1,
          hasPmu: !!sniffed.pmu,
          suggestedMapping: sniffed,
        };

        setPreview(csvPreview);
        setMapping(sniffed);
        setSessionName(f.name.replace(/\.csv$/i, '').slice(0, 80));
        setStep('preview');
      },
      error: (err) => setError(`Parse error: ${err.message}`),
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  async function handleUpload() {
    if (!file || !preview || !mapping) return;
    setError('');
    setStep('uploading');
    setProgress(5);

    try {
      // 1. Mint signed URL
      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName || file.name,
          description: sessionDesc || null,
          test_type: testType || null,
          sample_rate_hz: preview.detectedSampleRateHz,
          fileName: file.name,
        }),
      });
      if (!signRes.ok) throw new Error(await signRes.text());
      const { sessionId: sid, signedUrl, storagePath } = await signRes.json();
      setSessionId(sid);
      setProgress(15);

      // 2. Upload directly to Storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'text/csv' },
      });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      setProgress(50);

      // 3. Trigger ingest
      const ingestRes = await fetch('/api/ingest/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          storagePath,
          columnMapping: mapping,
          sampleRateHz: preview.detectedSampleRateHz,
        }),
      });
      if (!ingestRes.ok) throw new Error(await ingestRes.text());
      const { jobId: jid } = await ingestRes.json();
      setJobId(jid);
      setProgress(55);

      // 4. Subscribe to ingest_jobs via Realtime
      const channel = supabase
        .channel(`job-${jid}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'ingest_jobs', filter: `id=eq.${jid}` },
          (payload) => {
            const job = payload.new as { status: string; progress: number };
            setProgress(55 + Math.round(job.progress * 0.45));
            if (job.status === 'complete') {
              setProgress(100);
              setStep('done');
              channel.unsubscribe();
            } else if (job.status === 'failed') {
              setError('Ingest failed — check logs');
              setStep('metadata');
              channel.unsubscribe();
            }
          }
        )
        .subscribe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setStep('metadata');
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Upload Test Session</h1>
        <p className="text-sm text-gray-500 mt-1">CSV from FDR card export (10 Hz – 3 kHz)</p>
      </div>

      {step === 'select' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="card p-10 text-center border-dashed cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          <p className="text-4xl mb-3">📂</p>
          <p className="font-medium">Drop CSV here or click to browse</p>
          <p className="text-sm text-gray-500 mt-1">Up to 500 MB · .csv only</p>
        </div>
      )}

      {error && (
        <div className="card p-3 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {(step === 'preview' || step === 'metadata') && preview && (
        <>
          <SchemaPreview
            preview={preview}
            mapping={mapping!}
            onMappingChange={setMapping}
            validationErrors={validationErrors}
          />

          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-sm">Session details</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Session name *</label>
                <input
                  className="input"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="FDR17 Critical Loop Run 1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Test type</label>
                <select
                  className="input"
                  value={testType}
                  onChange={(e) => setTestType(e.target.value)}
                >
                  <option value="">— Select —</option>
                  <option value="load_step">Load step</option>
                  <option value="thd_sweep">THD sweep</option>
                  <option value="staircase">Staircase</option>
                  <option value="oscillation">Oscillation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={sessionDesc}
                  onChange={(e) => setSessionDesc(e.target.value)}
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => { setFile(null); setStep('select'); }}>
              Back
            </button>
            <button
              className="btn-primary"
              disabled={!sessionName || validationErrors.length > 0}
              onClick={() => { setStep('metadata'); handleUpload(); }}
            >
              Upload & Process
            </button>
          </div>
        </>
      )}

      {step === 'uploading' && (
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold">Processing {file?.name}</h2>
          <ProgressBar progress={progress} />
          <p className="text-sm text-gray-500">
            {progress < 50 ? 'Uploading to storage...' :
             progress < 60 ? 'Starting analysis...' :
             progress < 90 ? 'Computing metrics...' :
             'Finalizing...'}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="card p-6 text-center space-y-4">
          <p className="text-2xl">✓</p>
          <h2 className="font-semibold">Processing complete</h2>
          <p className="text-sm text-gray-500">Your session data is ready to view</p>
          <button
            className="btn-primary"
            onClick={() => router.push(`/sessions/${sessionId}`)}
          >
            Open session
          </button>
        </div>
      )}
    </div>
  );
}
