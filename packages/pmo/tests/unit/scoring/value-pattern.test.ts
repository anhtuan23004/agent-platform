import { describe, expect, it } from 'vitest';
import { getCanonicalTable } from '../../../src/backend/ingestion/canonical-schema.ts';
import type { ColumnProfile } from '../../../src/backend/ingestion/profile-columns.ts';
import { scoreValuePattern } from '../../../src/backend/ingestion/scoring/value-pattern.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getField(tableId: string, fieldName: string) {
  const table = getCanonicalTable(tableId);
  return table!.fields.find((f) => f.name === fieldName)!;
}

function makeProfile(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    columnName: 'test',
    inferredType: 'string',
    nullRate: 0,
    uniqueCount: 5,
    uniqueRate: 1.0,
    sampleValues: [],
    valuePattern: null,
    stats: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('scoreValuePattern', () => {
  describe('allocation_pct (percentage)', () => {
    it('scores ≥ 0.90 for columns with % symbol values', () => {
      const values = ['50%', '75%', '100%', '25%', '80%'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    it('scores ≥ 0.80 for columns with decimal ratio values (no %)', () => {
      const values = ['0.5', '0.75', '1.0', '0.25', '0.8'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    });

    it('scores ≥ 0.80 for columns with integer-like percentages', () => {
      const values = ['50', '75', '100', '25', '80'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      // These are > 1.5 so treated as percentages (50→0.5)
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    });

    it('scores ≤ 0.30 for non-percentage values', () => {
      const values = ['abc', 'def', '123abc', 'hello'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      expect(result.score).toBeLessThanOrEqual(0.3);
    });
  });

  describe('logged_hours (number)', () => {
    it('scores ≥ 0.85 for typical daily hour values', () => {
      const values = ['8', '7.5', '4', '6', '8', '3.5'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('timesheet', 'logged_hours'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.85);
    });

    it('scores lower for values outside daily range', () => {
      const values = ['100', '200', '300', '400'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('timesheet', 'logged_hours'),
        values,
      );
      // Numeric but not daily range
      expect(result.score).toBeLessThan(0.85);
    });

    it('scores 0 for non-numeric values', () => {
      const values = ['abc', 'xyz', 'hello'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('timesheet', 'logged_hours'),
        values,
      );
      expect(result.score).toBeLessThanOrEqual(0.1);
    });
  });

  describe('date fields', () => {
    it('scores ≥ 0.90 for ISO date columns', () => {
      const values = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    it('scores ≥ 0.90 for slash date columns', () => {
      const values = ['01/06/2026', '02/06/2026', '15/07/2026'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    it('scores low for non-date strings', () => {
      const values = ['hello', 'world', 'foo', 'bar'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBeLessThanOrEqual(0.2);
    });
  });

  describe('log_category (enum)', () => {
    it('scores ≥ 0.85 for low cardinality string columns', () => {
      const values = ['Project', 'Internal', 'Training', 'Project', 'Internal', 'Admin', 'Project'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('timesheet', 'log_category'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.85);
    });

    it('scores lower for high cardinality columns', () => {
      const values = Array.from({ length: 50 }, (_, i) => `unique_value_${i}`);
      const result = scoreValuePattern(
        makeProfile(),
        getField('timesheet', 'log_category'),
        values,
      );
      expect(result.score).toBeLessThan(0.85);
    });
  });

  describe('member_id (string ID)', () => {
    it('scores high for consistent ID-like values', () => {
      const values = ['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP005'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'member_id'),
        values,
      );
      expect(result.score).toBeGreaterThanOrEqual(0.8);
    });

    it('scores lower for inconsistent mixed values', () => {
      const values = ['abc', '123', 'EMP001', 'xyz', '2026-01-01'];
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'member_id'),
        values,
      );
      expect(result.score).toBeLessThan(0.8);
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty values array', () => {
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'member_id'),
        [],
      );
      expect(result.score).toBe(0);
    });

    it('returns 0 for all-empty values', () => {
      const result = scoreValuePattern(
        makeProfile(),
        getField('resource_allocation', 'member_id'),
        ['', '', ''],
      );
      expect(result.score).toBe(0);
    });
  });
});
