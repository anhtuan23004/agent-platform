import { describe, expect, it } from 'vitest';
import {
  buildSynonymIndex,
  getCanonicalTable,
  getRequiredFields,
  PMO_CANONICAL_SCHEMA,
} from '../../src/backend/ingestion/canonical-schema.ts';

describe('canonical-schema', () => {
  describe('getCanonicalTable', () => {
    it('returns table by id', () => {
      const table = getCanonicalTable('resource_allocation');
      expect(table).toBeDefined();
      expect(table!.id).toBe('resource_allocation');
    });

    it('returns undefined for unknown table', () => {
      expect(getCanonicalTable('nonexistent')).toBeUndefined();
    });
  });

  describe('getRequiredFields', () => {
    it('returns 5 required fields for resource_allocation', () => {
      const fields = getRequiredFields('resource_allocation');
      expect(fields).toHaveLength(5);
      const names = fields.map((f) => f.name);
      expect(names).toContain('member_id');
      expect(names).toContain('project_id');
      expect(names).toContain('allocation_pct');
      expect(names).toContain('start_date');
      expect(names).toContain('end_date');
    });

    it('returns 3 required fields for timesheet', () => {
      const fields = getRequiredFields('timesheet');
      expect(fields).toHaveLength(3);
      const names = fields.map((f) => f.name);
      expect(names).toContain('member_id');
      expect(names).toContain('work_date');
      expect(names).toContain('logged_hours');
    });

    it('returns required fields for calendar_weeks', () => {
      const fields = getRequiredFields('calendar_weeks');
      expect(fields).toHaveLength(4);
      const names = fields.map((f) => f.name);
      expect(names).toContain('week_id');
      expect(names).toContain('week_start');
      expect(names).toContain('week_end');
      expect(names).toContain('working_days');
    });

    it('returns empty array for unknown table', () => {
      expect(getRequiredFields('nonexistent')).toEqual([]);
    });
  });

  describe('synonyms', () => {
    it('all required fields have at least 3 synonyms', () => {
      for (const table of PMO_CANONICAL_SCHEMA.tables) {
        for (const field of table.fields) {
          if (field.required) {
            expect(
              field.synonyms.length,
              `${table.id}.${field.name} has only ${field.synonyms.length} synonyms`,
            ).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });

    it('no duplicate synonyms within same field', () => {
      for (const table of PMO_CANONICAL_SCHEMA.tables) {
        for (const field of table.fields) {
          const normalized = field.synonyms.map((s) => s.toLowerCase().replace(/[_\- ]/g, ''));
          const unique = new Set(normalized);
          expect(unique.size, `${table.id}.${field.name} has duplicate synonyms`).toBe(
            normalized.length,
          );
        }
      }
    });
  });

  describe('buildSynonymIndex', () => {
    it('returns complete index with entries for all fields', () => {
      const index = buildSynonymIndex();
      expect(index.entries.size).toBeGreaterThan(0);

      // Check a known synonym resolves
      const memberEntries = index.entries.get('employee id');
      expect(memberEntries).toBeDefined();
      expect(memberEntries!.some((e) => e.fieldName === 'member_id')).toBe(true);
    });

    it('maps Vietnamese synonyms correctly', () => {
      const index = buildSynonymIndex();
      const entries = index.entries.get('mã nhân viên');
      expect(entries).toBeDefined();
      expect(entries!.some((e) => e.fieldName === 'member_id')).toBe(true);
    });

    it('allows shared synonyms across fields in different tables', () => {
      const index = buildSynonymIndex();
      // "member_id" appears in multiple tables
      const entries = index.entries.get('member id');
      expect(entries!.length).toBeGreaterThan(1);
    });
  });
});
