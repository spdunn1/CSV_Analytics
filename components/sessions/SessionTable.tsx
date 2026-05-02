'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { Session } from '@/types/db';

interface SessionRow extends Session {
  ingest_jobs?: { status: string; progress: number }[];
}

interface Props {
  sessions: SessionRow[];
}

function formatDuration(s: number | null): string {
  if (!s) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getQualityStatus(row: SessionRow): 'clean' | 'issues' | 'limited' | 'pending' | 'processing' {
  if (row.ingest_status === 'pending' || row.ingest_status === 'processing') {
    const job = row.ingest_jobs?.[0];
    if (job?.status === 'failed') return 'issues';
    return 'processing';
  }
  const qs = (row.quality_summary as { status?: string } | null)?.status;
  return (qs as 'clean' | 'issues' | 'limited') ?? 'pending';
}

export function SessionTable({ sessions }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-500 text-sm">
        No sessions yet.{' '}
        <Link href="/upload" className="text-blue-500 hover:underline">Upload your first CSV</Link>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            {['Name', 'Date', 'Duration', 'Sample rate', 'Rows', 'Status'].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((row) => (
            <tr
              key={row.id}
              className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
            >
              <td className="px-4 py-3">
                <Link href={`/sessions/${row.id}`} className="font-medium hover:text-blue-600 dark:hover:text-blue-400">
                  {row.name}
                </Link>
                {row.test_type && (
                  <span className="ml-2 text-xs text-gray-400">{row.test_type.replace('_', ' ')}</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs font-mono whitespace-nowrap">
                {formatDate(row.created_at)}
              </td>
              <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                {formatDuration(row.duration_s)}
              </td>
              <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                {row.sample_rate_hz} Hz
              </td>
              <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                {row.row_count?.toLocaleString() ?? '—'}
              </td>
              <td className="px-4 py-3">
                <Badge status={getQualityStatus(row)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
