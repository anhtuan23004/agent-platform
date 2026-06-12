import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../../src/backend/ingestion/parse-workbook.ts';

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

describe('parseWorkbook', () => {
  it('parses simple RA file with header at row 1', async () => {
    const buffer = await createFixture([
      {
        name: 'DS01_Resource_Allocation',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date'],
          ['EMP001', 'PRJ-A', '50%', '2026-06-01', '2026-06-30'],
          ['EMP002', 'PRJ-B', '75%', '2026-06-01', '2026-06-30'],
          ['EMP003', 'PRJ-A', '100%', '2026-07-01', '2026-07-31'],
          ['EMP004', 'PRJ-C', '25%', '2026-06-15', '2026-07-15'],
          ['EMP005', 'PRJ-B', '80%', '2026-06-01', '2026-06-30'],
        ],
      },
    ]);

    const result = await parseWorkbook(buffer);

    expect(result.sheets).toHaveLength(1);
    expect(result.excludedSheets).toEqual([]);
    expect(result.parseErrors).toEqual([]);

    const sheet = result.sheets[0]!;
    expect(sheet.name).toBe('DS01_Resource_Allocation');
    expect(sheet.headerRow).toBe(1);
    expect(sheet.headers).toEqual([
      'Member_ID',
      'Project_ID',
      'Allocation_pct',
      'Start_date',
      'End_date',
    ]);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.colCount).toBe(5);
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.sampleDataRows).toHaveLength(5);
    expect(sheet.rows[0]?.Member_ID).toBe('EMP001');
    expect(sheet.rows[0]?.Allocation_pct).toBe('50%');
  });

  it('detects header at row 2 when row 1 is a note', async () => {
    const buffer = await createFixture([
      {
        name: 'DS06_Member_Master',
        rows: [
          ['Note: this is the member master list', null, null, null],
          ['Member_ID', 'Member_name', 'Email', 'Department'],
          ['EMP001', 'Alice Johnson', 'alice@test.com', 'Engineering'],
          ['EMP002', 'Bob Smith', 'bob@test.com', 'Design'],
        ],
      },
    ]);

    const result = await parseWorkbook(buffer);
    const sheet = result.sheets[0]!;

    expect(sheet.headerRow).toBe(2);
    expect(sheet.headers).toEqual(['Member_ID', 'Member_name', 'Email', 'Department']);
    expect(sheet.rowCount).toBe(2);
    expect(sheet.rows[0]?.Member_ID).toBe('EMP001');
  });

  it('parses multi-sheet workbook', async () => {
    const buffer = await createFixture([
      {
        name: 'RA',
        rows: [
          ['Member_ID', 'Project_ID', 'Allocation_pct'],
          ['EMP001', 'PRJ-A', '50%'],
        ],
      },
      {
        name: 'Timesheet',
        rows: [
          ['Member_ID', 'Work_date', 'Logged_hours'],
          ['EMP001', '2026-06-01', '8'],
          ['EMP001', '2026-06-02', '7.5'],
        ],
      },
      {
        name: 'Members',
        rows: [
          ['Member_ID', 'Member_name'],
          ['EMP001', 'Alice'],
        ],
      },
    ]);

    const result = await parseWorkbook(buffer);
    expect(result.sheets).toHaveLength(3);
    expect(result.sheets.map((s) => s.name)).toEqual(['RA', 'Timesheet', 'Members']);
  });

  it('excludes LEGEND and Answer_Key sheets', async () => {
    const buffer = await createFixture([
      {
        name: 'Data',
        rows: [
          ['Col_A', 'Col_B'],
          ['val1', 'val2'],
        ],
      },
      {
        name: 'LEGEND & SUMMARY',
        rows: [['This is a legend']],
      },
      {
        name: 'Answer_Key',
        rows: [['Answers']],
      },
    ]);

    const result = await parseWorkbook(buffer);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.name).toBe('Data');
    expect(result.excludedSheets).toContain('LEGEND & SUMMARY');
    expect(result.excludedSheets).toContain('Answer_Key');
  });

  it('handles empty sheet with warning', async () => {
    const buffer = await createFixture([
      {
        name: 'EmptySheet',
        rows: [],
      },
    ]);

    const result = await parseWorkbook(buffer);
    const sheet = result.sheets[0]!;
    expect(sheet.rowCount).toBe(0);
    expect(sheet.warnings).toContain('Empty sheet — no data detected');
  });

  it('skips blank rows and reports warning', async () => {
    const buffer = await createFixture([
      {
        name: 'WithBlanks',
        rows: [
          ['ID', 'Name'],
          ['1', 'Alice'],
          [null, null],
          ['2', 'Bob'],
          [null, null],
          ['3', 'Charlie'],
        ],
      },
    ]);

    const result = await parseWorkbook(buffer);
    const sheet = result.sheets[0]!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.rows[0]?.ID).toBe('1');
    expect(sheet.rows[1]?.ID).toBe('2');
    expect(sheet.rows[2]?.ID).toBe('3');
    expect(sheet.warnings.some((w) => w.includes('blank row'))).toBe(true);
  });

  it('builds column metadata with sample values', async () => {
    const buffer = await createFixture([
      {
        name: 'Data',
        rows: [
          ['Member_ID', 'Hours'],
          ['EMP001', '8'],
          ['EMP002', '7.5'],
          ['EMP003', ''],
          ['EMP004', '6'],
        ],
      },
    ]);

    const result = await parseWorkbook(buffer);
    const sheet = result.sheets[0]!;

    const memberCol = sheet.columns.find((c) => c.name === 'Member_ID')!;
    expect(memberCol.nonEmptyCount).toBe(4);
    expect(memberCol.sampleValues).toEqual(['EMP001', 'EMP002', 'EMP003', 'EMP004']);

    const hoursCol = sheet.columns.find((c) => c.name === 'Hours')!;
    expect(hoursCol.nonEmptyCount).toBe(3);
    expect(hoursCol.sampleValues).toEqual(['8', '7.5', '6']);
  });

  it('provides sampleDataRows as first 5 rows', async () => {
    const rows: (string | number | null)[][] = [['ID', 'Val']];
    for (let i = 1; i <= 10; i++) {
      rows.push([`R${i}`, `V${i}`]);
    }
    const buffer = await createFixture([{ name: 'Big', rows }]);

    const result = await parseWorkbook(buffer);
    const sheet = result.sheets[0]!;
    expect(sheet.rowCount).toBe(10);
    expect(sheet.sampleDataRows).toHaveLength(5);
    expect(sheet.sampleDataRows[0]?.ID).toBe('R1');
    expect(sheet.sampleDataRows[4]?.ID).toBe('R5');
  });
});
