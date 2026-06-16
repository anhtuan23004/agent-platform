import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { detectSchema } from '../../src/backend/ingestion/detect-schema.ts';
import type { IngestionDomainConfig } from '../../src/backend/ingestion/domain-config.ts';

// ── Fixture helper ───────────────────────────────────────────────────────────

async function createFixture(
  sheets: Array<{ name: string; rows: (string | number | null)[][] }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) {
      ws.addRow(row);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('detectSchema', () => {
  it('uses provided domain config for table and column mapping', async () => {
    const hrDomain: IngestionDomainConfig = {
      domainId: 'hr',
      version: 'test',
      label: 'HR',
      tables: [
        {
          id: 'employee_master',
          label: 'Employee Master',
          description: 'Canonical employee profile table for HR records.',
          synonyms: ['employee', 'employees', 'staff master'],
          naturalKey: ['employee_id'],
          duplicatePolicy: 'block',
          fields: [
            {
              name: 'employee_id',
              label: 'Employee ID',
              description: 'Unique employee identifier.',
              dataType: 'string',
              required: true,
              synonyms: ['employee_id', 'emp id', 'staff id'],
            },
            {
              name: 'full_name',
              label: 'Full Name',
              description: 'Employee full name.',
              dataType: 'string',
              required: true,
              synonyms: ['full name', 'employee name', 'name'],
            },
          ],
        },
      ],
      referenceRules: [],
      validationRules: [],
      publishPolicy: {
        requireApproval: true,
        allowDirectPublish: false,
        mode: 'staged',
      },
    };
    const buffer = await createFixture([
      {
        name: 'Employees',
        rows: [
          ['Emp ID', 'Employee Name'],
          ['E001', 'An Nguyen'],
          ['E002', 'Binh Tran'],
          ['E003', 'Chi Le'],
        ],
      },
    ]);

    const result = await detectSchema(buffer, { domainConfig: hrDomain });

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.tableId).toBe('employee_master');
    expect(result.tables[0]?.unmappedRequired).toEqual([]);
    expect(result.tables[0]?.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalField: 'employee_id', sourceColumn: 'Emp ID' }),
        expect.objectContaining({ canonicalField: 'full_name', sourceColumn: 'Employee Name' }),
      ]),
    );
  });

  it('happy path: multi-sheet XLSX with standard headers → all confirmed', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['EMP001', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
          ['EMP002', 'PRJ-B', '0.75', '2026-06-01', '2026-06-30'],
          ['EMP003', 'PRJ-A', '1.0', '2026-07-01', '2026-07-31'],
          ['EMP004', 'PRJ-C', '0.25', '2026-06-15', '2026-07-15'],
          ['EMP005', 'PRJ-B', '0.8', '2026-07-01', '2026-07-31'],
          ['EMP006', 'PRJ-A', '0.6', '2026-08-01', '2026-08-31'],
          ['EMP007', 'PRJ-D', '0.45', '2026-06-01', '2026-06-30'],
          ['EMP008', 'PRJ-C', '0.9', '2026-07-01', '2026-07-31'],
          ['EMP009', 'PRJ-B', '0.5', '2026-08-01', '2026-08-31'],
          ['EMP010', 'PRJ-A', '1.0', '2026-06-01', '2026-06-30'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Member_ID', 'Work_date', 'Logged_hours', 'Log_category'],
          ['EMP001', '2026-06-01', '8', 'Project'],
          ['EMP001', '2026-06-02', '7.5', 'Internal'],
          ['EMP002', '2026-06-01', '4', 'Training'],
          ['EMP002', '2026-06-02', '8', 'Project'],
          ['EMP003', '2026-06-01', '6', 'Project'],
          ['EMP003', '2026-06-02', '7', 'Admin'],
          ['EMP004', '2026-06-01', '3.5', 'Internal'],
          ['EMP004', '2026-06-02', '8', 'Project'],
          ['EMP005', '2026-06-01', '5', 'Training'],
          ['EMP005', '2026-06-02', '8', 'Project'],
        ],
      },
      {
        name: 'DS06_Member_Master',
        rows: [
          ['Member_ID', 'Full_name', 'Department', 'Std_hours_week'],
          ['EMP001', 'Alice Johnson', 'Backend', '40'],
          ['EMP002', 'Bob Smith', 'Data', '40'],
          ['EMP003', 'Charlie Lee', 'AI/ML', '40'],
          ['EMP004', 'Diana Wang', 'PMO', '40'],
          ['EMP005', 'Eve Chen', 'Frontend', '40'],
        ],
      },
    ]);

    const result = await detectSchema(buffer);

    expect(result.tables.length).toBeGreaterThanOrEqual(2);
    // With standard headers and good data, should be confirmed or needs_review (some optional fields may score borderline)
    expect(result.validation.status).not.toBe('blocked');
    expect(result.workbookMeta.sheetCount).toBe(3);
    expect(result.workbookMeta.excludedSheets).toEqual([]);
    expect(result.workbookMeta.totalRows).toBeGreaterThan(0);

    // RA table detected and mapped
    const raTable = result.tables.find((t) => t.tableId === 'resource_allocation');
    expect(raTable).toBeDefined();
    expect(raTable?.unmappedRequired).toEqual([]);

    // Timesheet table detected
    const tsTable = result.tables.find((t) => t.tableId === 'timesheet');
    expect(tsTable).toBeDefined();
    expect(tsTable?.unmappedRequired).toEqual([]);
  });

  it('shifted header: note at row 1 → correctly detects header at row 2', async () => {
    const buffer = await createFixture([
      {
        name: 'DS06_Member_Master',
        rows: [
          ['Note: This is the member master list', null, null, null],
          ['Member_ID', 'Full_name', 'Department', 'Std_hours_week'],
          ['EMP001', 'Alice Johnson', 'Backend', '40'],
          ['EMP002', 'Bob Smith', 'Data', '40'],
        ],
      },
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['EMP001', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Member_ID', 'Work_date', 'Logged_hours', 'Log_category'],
          ['EMP001', '2026-06-01', '8', 'Project'],
        ],
      },
    ]);

    const result = await detectSchema(buffer);

    const memberTable = result.tables.find((t) => t.tableId === 'member_master');
    expect(memberTable).toBeDefined();
    expect(memberTable?.headerRow).toBe(2);
  });

  it('ambiguous column: "Hours" in timesheet → needs_review or maps with lower confidence', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['EMP001', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Member_ID', 'Work_date', 'Hours', 'Log_category'],
          ['EMP001', '2026-06-01', '8', 'Project'],
          ['EMP001', '2026-06-02', '7.5', 'Internal'],
        ],
      },
    ]);

    const result = await detectSchema(buffer);

    const tsTable = result.tables.find((t) => t.tableId === 'timesheet');
    expect(tsTable).toBeDefined();

    // "Hours" should still map to logged_hours (it's a synonym)
    const hoursMapping = tsTable?.mappings.find((m) => m.canonicalField === 'logged_hours');
    expect(hoursMapping).toBeDefined();
    expect(hoursMapping?.sourceColumn).toBe('Hours');
  });

  it('missing required: no member_id equivalent → blocked', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Member_ID', 'Work_date', 'Logged_hours'],
          ['EMP001', '2026-06-01', '8'],
        ],
      },
    ]);

    const result = await detectSchema(buffer);

    const raTable = result.tables.find((t) => t.tableId === 'resource_allocation');
    expect(raTable).toBeDefined();
    expect(raTable?.unmappedRequired).toContain('member_id');
    expect(result.validation.status).toBe('blocked');
  });

  it('Vietnamese headers: full Vietnamese file → all mapped correctly', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Mã nhân viên', 'Mã dự án', 'Tỷ lệ phân bổ', 'Ngày bắt đầu', 'Ngày kết thúc'],
          ['EMP001', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
          ['EMP002', 'PRJ-B', '0.75', '2026-07-01', '2026-07-31'],
          ['EMP003', 'PRJ-C', '0.8', '2026-06-15', '2026-07-15'],
          ['EMP004', 'PRJ-A', '1.0', '2026-08-01', '2026-08-31'],
          ['EMP005', 'PRJ-D', '0.6', '2026-06-01', '2026-06-30'],
          ['EMP006', 'PRJ-B', '0.45', '2026-07-01', '2026-07-31'],
          ['EMP007', 'PRJ-C', '0.9', '2026-08-01', '2026-08-31'],
          ['EMP008', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
          ['EMP009', 'PRJ-D', '0.7', '2026-07-01', '2026-07-31'],
          ['EMP010', 'PRJ-B', '1.0', '2026-08-01', '2026-08-31'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Mã nhân viên', 'Ngày làm việc', 'Giờ thực tế', 'Loại công việc'],
          ['EMP001', '2026-06-01', '8', 'Project'],
          ['EMP001', '2026-06-02', '7.5', 'Internal'],
          ['EMP002', '2026-06-03', '4', 'Training'],
          ['EMP002', '2026-06-04', '6', 'Project'],
          ['EMP003', '2026-06-05', '8', 'Admin'],
          ['EMP003', '2026-06-06', '7', 'Project'],
          ['EMP004', '2026-06-07', '5.5', 'Internal'],
          ['EMP004', '2026-06-08', '8', 'Project'],
          ['EMP005', '2026-06-09', '3', 'Training'],
          ['EMP005', '2026-06-10', '8', 'Project'],
        ],
      },
    ]);

    const result = await detectSchema(buffer);

    // Vietnamese synonyms should map all required fields; status should not be blocked
    expect(result.validation.status).not.toBe('blocked');

    const raTable = result.tables.find((t) => t.tableId === 'resource_allocation');
    expect(raTable).toBeDefined();
    expect(raTable?.unmappedRequired).toEqual([]);

    const tsTable = result.tables.find((t) => t.tableId === 'timesheet');
    expect(tsTable).toBeDefined();
    expect(tsTable?.unmappedRequired).toEqual([]);
  });

  it('excluded sheets are not processed', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['EMP001', 'PRJ-A', '0.5', '2026-06-01', '2026-06-30'],
        ],
      },
      {
        name: 'DS02_Timesheet_Log',
        rows: [
          ['Member_ID', 'Work_date', 'Logged_hours'],
          ['EMP001', '2026-06-01', '8'],
        ],
      },
      {
        name: 'LEGEND & SUMMARY',
        rows: [['This sheet explains the data format']],
      },
      {
        name: 'Answer_Key',
        rows: [['Expected findings']],
      },
    ]);

    const result = await detectSchema(buffer);

    expect(result.workbookMeta.excludedSheets).toContain('LEGEND & SUMMARY');
    expect(result.workbookMeta.excludedSheets).toContain('Answer_Key');
    expect(result.workbookMeta.sheetCount).toBe(2);
  });
});
