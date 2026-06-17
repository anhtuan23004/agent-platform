import type { IngestionDomainConfig } from '@seta/ingestion';
import { describe, expect, it } from 'vitest';
import type { TableMapping } from '../../src/backend/ingestion/map-columns.ts';
import { normalizeRows } from '../../src/backend/ingestion/normalize-rows.ts';
import type { ParsedSheet } from '../../src/backend/ingestion/parse-workbook.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSheet(name: string, headers: string[], data: string[][]): ParsedSheet {
  const rows = data.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = row[i] ?? '';
    });
    return record;
  });
  return {
    name,
    rowCount: rows.length,
    colCount: headers.length,
    headerRow: 1,
    headers,
    columns: headers.map((h, idx) => ({
      index: idx + 1,
      name: h,
      sampleValues: [],
      nonEmptyCount: rows.length,
      totalRowCount: rows.length,
    })),
    rows,
    sampleDataRows: rows.slice(0, 5),
    warnings: [],
  };
}

function makeMapping(
  tableId: string,
  sourceSheet: string,
  fields: Array<[string, string]>,
): TableMapping {
  return {
    tableId,
    sourceSheet,
    headerRow: 1,
    tableConfidence: 0.95,
    mappings: fields.map(([src, canonical]) => ({
      sourceColumn: src,
      canonicalField: canonical,
      confidence: 0.95,
      evidence: '',
      status: 'auto_accept' as const,
      scoringBreakdown: {
        headerSimilarity: 0.95,
        valuePattern: 0.9,
        dataType: 0.9,
        sheetContext: 0.9,
        crossSheet: 0.5,
        llmSemantic: 0.5,
      },
    })),
    unmappedRequired: [],
    ambiguous: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('normalizeRows', () => {
  it('uses a provided domain config for field data types', () => {
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
          duplicatePolicy: 'block',
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
    const sheet = makeSheet(
      'Attendance',
      ['Emp ID', 'Date', 'Hours'],
      [['E001', '2026-06-01', '8.5']],
    );
    const mapping = makeMapping('attendance', 'Attendance', [
      ['Emp ID', 'employee_id'],
      ['Date', 'work_date'],
      ['Hours', 'hours'],
    ]);

    const result = normalizeRows([sheet], [mapping], hrDomain);

    expect(result.errorCount).toBe(0);
    expect(result.tables.attendance?.[0]?.values.hours).toBe(8.5);
    expect(result.tables.attendance?.[0]?.values.work_date).toContain('2026-06-01');
  });

  it('normalizes standard RA rows with percentage conversion', () => {
    const sheet = makeSheet(
      'DS01',
      ['Member_ID', 'Project_ID', 'Alloc', 'Start', 'End'],
      [
        ['EMP001', 'PRJ-A', '50%', '2026-06-01', '2026-06-30'],
        ['EMP002', 'PRJ-B', '0.75', '2026-07-01', '2026-07-31'],
        ['EMP003', 'PRJ-C', '100', '2026-08-01', '2026-08-31'],
      ],
    );

    const mapping = makeMapping('resource_allocation', 'DS01', [
      ['Member_ID', 'member_id'],
      ['Project_ID', 'project_id'],
      ['Alloc', 'allocation_pct'],
      ['Start', 'start_date'],
      ['End', 'end_date'],
    ]);

    const result = normalizeRows([sheet], [mapping]);

    expect(result.rowCounts.resource_allocation).toBe(3);
    expect(result.errorCount).toBe(0);

    const rows = result.tables.resource_allocation;
    expect(rows?.[0]?.values.member_id).toBe('EMP001');
    expect(rows?.[0]?.values.allocation_pct).toBe(0.5); // 50% → 0.5
    expect(rows?.[1]?.values.allocation_pct).toBe(0.75); // 0.75 stays
    expect(rows?.[2]?.values.allocation_pct).toBe(1.0); // 100 → 1.0
  });

  it('normalizes timesheet rows with hours and dates', () => {
    const sheet = makeSheet(
      'DS02',
      ['Member_ID', 'Date', 'Hours', 'Category'],
      [
        ['EMP001', '2026-06-01', '8', 'Project'],
        ['EMP001', '2026-06-02', '7.5', 'Internal'],
      ],
    );

    const mapping = makeMapping('timesheet', 'DS02', [
      ['Member_ID', 'member_id'],
      ['Date', 'work_date'],
      ['Hours', 'logged_hours'],
      ['Category', 'log_category'],
    ]);

    const result = normalizeRows([sheet], [mapping]);

    expect(result.rowCounts.timesheet).toBe(2);
    const rows = result.tables.timesheet;
    expect(rows?.[0]?.values.logged_hours).toBe(8);
    expect(rows?.[1]?.values.logged_hours).toBe(7.5);
    expect(rows?.[0]?.values.log_category).toBe('Project');
    // Date should be ISO string
    expect(rows?.[0]?.values.work_date).toContain('2026-06-01');
  });

  it('handles mixed percentage formats correctly', () => {
    const sheet = makeSheet('RA', ['Pct'], [['50%'], ['50'], ['0.5']]);

    const mapping = makeMapping('resource_allocation', 'RA', [['Pct', 'allocation_pct']]);
    const result = normalizeRows([sheet], [mapping]);

    const rows = result.tables.resource_allocation;
    expect(rows?.[0]?.values.allocation_pct).toBe(0.5);
    expect(rows?.[1]?.values.allocation_pct).toBe(0.5); // 50 > 1.5 → 50/100
    expect(rows?.[2]?.values.allocation_pct).toBe(0.5);
  });

  it('records parse errors for unparseable values without dropping row', () => {
    const sheet = makeSheet(
      'DS02',
      ['Member_ID', 'Hours'],
      [
        ['EMP001', 'not_a_number'],
        ['EMP002', '8'],
      ],
    );

    const mapping = makeMapping('timesheet', 'DS02', [
      ['Member_ID', 'member_id'],
      ['Hours', 'logged_hours'],
    ]);

    const result = normalizeRows([sheet], [mapping]);

    expect(result.rowCounts.timesheet).toBe(2); // row still emitted
    expect(result.errorCount).toBe(1);

    const rows = result.tables.timesheet;
    expect(rows?.[0]?.values.logged_hours).toBeNull();
    expect(rows?.[0]?.parseErrors).toHaveLength(1);
    expect(rows?.[0]?.parseErrors[0]?.field).toBe('logged_hours');
    expect(rows?.[1]?.values.logged_hours).toBe(8);
  });

  it('skips completely empty rows', () => {
    const sheet = makeSheet(
      'DS01',
      ['Member_ID', 'Project_ID'],
      [
        ['EMP001', 'PRJ-A'],
        ['', ''],
        ['EMP002', 'PRJ-B'],
      ],
    );

    const mapping = makeMapping('resource_allocation', 'DS01', [
      ['Member_ID', 'member_id'],
      ['Project_ID', 'project_id'],
    ]);

    const result = normalizeRows([sheet], [mapping]);
    expect(result.rowCounts.resource_allocation).toBe(2);
  });

  it('handles boolean fields correctly', () => {
    const sheet = makeSheet(
      'DS04',
      ['Member_ID', 'Date', 'Type', 'Approved'],
      [
        ['EMP001', '2026-06-01', 'Annual Leave', 'TRUE'],
        ['EMP002', '2026-06-02', 'Public Holiday', 'no'],
      ],
    );

    const mapping = makeMapping('leave', 'DS04', [
      ['Member_ID', 'member_id'],
      ['Date', 'leave_date'],
      ['Type', 'leave_type'],
      ['Approved', 'approved'],
    ]);

    const result = normalizeRows([sheet], [mapping]);

    const rows = result.tables.leave;
    expect(rows?.[0]?.values.approved).toBe(true);
    expect(rows?.[1]?.values.approved).toBe(false);
  });

  it('preserves sourceRow number from original sheet', () => {
    const sheet = makeSheet('DS01', ['Member_ID'], [['EMP001'], ['EMP002'], ['EMP003']]);
    sheet.headerRow = 2; // simulate header at row 2

    const mapping = makeMapping('resource_allocation', 'DS01', [['Member_ID', 'member_id']]);
    mapping.headerRow = 2;

    const result = normalizeRows([sheet], [mapping]);
    const rows = result.tables.resource_allocation;
    // sourceRow = headerRow + rowIdx + 1 (1-indexed)
    expect(rows?.[0]?.sourceRow).toBe(3);
    expect(rows?.[1]?.sourceRow).toBe(4);
    expect(rows?.[2]?.sourceRow).toBe(5);
  });
});
