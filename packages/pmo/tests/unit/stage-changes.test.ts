import type { IngestionDomainConfig } from '@seta/ingestion';
import { describe, expect, it } from 'vitest';
import {
  classifyRows,
  shouldBlockDuplicateInUpload,
} from '../../src/backend/ingestion/stage-changes.ts';

const hrDomain: IngestionDomainConfig = {
  domainId: 'hr',
  version: 'test',
  label: 'HR',
  tables: [
    {
      id: 'attendance',
      label: 'Attendance',
      description: 'Attendance records.',
      synonyms: ['attendance'],
      naturalKey: ['employee_id', 'work_date'],
      duplicatePolicy: 'allow',
      fields: [
        {
          name: 'employee_id',
          label: 'Employee ID',
          description: 'Employee identifier.',
          dataType: 'string',
          required: true,
          synonyms: ['emp id'],
        },
        {
          name: 'work_date',
          label: 'Work Date',
          description: 'Work date.',
          dataType: 'date',
          required: true,
          synonyms: ['date'],
        },
        {
          name: 'hours',
          label: 'Hours',
          description: 'Logged hours.',
          dataType: 'number',
          required: true,
          synonyms: ['hours'],
        },
      ],
    },
  ],
  referenceRules: [],
  validationRules: [],
  publishPolicy: { requireApproval: true, allowDirectPublish: false, mode: 'staged' },
};

describe('stage changes', () => {
  it('uses domain config natural keys and duplicate policy', () => {
    const staged = classifyRows(
      'attendance',
      '11111111-1111-1111-1111-111111111111',
      [
        {
          tableId: 'attendance',
          sourceRow: 2,
          values: { employee_id: 'E001', work_date: '2026-06-01', hours: 8 },
          parseErrors: [],
        },
        {
          tableId: 'attendance',
          sourceRow: 3,
          values: { employee_id: 'E001', work_date: '2026-06-01', hours: 7.5 },
          parseErrors: [],
        },
      ],
      [],
      hrDomain,
    );

    expect(staged[0]?.naturalKeyDisplay).toEqual({
      employee_id: 'E001',
      work_date: '2026-06-01',
    });
    expect(staged[1]?.changeType).toBe('duplicate_in_upload');
    expect(shouldBlockDuplicateInUpload('attendance', hrDomain)).toBe(false);
  });
});
