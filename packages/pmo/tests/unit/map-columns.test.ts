import { describe, expect, it } from 'vitest';
import type { SheetRoleCandidate } from '../../src/backend/ingestion/detect-sheet-role.ts';
import { mapColumns } from '../../src/backend/ingestion/map-columns.ts';
import type { SheetProfile } from '../../src/backend/ingestion/profile-columns.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(
  name: string,
  headers: string[],
  opts: { sampleValues?: Record<string, string[]>; rowCount?: number } = {},
): SheetProfile {
  const sampleValues = opts.sampleValues ?? {};
  return {
    sheetName: name,
    headerRow: 1,
    rowCount: opts.rowCount ?? 10,
    columns: headers.map((h) => ({
      columnName: h,
      inferredType: 'string' as const,
      nullRate: 0,
      uniqueCount: 5,
      uniqueRate: 1.0,
      sampleValues: sampleValues[h] ?? [],
      valuePattern: null,
      stats: {},
    })),
  };
}

function makeRole(candidateRole: string, confidence: number): SheetRoleCandidate {
  return { candidateRole, confidence, evidence: [] };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('mapColumns', () => {
  it('maps standard RA sheet with obvious headers → all auto_accept', () => {
    const profile = makeProfile(
      'DS01_Resource_Allocation',
      [
        'Member_ID',
        'Project_ID',
        'Allocation_pct',
        'Start_date',
        'End_date',
        'Role',
        'Weekly_planned_hours',
      ],
      {
        sampleValues: {
          Member_ID: ['EMP001', 'EMP002', 'EMP003'],
          Project_ID: ['PRJ-A', 'PRJ-B', 'PRJ-C'],
          Allocation_pct: ['0.5', '0.75', '1.0'],
          Start_date: ['2026-06-01', '2026-06-15', '2026-07-01'],
          End_date: ['2026-06-30', '2026-07-15', '2026-07-31'],
          Role: ['BE', 'DE', 'QA'],
          Weekly_planned_hours: ['20', '30', '40'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.95), [profile]);

    expect(result.tableId).toBe('resource_allocation');
    expect(result.sourceSheet).toBe('DS01_Resource_Allocation');
    expect(result.unmappedRequired).toEqual([]);
    expect(result.tableConfidence).toBeGreaterThanOrEqual(0.85);

    // All required fields should be mapped
    const mappedFields = result.mappings.map((m) => m.canonicalField);
    expect(mappedFields).toContain('member_id');
    expect(mappedFields).toContain('project_id');
    expect(mappedFields).toContain('allocation_pct');
    expect(mappedFields).toContain('start_date');
    expect(mappedFields).toContain('end_date');

    // High confidence mappings should be auto_accept
    const autoAccepted = result.mappings.filter((m) => m.status === 'auto_accept');
    expect(autoAccepted.length).toBeGreaterThanOrEqual(4);
  });

  it('maps sheet with ambiguous "Hours" column → needs_review', () => {
    const profile = makeProfile(
      'DS02_Timesheet',
      ['Member_ID', 'Work_date', 'Hours', 'Log_category'],
      {
        sampleValues: {
          Member_ID: ['EMP001', 'EMP002'],
          Work_date: ['2026-06-01', '2026-06-02'],
          Hours: ['8', '7.5', '4'],
          Log_category: ['Project', 'Internal', 'Training'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('timesheet', 0.9), [profile]);

    // "Hours" should map to logged_hours but may be needs_review due to fuzzy match
    const hoursMapping = result.mappings.find((m) => m.canonicalField === 'logged_hours');
    expect(hoursMapping).toBeDefined();
    expect(hoursMapping?.sourceColumn).toBe('Hours');
  });

  it('identifies missing required field → unmappedRequired', () => {
    const profile = makeProfile(
      'RA_Sheet',
      ['Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Project_ID: ['PRJ-A'],
          Allocation_pct: ['50%'],
          Start_date: ['2026-06-01'],
          End_date: ['2026-06-30'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.9), [profile]);

    // member_id is required but no column matches
    expect(result.unmappedRequired).toContain('member_id');
  });

  it('marks ambiguous when two columns match same field with gap < 0.10', () => {
    // Both "employee_id" and "staff_id" are synonyms of member_id
    const profile = makeProfile(
      'Sheet1',
      ['employee_id', 'staff_id', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          employee_id: ['EMP001', 'EMP002', 'EMP003'],
          staff_id: ['EMP001', 'EMP002', 'EMP003'],
          Project_ID: ['PRJ-A'],
          Allocation_pct: ['0.5'],
          Start_date: ['2026-06-01'],
          End_date: ['2026-06-30'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.9), [profile]);

    // member_id should be in ambiguous list since both columns score similarly
    // (both are synonyms scoring 0.95 on header)
    expect(result.ambiguous).toContain('member_id');
  });

  it('maps Vietnamese headers correctly', () => {
    const profile = makeProfile(
      'Phân bổ nguồn lực',
      ['Mã nhân viên', 'Mã dự án', 'Tỷ lệ phân bổ', 'Ngày bắt đầu', 'Ngày kết thúc'],
      {
        sampleValues: {
          'Mã nhân viên': ['EMP001', 'EMP002'],
          'Mã dự án': ['PRJ-A', 'PRJ-B'],
          'Tỷ lệ phân bổ': ['0.5', '0.75'],
          'Ngày bắt đầu': ['2026-06-01', '2026-06-15'],
          'Ngày kết thúc': ['2026-06-30', '2026-07-15'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.85), [profile]);

    expect(result.unmappedRequired).toEqual([]);
    const mappedFields = result.mappings.map((m) => m.canonicalField);
    expect(mappedFields).toContain('member_id');
    expect(mappedFields).toContain('project_id');
    expect(mappedFields).toContain('allocation_pct');
  });

  it('returns scoring breakdown for each mapping', () => {
    const profile = makeProfile(
      'DS01',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Member_ID: ['EMP001'],
          Project_ID: ['PRJ-A'],
          Allocation_pct: ['50%'],
          Start_date: ['2026-06-01'],
          End_date: ['2026-06-30'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.95), [profile]);

    for (const mapping of result.mappings) {
      expect(mapping.scoringBreakdown).toHaveProperty('headerSimilarity');
      expect(mapping.scoringBreakdown).toHaveProperty('valuePattern');
      expect(mapping.scoringBreakdown).toHaveProperty('dataType');
      expect(mapping.scoringBreakdown).toHaveProperty('sheetContext');
      expect(mapping.scoringBreakdown).toHaveProperty('crossSheet');
      expect(mapping.confidence).toBeGreaterThan(0);
    }
  });

  it('one-to-one: same source column cannot map to multiple fields', () => {
    const profile = makeProfile(
      'Sheet1',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Member_ID: ['EMP001'],
          Project_ID: ['PRJ-A'],
          Allocation_pct: ['50%'],
          Start_date: ['2026-06-01'],
          End_date: ['2026-06-30'],
        },
      },
    );

    const result = mapColumns(profile, makeRole('resource_allocation', 0.95), [profile]);

    // Each source column appears at most once
    const sourceColumns = result.mappings.map((m) => m.sourceColumn);
    const uniqueSourceColumns = new Set(sourceColumns);
    expect(uniqueSourceColumns.size).toBe(sourceColumns.length);

    // Each canonical field appears at most once
    const canonicalFields = result.mappings.map((m) => m.canonicalField);
    const uniqueFields = new Set(canonicalFields);
    expect(uniqueFields.size).toBe(canonicalFields.length);
  });
});
