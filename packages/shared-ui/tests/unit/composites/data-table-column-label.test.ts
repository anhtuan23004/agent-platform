import type { Column } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { columnVisibilityLabel } from '../../../src/composites/data-table-column-label';

function mockColumn(header: unknown, meta?: { label?: string }): Column<unknown, unknown> {
  return {
    id: 'status',
    columnDef: { header, meta },
  } as Column<unknown, unknown>;
}

describe('columnVisibilityLabel', () => {
  it('prefers meta.label over function headers', () => {
    expect(columnVisibilityLabel(mockColumn(() => 'ignored', { label: 'Busy rate' }))).toBe(
      'Busy rate',
    );
  });

  it('uses string headers when meta.label is absent', () => {
    expect(columnVisibilityLabel(mockColumn('Member'))).toBe('Member');
  });

  it('falls back to column id for function headers without meta.label', () => {
    expect(columnVisibilityLabel(mockColumn(() => 'Scope'))).toBe('status');
  });
});
