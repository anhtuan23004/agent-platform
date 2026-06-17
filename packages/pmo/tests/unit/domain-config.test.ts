import { describe, expect, it } from 'vitest';
import { PMO_DOMAIN_CONFIG } from '../../src/backend/ingestion/pmo-domain-config.ts';

describe('PMO domain config', () => {
  it('derives PMO tables with natural keys from the canonical schema', () => {
    const resourceAllocation = PMO_DOMAIN_CONFIG.tables.find(
      (table) => table.id === 'resource_allocation',
    );
    const timesheet = PMO_DOMAIN_CONFIG.tables.find((table) => table.id === 'timesheet');

    expect(resourceAllocation?.naturalKey).toEqual([
      'member_id',
      'project_id',
      'start_date',
      'end_date',
    ]);
    expect(timesheet?.naturalKey).toEqual(['member_id', 'work_date', 'project_id', 'log_category']);
    expect(timesheet?.duplicatePolicy).toBe('skip');
  });

  it('declares PMO reference rules outside normalization handler code', () => {
    expect(PMO_DOMAIN_CONFIG.referenceRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTable: 'resource_allocation',
          sourceField: 'member_id',
          targetTable: 'member_master',
          targetField: 'member_id',
          blocking: true,
        }),
        expect.objectContaining({
          sourceTable: 'resource_allocation',
          sourceField: 'project_id',
          targetTable: 'project_master',
          targetField: 'project_id',
          blocking: true,
        }),
      ]),
    );
  });
});
