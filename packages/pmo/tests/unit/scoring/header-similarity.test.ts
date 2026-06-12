import { describe, expect, it } from 'vitest';
import { getCanonicalTable } from '../../../src/backend/ingestion/canonical-schema.ts';
import { scoreHeaderSimilarity } from '../../../src/backend/ingestion/scoring/header-similarity.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getField(tableId: string, fieldName: string) {
  const table = getCanonicalTable(tableId);
  const field = table!.fields.find((f) => f.name === fieldName);
  return field!;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('scoreHeaderSimilarity', () => {
  describe('exact match', () => {
    it('"Member_ID" → member_id field → score 1.00', () => {
      const result = scoreHeaderSimilarity(
        'Member_ID',
        getField('resource_allocation', 'member_id'),
      );
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact');
    });

    it('"allocation_pct" → allocation_pct field → score 1.00', () => {
      const result = scoreHeaderSimilarity(
        'allocation_pct',
        getField('resource_allocation', 'allocation_pct'),
      );
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact');
    });
  });

  describe('synonym match', () => {
    it('"employee_id" → member_id field → score 0.95', () => {
      const result = scoreHeaderSimilarity(
        'employee_id',
        getField('resource_allocation', 'member_id'),
      );
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"Mã nhân viên" → member_id field → score 0.95 (Vietnamese)', () => {
      const result = scoreHeaderSimilarity(
        'Mã nhân viên',
        getField('resource_allocation', 'member_id'),
      );
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"actual_hours" → logged_hours field → score 0.95', () => {
      const result = scoreHeaderSimilarity('actual_hours', getField('timesheet', 'logged_hours'));
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });
  });

  describe('abbreviation expansion', () => {
    it('"Emp_ID" → member_id field → score 0.95 (matches emp_id synonym)', () => {
      const result = scoreHeaderSimilarity('Emp_ID', getField('resource_allocation', 'member_id'));
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"Emp_Name" → full_name via abbreviation expansion → score 0.90', () => {
      const result = scoreHeaderSimilarity('Emp_Name', getField('member_master', 'full_name'));
      // "emp name" → expanded to "employee name" → matches synonym "employee_name"
      expect(result.score).toBe(0.9);
      expect(result.method).toBe('abbreviation');
    });

    it('"Std_hours_week" → std_hours_week field → score 1.00 (exact after normalize)', () => {
      const result = scoreHeaderSimilarity(
        'Std_hours_week',
        getField('member_master', 'std_hours_week'),
      );
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact');
    });
  });

  describe('fuzzy match', () => {
    it('"Hours" → logged_hours field → partial match score', () => {
      const result = scoreHeaderSimilarity('Hours', getField('timesheet', 'logged_hours'));
      // "hours" matches synonym "hours" exactly
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"Work Type" → log_category field → fuzzy match', () => {
      const result = scoreHeaderSimilarity('Work Type', getField('timesheet', 'log_category'));
      // "work type" is a synonym
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"Random_Column" → any field → score 0.00', () => {
      const result = scoreHeaderSimilarity(
        'Random_Column',
        getField('resource_allocation', 'member_id'),
      );
      expect(result.score).toBe(0);
      expect(result.method).toBe('none');
    });

    it('"Project Name" → project_name field → exact match after normalize', () => {
      const result = scoreHeaderSimilarity(
        'Project Name',
        getField('project_master', 'project_name'),
      );
      expect(result.score).toBe(1.0);
      expect(result.method).toBe('exact');
    });
  });

  describe('edge cases', () => {
    it('empty header → score 0', () => {
      const result = scoreHeaderSimilarity('', getField('resource_allocation', 'member_id'));
      expect(result.score).toBe(0);
      expect(result.method).toBe('none');
    });

    it('handles special characters in header', () => {
      const result = scoreHeaderSimilarity(
        'Allocation_%',
        getField('resource_allocation', 'allocation_pct'),
      );
      // "allocation %" normalized matches synonym "allocation_%"
      expect(result.score).toBeGreaterThanOrEqual(0.55);
    });

    it('"Giờ thực tế" → logged_hours → score 0.95 (Vietnamese synonym)', () => {
      const result = scoreHeaderSimilarity('Giờ thực tế', getField('timesheet', 'logged_hours'));
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });

    it('"tỷ lệ phân bổ" → allocation_pct → score 0.95 (Vietnamese synonym)', () => {
      const result = scoreHeaderSimilarity(
        'tỷ lệ phân bổ',
        getField('resource_allocation', 'allocation_pct'),
      );
      expect(result.score).toBe(0.95);
      expect(result.method).toBe('synonym');
    });
  });
});
