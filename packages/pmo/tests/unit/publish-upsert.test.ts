import { describe, expect, it } from 'vitest';
import { collectPublishValidationIssues } from '../../src/backend/ingestion/publish-upsert.ts';

describe('collectPublishValidationIssues', () => {
  it('reports missing required fields before publish', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'resource_allocation',
        natural_key_hash: 'abc123',
        change_type: 'new_record',
        new_values: {
          project_id: 'PRJ-001',
          allocation_pct: 0.5,
          start_date: '2026-06-01T00:00:00.000Z',
          end_date: '2026-06-30T00:00:00.000Z',
        },
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.tableId).toBe('resource_allocation');
    expect(issues[0]?.reason).toContain('member_id');
  });

  it('ignores exact duplicates and duplicate_in_upload rows', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'resource_allocation',
        natural_key_hash: 'skip-1',
        change_type: 'exact_duplicate',
        new_values: null,
      },
      {
        table_id: 'resource_allocation',
        natural_key_hash: 'skip-2',
        change_type: 'duplicate_in_upload',
        new_values: null,
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('reports unsupported table ids and malformed values', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'unknown_table',
        natural_key_hash: 'hash-1',
        change_type: 'new_record',
        new_values: {},
      },
      {
        table_id: 'timesheet',
        natural_key_hash: 'hash-2',
        change_type: 'updated_record',
        new_values: 'not-an-object',
      },
    ]);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.reason).toContain('unsupported table id');
    expect(issues[1]?.reason).toContain('new_values must be an object');
  });

  it('returns no issues when required fields are present', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'resource_allocation',
        natural_key_hash: 'ok-1',
        change_type: 'new_record',
        new_values: {
          member_id: 'EMP-001',
          project_id: 'PRJ-001',
          allocation_pct: 0.5,
          start_date: '2026-06-01T00:00:00.000Z',
          end_date: '2026-06-30T00:00:00.000Z',
        },
      },
      {
        table_id: 'timesheet',
        natural_key_hash: 'ok-2',
        change_type: 'updated_record',
        new_values: {
          member_id: 'EMP-001',
          work_date: '2026-06-10T00:00:00.000Z',
          logged_hours: 8,
        },
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('accepts project demand plan rows with the required fields', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'project_demand_plan',
        natural_key_hash: 'demand-ok-1',
        change_type: 'new_record',
        new_values: {
          demand_id: 'DEM-001',
          project_id: 'PRJ-001',
          role_needed: 'Designer',
          demand_start: '2026-08-01T00:00:00.000Z',
          demand_end: '2026-08-31T00:00:00.000Z',
        },
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('reports missing required fields for project demand plan rows', () => {
    const issues = collectPublishValidationIssues([
      {
        table_id: 'project_demand_plan',
        natural_key_hash: 'demand-bad-1',
        change_type: 'updated_record',
        new_values: {
          demand_id: 'DEM-001',
          role_needed: 'Designer',
          demand_end: '2026-08-31T00:00:00.000Z',
        },
      },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.tableId).toBe('project_demand_plan');
    expect(issues[0]?.reason).toContain('project_id');
    expect(issues[0]?.reason).toContain('demand_start');
  });
});
