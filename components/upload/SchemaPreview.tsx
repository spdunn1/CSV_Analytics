'use client';

import type { CsvPreview, ColumnMapping } from '@/types/csv';

interface Props {
  preview: CsvPreview;
  mapping: ColumnMapping;
  onMappingChange: (m: ColumnMapping) => void;
  validationErrors: string[];
}

export function SchemaPreview({ preview, mapping, onMappingChange, validationErrors }: Props) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="font-semibold text-sm">File preview</h2>
        <span className="text-xs text-gray-500">
          ~{preview.rowCount.toLocaleString()} rows
          · {preview.detectedSampleRateHz} Hz
          · {preview.detectedInverterCount} inverter{preview.detectedInverterCount !== 1 ? 's' : ''}
          · {preview.detectedPhaseCount} phase{preview.detectedPhaseCount !== 1 ? 's' : ''}
          {preview.hasPmu ? ' · PMU detected' : ''}
        </span>
      </div>

      {validationErrors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 space-y-1">
          {validationErrors.map((e, i) => (
            <p key={i} className="text-xs text-red-700 dark:text-red-400">{e}</p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="text-xs w-full border-collapse">
          <thead>
            <tr>
              {preview.headers.map((h) => (
                <th
                  key={h}
                  className="text-left px-2 py-1 border-b border-gray-200 dark:border-gray-700 text-gray-500 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 10).map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                {preview.headers.map((h) => (
                  <td
                    key={h}
                    className="px-2 py-1 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap font-mono"
                  >
                    {row[h] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          Column mapping (auto-detected)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-gray-500 block mb-1">Timestamp column</label>
            <select
              className="input text-xs"
              value={mapping.timestamp}
              onChange={(e) => onMappingChange({ ...mapping, timestamp: e.target.value })}
            >
              {preview.headers.map((h) => <option key={h}>{h}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-2 text-gray-400">
          Detected {mapping.inverters.length} inverter{mapping.inverters.length !== 1 ? 's' : ''} with columns:
          {mapping.inverters.map((inv) => (
            <span key={inv.inverterId} className="ml-2 text-gray-600 dark:text-gray-300">
              Inv{inv.inverterId}: {[inv.phaseA_voltage, inv.phaseB_voltage, inv.phaseC_voltage].filter(Boolean).join(', ')}
            </span>
          ))}
        </p>
      </details>
    </div>
  );
}
