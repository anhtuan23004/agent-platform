import { describe, expect, it } from 'vitest';
import { detectSheetRoles } from '../../src/backend/ingestion/detect-sheet-role.ts';
import type { SheetProfile } from '../../src/backend/ingestion/profile-columns.ts';

// ── Helper ───────────────────────────────────────────────────────────────────

function makeProfile(
  name: string,
  headers: string[],
  opts: { rowCount?: number; sampleValues?: Record<string, string[]> } = {},
): SheetProfile {
  const rowCount = opts.rowCount ?? 10;
  const sampleValues = opts.sampleValues ?? {};

  return {
    sheetName: name,
    headerRow: 1,
    rowCount,
    columns: headers.map((h, _idx) => ({
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('detectSheetRoles', () => {
  it('detects resource_allocation from DS01 sheet name + columns', () => {
    const profile = makeProfile(
      'DS01_Resource_Allocation',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Start_date: ['2026-06-01', '2026-06-15'],
          End_date: ['2026-06-30', '2026-07-15'],
          Allocation_pct: ['50%', '75%', '100%'],
        },
      },
    );

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate).not.toBeNull();
    expect(result!.topCandidate!.candidateRole).toBe('resource_allocation');
    expect(result!.topCandidate!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects resource_allocation from column set even with generic name', () => {
    const profile = makeProfile(
      'Data1',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Start_date: ['2026-06-01'],
          Allocation_pct: ['50%', '80%'],
        },
      },
    );

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate).not.toBeNull();
    expect(result!.topCandidate!.candidateRole).toBe('resource_allocation');
    // Lower confidence than named sheet, but still detected
    expect(result!.topCandidate!.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result!.topCandidate!.confidence).toBeLessThan(0.9);
  });

  it('detects timesheet from DS02 name', () => {
    const profile = makeProfile(
      'DS02_Timesheet_Log',
      ['Member_ID', 'Work_date', 'Logged_hours', 'Log_category'],
      {
        rowCount: 500,
        sampleValues: {
          Work_date: ['2026-06-01', '2026-06-02', '2026-06-03'],
          Logged_hours: ['8', '7.5', '4', '6'],
        },
      },
    );

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate).not.toBeNull();
    expect(result!.topCandidate!.candidateRole).toBe('timesheet');
    expect(result!.topCandidate!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detects member_master from Members sheet with member columns', () => {
    const profile = makeProfile('Members', ['Member_ID', 'Member_name', 'Email', 'Department'], {
      rowCount: 20,
      sampleValues: {
        Member_ID: ['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP005'],
        Email: ['a@test.com', 'b@test.com', 'c@test.com'],
      },
    });

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate).not.toBeNull();
    expect(result!.topCandidate!.candidateRole).toBe('member_master');
    expect(result!.topCandidate!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('returns null topCandidate for sheet with no matching columns', () => {
    const profile = makeProfile('Random', ['X_col', 'Y_col', 'Z_col'], {
      sampleValues: { X_col: ['abc'], Y_col: ['def'], Z_col: ['ghi'] },
    });

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate).toBeNull();
  });

  it('returns otherCandidates sorted by confidence', () => {
    const profile = makeProfile(
      'DS01_Resource_Allocation',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      {
        sampleValues: {
          Start_date: ['2026-06-01'],
          Allocation_pct: ['50%'],
        },
      },
    );

    const [result] = detectSheetRoles([profile]);
    expect(result!.otherCandidates.length).toBeGreaterThan(0);

    // Verify sorted descending
    for (let i = 1; i < result!.otherCandidates.length; i++) {
      expect(result!.otherCandidates[i]!.confidence).toBeLessThanOrEqual(
        result!.otherCandidates[i - 1]!.confidence,
      );
    }
  });

  it('handles multiple sheets and returns detection per sheet', () => {
    const sheets = [
      makeProfile('RA', ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'], {
        sampleValues: { Allocation_pct: ['50%'] },
      }),
      makeProfile('Timesheet', ['Member_ID', 'Work_date', 'Logged_hours'], {
        rowCount: 100,
        sampleValues: { Work_date: ['2026-06-01'], Logged_hours: ['8'] },
      }),
    ];

    const results = detectSheetRoles(sheets);
    expect(results).toHaveLength(2);
    expect(results[0]!.sheetName).toBe('RA');
    expect(results[1]!.sheetName).toBe('Timesheet');
    expect(results[0]!.topCandidate!.candidateRole).toBe('resource_allocation');
    expect(results[1]!.topCandidate!.candidateRole).toBe('timesheet');
  });

  it('provides evidence strings explaining the scoring', () => {
    const profile = makeProfile(
      'DS01_Resource_Allocation',
      ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
      { sampleValues: { Allocation_pct: ['50%'] } },
    );

    const [result] = detectSheetRoles([profile]);
    expect(result!.topCandidate!.evidence.length).toBeGreaterThan(0);
    expect(result!.topCandidate!.evidence.some((e) => e.includes('sheet name'))).toBe(true);
    expect(result!.topCandidate!.evidence.some((e) => e.includes('required fields'))).toBe(true);
  });
});
