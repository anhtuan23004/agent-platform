import type { Column } from '@tanstack/react-table';

/** Plain-text label for column visibility toggles (function headers are not stringifiable). */
export function columnVisibilityLabel<TData>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta as { label?: string } | undefined;
  if (typeof meta?.label === 'string' && meta.label.length > 0) return meta.label;
  const header = column.columnDef.header;
  if (typeof header === 'string') return header;
  return column.id;
}
