import { describe, expect, it } from 'vitest';
import { getCanonicalTable } from '../../../src/backend/ingestion/canonical-schema.ts';
import type { ColumnProfile } from '../../../src/backend/ingestion/profile-columns.ts';
import { scoreDataType } from '../../../src/backend/ingestion/scoring/data-type.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getField(tableId: string, fieldName: string) {
  return getCanonicalTable(tableId)!.fields.find((f) => f.name === fieldName)!;
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

describe('scoreDataType', () => {
  describe('number fields', () => {
    it('all numeric column → number field → 1.00', () => {
      const values = ['8', '7.5', '4', '6', '3.5'];
      const result = scoreDataType(makeProfile(), getField('timesheet', 'logged_hours'), values);
      expect(result.score).toBe(1.0);
      expect(result.blocked).toBe(false);
    });

    it('mixed text/number → number field → 0.30 or 0.60', () => {
      const values = ['8', 'N/A', '4', 'skip', '6', '7', '3', 'none', '5', '2'];
      const result = scoreDataType(makeProfile(), getField('timesheet', 'logged_hours'), values);
      // 7/10 numeric = 70% → score 0.6
      expect(result.score).toBe(0.6);
      expect(result.blocked).toBe(false);
    });

    it('mostly non-numeric → required number field → blocked', () => {
      const values = ['abc', 'def', 'ghi', 'jkl', '5'];
      const result = scoreDataType(makeProfile(), getField('timesheet', 'logged_hours'), values);
      // 1/5 = 20% < 50% → blocked (logged_hours is required)
      expect(result.score).toBe(0.0);
      expect(result.blocked).toBe(true);
    });
  });

  describe('date fields', () => {
    it('90% parseable dates → date field → 0.80', () => {
      const values = [
        '2026-06-01',
        '2026-06-02',
        '2026-06-03',
        '2026-06-04',
        '2026-06-05',
        '2026-06-06',
        '2026-06-07',
        '2026-06-08',
        '2026-06-09',
        'invalid',
      ];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBe(0.8);
      expect(result.blocked).toBe(false);
    });

    it('all valid dates → 1.00', () => {
      const values = ['2026-06-01', '2026-07-15', '2026-08-30'];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBe(1.0);
    });

    it('slash format dates → accepted', () => {
      const values = ['01/06/2026', '15/07/2026', '30/08/2026'];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'start_date'),
        values,
      );
      expect(result.score).toBe(1.0);
    });
  });

  describe('percentage fields', () => {
    it('all percentage values → 1.00', () => {
      const values = ['50%', '75%', '100%', '25%'];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      expect(result.score).toBe(1.0);
    });

    it('decimal ratios accepted as percentage', () => {
      const values = ['0.5', '0.75', '1.0', '0.25'];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'allocation_pct'),
        values,
      );
      expect(result.score).toBe(1.0);
    });
  });

  describe('boolean fields', () => {
    it('yes/no column → boolean field → 1.00', () => {
      const values = ['yes', 'no', 'yes', 'yes', 'no'];
      const result = scoreDataType(makeProfile(), getField('leave', 'approved'), values);
      expect(result.score).toBe(1.0);
    });

    it('TRUE/FALSE → 1.00', () => {
      const values = ['TRUE', 'FALSE', 'TRUE', 'TRUE'];
      const result = scoreDataType(makeProfile(), getField('leave', 'approved'), values);
      expect(result.score).toBe(1.0);
    });
  });

  describe('string fields', () => {
    it('any values → string field → 1.00', () => {
      const values = ['hello', '123', '2026-01-01', 'anything'];
      const result = scoreDataType(
        makeProfile(),
        getField('resource_allocation', 'member_id'),
        values,
      );
      expect(result.score).toBe(1.0);
      expect(result.blocked).toBe(false);
    });
  });

  describe('enum fields', () => {
    it('text categories → enum field → high score', () => {
      const values = ['Project', 'Internal', 'Training', 'Admin'];
      const result = scoreDataType(makeProfile(), getField('timesheet', 'log_category'), values);
      expect(result.score).toBe(1.0);
    });

    it('numeric-only values → enum field → low score', () => {
      const values = ['1', '2', '3', '4', '5'];
      const result = scoreDataType(makeProfile(), getField('timesheet', 'log_category'), values);
      expect(result.score).toBe(0.0);
    });
  });

  describe('edge cases', () => {
    it('empty values → required field → blocked', () => {
      const result = scoreDataType(makeProfile(), getField('timesheet', 'logged_hours'), []);
      expect(result.score).toBe(0);
      expect(result.blocked).toBe(true);
    });

    it('empty values → optional field → not blocked', () => {
      const result = scoreDataType(makeProfile(), getField('timesheet', 'task_ref'), []);
      expect(result.score).toBe(0);
      expect(result.blocked).toBe(false);
    });

    it('all whitespace values treated as empty', () => {
      const result = scoreDataType(makeProfile(), getField('timesheet', 'logged_hours'), [
        '  ',
        '  ',
        '  ',
      ]);
      expect(result.score).toBe(0);
      expect(result.blocked).toBe(true);
    });
  });
});
