import { describe, expect, it } from 'vitest';
import { getCanonicalTable } from '../../../src/backend/ingestion/canonical-schema.ts';
import { scoreCrossSheet } from '../../../src/backend/ingestion/scoring/cross-sheet.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getField(tableId: string, fieldName: string) {
  return getCanonicalTable(tableId)!.fields.find((f) => f.name === fieldName)!;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('scoreCrossSheet', () => {
  describe('ID fields with master data', () => {
    it('95% overlap with member master → 1.00', () => {
      const columnValues = [
        'EMP001',
        'EMP002',
        'EMP003',
        'EMP004',
        'EMP005',
        'EMP006',
        'EMP007',
        'EMP008',
        'EMP009',
        'EMP010',
        'EMP011',
        'EMP012',
        'EMP013',
        'EMP014',
        'EMP015',
        'EMP016',
        'EMP017',
        'EMP018',
        'EMP019',
        'EMP020',
      ];
      const masterValues = [
        'EMP001',
        'EMP002',
        'EMP003',
        'EMP004',
        'EMP005',
        'EMP006',
        'EMP007',
        'EMP008',
        'EMP009',
        'EMP010',
        'EMP011',
        'EMP012',
        'EMP013',
        'EMP014',
        'EMP015',
        'EMP016',
        'EMP017',
        'EMP018',
        'EMP019',
        'EMP020',
        'EMP021',
      ];

      const result = scoreCrossSheet(
        columnValues,
        getField('resource_allocation', 'member_id'),
        masterValues,
      );
      expect(result.score).toBe(1.0);
    });

    it('50% overlap → 0.50', () => {
      const columnValues = ['EMP001', 'EMP002', 'X001', 'X002'];
      const masterValues = ['EMP001', 'EMP002', 'EMP003', 'EMP004'];

      const result = scoreCrossSheet(
        columnValues,
        getField('resource_allocation', 'member_id'),
        masterValues,
      );
      expect(result.score).toBe(0.5);
    });

    it('0% overlap → 0.10', () => {
      const columnValues = ['X001', 'X002', 'X003'];
      const masterValues = ['EMP001', 'EMP002', 'EMP003'];

      const result = scoreCrossSheet(
        columnValues,
        getField('resource_allocation', 'member_id'),
        masterValues,
      );
      expect(result.score).toBe(0.1);
    });

    it('case-insensitive matching', () => {
      const columnValues = ['emp001', 'EMP002', 'Emp003'];
      const masterValues = ['EMP001', 'EMP002', 'EMP003'];

      const result = scoreCrossSheet(
        columnValues,
        getField('resource_allocation', 'member_id'),
        masterValues,
      );
      expect(result.score).toBe(1.0);
    });

    it('project_id cross-reference works', () => {
      const columnValues = ['PRJ-A', 'PRJ-B', 'PRJ-C'];
      const masterValues = ['PRJ-A', 'PRJ-B', 'PRJ-C', 'PRJ-D'];

      const result = scoreCrossSheet(
        columnValues,
        getField('resource_allocation', 'project_id'),
        masterValues,
      );
      expect(result.score).toBe(1.0);
    });
  });

  describe('no master sheet available', () => {
    it('null master values → neutral 0.50', () => {
      const result = scoreCrossSheet(
        ['EMP001', 'EMP002'],
        getField('resource_allocation', 'member_id'),
        null,
      );
      expect(result.score).toBe(0.5);
      expect(result.details).toContain('not available');
    });

    it('empty master values → neutral 0.50', () => {
      const result = scoreCrossSheet(
        ['EMP001', 'EMP002'],
        getField('resource_allocation', 'member_id'),
        [],
      );
      expect(result.score).toBe(0.5);
    });
  });

  describe('non-ID fields', () => {
    it('date field → neutral 0.50 (no cross-sheet signal)', () => {
      const result = scoreCrossSheet(
        ['2026-06-01', '2026-06-02'],
        getField('resource_allocation', 'start_date'),
        ['2026-06-01', '2026-06-30'],
      );
      expect(result.score).toBe(0.5);
    });

    it('allocation_pct → neutral 0.50', () => {
      const result = scoreCrossSheet(
        ['50%', '75%'],
        getField('resource_allocation', 'allocation_pct'),
        null,
      );
      expect(result.score).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('empty column values → score 0', () => {
      const result = scoreCrossSheet([], getField('resource_allocation', 'member_id'), [
        'EMP001',
        'EMP002',
      ]);
      expect(result.score).toBe(0);
    });

    it('all whitespace values → score 0', () => {
      const result = scoreCrossSheet(
        ['  ', '', '  '],
        getField('resource_allocation', 'member_id'),
        ['EMP001'],
      );
      expect(result.score).toBe(0);
    });
  });
});
