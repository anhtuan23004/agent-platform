import type { BlockProps } from './types';

interface DataQualityReviewColumn {
  key: string;
  label: string;
}

interface DataQualityReviewRow {
  id: string;
  tableId: string;
  sourceRow: number;
  status: string;
  issueLabel: string;
  issueDetail: string;
  values: Record<string, unknown>;
  columns?: DataQualityReviewColumn[];
}

function isDataQualityReviewBlock(block: BlockProps['block']): block is {
  kind: 'dataQualityReview';
  columns: DataQualityReviewColumn[];
  rows: DataQualityReviewRow[];
} {
  return (
    block.kind === 'dataQualityReview' &&
    Array.isArray((block as { columns?: unknown }).columns) &&
    Array.isArray((block as { rows?: unknown }).rows)
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function DataQualityReviewBlock({ block }: BlockProps) {
  if (!isDataQualityReviewBlock(block)) return null;
  const visibleColumns = (block.rows[0]?.columns ?? block.columns).slice(0, 6);

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface-1">
      <table className="min-w-full text-left text-caption">
        <thead className="border-b border-hairline bg-surface-2 text-ink-subtle">
          <tr>
            <th className="px-2 py-1.5 font-medium">Table</th>
            <th className="px-2 py-1.5 font-medium">Row</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            {visibleColumns.map((column) => (
              <th key={column.key} className="px-2 py-1.5 font-medium">
                {column.label}
              </th>
            ))}
            <th className="px-2 py-1.5 font-medium">Issue</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.slice(0, 12).map((row) => (
            <tr key={row.id} className="border-b border-hairline last:border-b-0">
              <td className="px-2 py-1.5 font-medium text-ink">{row.tableId}</td>
              <td className="px-2 py-1.5 text-ink-subtle">{row.sourceRow}</td>
              <td className="px-2 py-1.5 text-ink-subtle">{row.status}</td>
              {visibleColumns.map((column) => (
                <td key={`${row.id}-${column.key}`} className="px-2 py-1.5 text-ink">
                  {displayValue(row.values[column.key])}
                </td>
              ))}
              <td className="px-2 py-1.5 text-ink-subtle">{row.issueDetail || row.issueLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {block.rows.length > 12 ? (
        <p className="border-t border-hairline px-2 py-1.5 text-caption text-ink-subtle">
          Showing 12 of {block.rows.length} issue rows.
        </p>
      ) : null}
    </div>
  );
}
