import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { detectSchema } from '../../src/backend/ingestion/detect-schema.ts';
import { normalizeRows } from '../../src/backend/ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../src/backend/ingestion/parse-workbook.ts';

// ── Fixture helper ───────────────────────────────────────────────────────────

async function createFullFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // DS01_Resource_Allocation
  const ws1 = wb.addWorksheet('DS01_Resource_Allocation');
  ws1.addRow([
    'Member_ID',
    'Project_ID',
    'Role',
    'Allocation_pct',
    'Start_date',
    'End_date',
    'Weekly_planned_hours',
  ]);
  ws1.addRow(['EMP-001', 'PRJ-001', 'BE', '0.45', '2026-06-29', '2026-08-09', '18']);
  ws1.addRow(['EMP-001', 'PRJ-002', 'BE', '0.30', '2026-06-29', '2026-08-09', '12']);
  ws1.addRow(['EMP-002', 'PRJ-001', 'QA', '0.50', '2026-06-29', '2026-08-09', '20']);
  ws1.addRow(['EMP-003', 'PRJ-003', 'DE', '1.00', '2026-06-29', '2026-08-09', '40']);
  ws1.addRow(['EMP-004', 'PRJ-001', 'ML', '0.80', '2026-06-29', '2026-08-09', '32']);
  ws1.addRow(['EMP-004', 'PRJ-004', 'ML', '0.30', '2026-06-29', '2026-08-09', '12']);
  ws1.addRow(['EMP-005', 'PRJ-002', 'DevOps', '0.60', '2026-06-29', '2026-08-09', '24']);
  ws1.addRow(['EMP-006', 'PRJ-001', 'BE', '0.25', '2026-06-29', '2026-08-09', '10']);
  ws1.addRow(['EMP-007', 'PRJ-003', 'QA', '0.40', '2026-06-29', '2026-08-09', '16']);
  ws1.addRow(['EMP-008', 'PRJ-004', 'DE', '0.70', '2026-06-29', '2026-08-09', '28']);

  // DS02_Timesheet_Log
  const ws2 = wb.addWorksheet('DS02_Timesheet_Log');
  ws2.addRow(['Member_ID', 'Project_ID', 'Work_date', 'Logged_hours', 'Log_category', 'Task_ref']);
  ws2.addRow(['EMP-001', 'PRJ-001', '2026-06-30', '8', 'Project', 'TASK-101']);
  ws2.addRow(['EMP-001', 'PRJ-001', '2026-07-01', '7.5', 'Project', 'TASK-101']);
  ws2.addRow(['EMP-001', 'PRJ-002', '2026-07-01', '4', 'Project', 'TASK-201']);
  ws2.addRow(['EMP-002', 'PRJ-001', '2026-06-30', '6', 'Project', 'TASK-102']);
  ws2.addRow(['EMP-002', null, '2026-07-01', '2', 'Internal', null]);
  ws2.addRow(['EMP-003', 'PRJ-003', '2026-06-30', '8', 'Project', 'TASK-301']);
  ws2.addRow(['EMP-003', 'PRJ-003', '2026-07-01', '8', 'Project', 'TASK-302']);
  ws2.addRow(['EMP-004', 'PRJ-001', '2026-06-30', '7', 'Project', 'TASK-103']);
  ws2.addRow(['EMP-004', null, '2026-07-01', '1', 'Training', null]);
  ws2.addRow(['EMP-005', 'PRJ-002', '2026-06-30', '5', 'Project', 'TASK-202']);

  // DS03_Overbook_Idle_Config
  const ws3 = wb.addWorksheet('DS03_Overbook_Idle_Config');
  ws3.addRow([
    'Config_ID',
    'Rule_name',
    'Overbook_threshold',
    'Overbook_red_threshold',
    'Idle_threshold',
    'Mismatch_pct_threshold',
    'OT_max_hours_per_week',
    'Effective_date',
  ]);
  ws3.addRow(['CFG-001', 'Default', '1.10', '1.20', '0.75', '0.20', '8', '2026-06-29']);

  // DS04_Leave_Holiday_Records
  const ws4 = wb.addWorksheet('DS04_Leave_Holiday_Records');
  ws4.addRow([
    'Record_ID',
    'Member_ID',
    'Leave_date',
    'Leave_type',
    'Approved',
    'Duration_days',
    'Note',
  ]);
  ws4.addRow([
    'LV-001',
    'EMP-001',
    '2026-07-04',
    'Public Holiday',
    'TRUE',
    '1.0',
    'Independence Day',
  ]);
  ws4.addRow(['LV-002', 'EMP-002', '2026-07-07', 'Annual Leave', 'TRUE', '1.0', 'Personal day']);
  ws4.addRow([
    'LV-003',
    null,
    '2026-07-04',
    'Public Holiday',
    'TRUE',
    '1.0',
    'Company-wide holiday',
  ]);
  ws4.addRow(['LV-004', 'EMP-004', '2026-07-08', 'Training', 'TRUE', '0.5', 'AWS cert prep']);

  // DS05_Project_Master (note at row 1)
  const ws5 = wb.addWorksheet('DS05_Project_Master');
  ws5.addRow(['Note: Project master data - do not modify directly']);
  ws5.addRow([
    'Project_ID',
    'Project_name',
    'Account_ID',
    'Project_type',
    'Status',
    'PM_ID',
    'Start_date',
    'End_date',
  ]);
  ws5.addRow([
    'PRJ-001',
    'Platform Core',
    'ACC-01',
    'Software',
    'Active',
    'EMP-006',
    '2026-01-15',
    '2026-12-31',
  ]);
  ws5.addRow([
    'PRJ-002',
    'Data Pipeline',
    'ACC-01',
    'Data',
    'Active',
    'EMP-005',
    '2026-03-01',
    '2026-09-30',
  ]);
  ws5.addRow([
    'PRJ-003',
    'AI/ML Engine',
    'ACC-02',
    'AI/ML Platform',
    'Active',
    'EMP-003',
    '2026-04-01',
    '2026-12-31',
  ]);
  ws5.addRow([
    'PRJ-004',
    'Integration Hub',
    'ACC-03',
    'Integration',
    'Active',
    'EMP-008',
    '2026-05-01',
    '2026-11-30',
  ]);

  // DS06_Member_Master (note at row 1)
  const ws6 = wb.addWorksheet('DS06_Member_Master');
  ws6.addRow(['Note: Member master - updated monthly by HR']);
  ws6.addRow([
    'Member_ID',
    'Full_name',
    'Department',
    'Role_title',
    'Level',
    'Line_manager_id',
    'Employment_status',
    'Employment',
    'Std_hours_week',
    'Join_date',
  ]);
  ws6.addRow([
    'EMP-001',
    'Nguyen Van A',
    'Backend',
    'Senior Developer',
    'L4',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2023-03-15',
  ]);
  ws6.addRow([
    'EMP-002',
    'Tran Thi B',
    'QA',
    'QA Engineer',
    'L3',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2024-01-10',
  ]);
  ws6.addRow([
    'EMP-003',
    'Le Van C',
    'AI/ML',
    'ML Engineer',
    'L5',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2022-06-01',
  ]);
  ws6.addRow([
    'EMP-004',
    'Pham Thi D',
    'AI/ML',
    'Data Scientist',
    'L3',
    'EMP-003',
    'Probation',
    'FT',
    '40',
    '2026-05-15',
  ]);
  ws6.addRow([
    'EMP-005',
    'Hoang Van E',
    'DevOps',
    'DevOps Engineer',
    'L4',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2023-08-01',
  ]);
  ws6.addRow([
    'EMP-006',
    'Vu Thi F',
    'PMO',
    'Engineering Manager',
    'L6',
    null,
    'Active',
    'FT',
    '40',
    '2021-01-15',
  ]);
  ws6.addRow([
    'EMP-007',
    'Do Van G',
    'QA',
    'QA Lead',
    'L4',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2022-11-01',
  ]);
  ws6.addRow([
    'EMP-008',
    'Bui Thi H',
    'Backend',
    'Tech Lead',
    'L5',
    'EMP-006',
    'Active',
    'FT',
    '40',
    '2022-02-01',
  ]);

  // REF_Calendar_Weeks
  const ws7 = wb.addWorksheet('REF_Calendar_Weeks');
  ws7.addRow(['Week_ID', 'Week_start', 'Week_end', 'Working_days', 'Holiday_hours_ft', 'Note']);
  ws7.addRow(['W1', '2026-06-29', '2026-07-05', '4', '8', 'Week with July 4 holiday']);
  ws7.addRow(['W2', '2026-07-06', '2026-07-12', '5', '0', null]);
  ws7.addRow(['W3', '2026-07-13', '2026-07-19', '5', '0', null]);
  ws7.addRow(['W4', '2026-07-20', '2026-07-26', '5', '0', null]);
  ws7.addRow(['W5', '2026-07-27', '2026-08-02', '5', '0', null]);
  ws7.addRow(['W6', '2026-08-03', '2026-08-09', '5', '0', null]);

  // REF_KPI_Norms
  const ws8 = wb.addWorksheet('REF_KPI_Norms');
  ws8.addRow(['Norm_ID', 'Metric', 'Formula', 'Green', 'Yellow', 'Red', 'Used_for']);
  ws8.addRow([
    'KPI-001',
    'Busy Rate',
    'logged_hours / available_hours',
    '>=0.85',
    '0.70-0.84',
    '<0.70',
    'Member utilization',
  ]);
  ws8.addRow([
    'KPI-002',
    'Overbook Rate',
    'sum(allocation_pct)',
    '<=1.00',
    '1.01-1.10',
    '>1.10',
    'Capacity planning',
  ]);
  ws8.addRow([
    'KPI-003',
    'Mismatch Rate',
    'abs(logged - planned) / planned',
    '<=0.10',
    '0.11-0.20',
    '>0.20',
    'Plan accuracy',
  ]);

  // Excluded sheets
  wb.addWorksheet('LEGEND & SUMMARY').addRow(['This sheet describes the data format']);
  wb.addWorksheet('Answer_Key').addRow(['Expected findings for evaluation']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('full-pipeline', () => {
  it('happy path: standard file → all tables detected, required fields mapped, no blocked', async () => {
    const buffer = await createFullFixture();
    const result = await detectSchema(buffer);

    // All 8 business tables detected
    expect(result.tables).toHaveLength(8);
    expect(result.tables.map((t) => t.tableId).sort()).toEqual([
      'calendar_weeks',
      'kpi_norms',
      'leave',
      'member_master',
      'overbook_idle_config',
      'project_master',
      'resource_allocation',
      'timesheet',
    ]);

    // Not blocked
    expect(result.validation.status).not.toBe('blocked');

    // High confidence
    expect(result.validation.workbookConfidence).toBeGreaterThanOrEqual(0.85);

    // Excluded sheets
    expect(result.workbookMeta.excludedSheets).toContain('LEGEND & SUMMARY');
    expect(result.workbookMeta.excludedSheets).toContain('Answer_Key');
    expect(result.workbookMeta.sheetCount).toBe(8);

    // All core tables have no unmapped required fields
    const raTable = result.tables.find((t) => t.tableId === 'resource_allocation');
    expect(raTable?.unmappedRequired).toEqual([]);

    const tsTable = result.tables.find((t) => t.tableId === 'timesheet');
    expect(tsTable?.unmappedRequired).toEqual([]);

    const memberTable = result.tables.find((t) => t.tableId === 'member_master');
    expect(memberTable?.unmappedRequired).toEqual([]);

    const projectTable = result.tables.find((t) => t.tableId === 'project_master');
    expect(projectTable?.unmappedRequired).toEqual([]);
  });

  it('shifted header: DS05/DS06 with note at row 1 → header detected at row 2', async () => {
    const buffer = await createFullFixture();
    const result = await detectSchema(buffer);

    const projectTable = result.tables.find((t) => t.tableId === 'project_master');
    expect(projectTable?.headerRow).toBe(2);

    const memberTable = result.tables.find((t) => t.tableId === 'member_master');
    expect(memberTable?.headerRow).toBe(2);
  });

  it('normalization produces correct canonical rows', async () => {
    const buffer = await createFullFixture();
    const parseResult = await parseWorkbook(buffer);
    const schemaResult = await detectSchema(buffer);

    // Use confirmed mappings to normalize
    const tableMappings = schemaResult.tables.map((t) => ({
      ...t,
      mappings: t.mappings.map((m) => ({
        ...m,
        evidence: '',
        scoringBreakdown: {
          headerSimilarity: 0,
          valuePattern: 0,
          dataType: 0,
          sheetContext: 0,
          crossSheet: 0,
          llmSemantic: 0,
        },
      })),
    }));

    const normResult = normalizeRows(parseResult.sheets, tableMappings);

    // RA: 10 rows
    expect(normResult.rowCounts.resource_allocation).toBe(10);
    const raRows = normResult.tables.resource_allocation;
    expect(raRows?.[0]?.values.member_id).toBe('EMP-001');
    expect(raRows?.[0]?.values.allocation_pct).toBe(0.45);
    expect(raRows?.[0]?.values.weekly_planned_hours).toBe(18);

    // Timesheet: 10 rows
    expect(normResult.rowCounts.timesheet).toBe(10);
    const tsRows = normResult.tables.timesheet;
    expect(tsRows?.[0]?.values.logged_hours).toBe(8);
    expect(tsRows?.[0]?.values.log_category).toBe('Project');

    // Member master: 8 rows
    expect(normResult.rowCounts.member_master).toBe(8);
    const memberRows = normResult.tables.member_master;
    expect(memberRows?.[0]?.values.full_name).toBe('Nguyen Van A');
    expect(memberRows?.[0]?.values.std_hours_week).toBe(40);

    // Calendar: 6 rows
    expect(normResult.rowCounts.calendar_weeks).toBe(6);

    // Leave: 4 rows
    expect(normResult.rowCounts.leave).toBe(4);
    const leaveRows = normResult.tables.leave;
    expect(leaveRows?.[0]?.values.approved).toBe(true);
    expect(leaveRows?.[0]?.values.duration_days).toBe(1.0);

    // Low error count
    expect(normResult.errorCount).toBeLessThanOrEqual(5);
  });

  it('HITL path: rename Logged_hours to "Hours" → still maps to logged_hours', async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('DS01_Resource_Allocation');
    ws1.addRow(['Member_ID', 'Project_ID', 'Allocation_pct', 'Start_date', 'End_date']);
    ws1.addRow(['EMP-001', 'PRJ-001', '0.5', '2026-06-01', '2026-06-30']);
    ws1.addRow(['EMP-002', 'PRJ-002', '0.75', '2026-07-01', '2026-07-31']);
    ws1.addRow(['EMP-003', 'PRJ-001', '1.0', '2026-06-01', '2026-06-30']);
    ws1.addRow(['EMP-004', 'PRJ-003', '0.6', '2026-07-01', '2026-07-31']);
    ws1.addRow(['EMP-005', 'PRJ-002', '0.8', '2026-06-01', '2026-06-30']);

    const ws2 = wb.addWorksheet('DS02_Timesheet_Log');
    ws2.addRow(['Member_ID', 'Work_date', 'Hours', 'Log_category']); // "Hours" not "Logged_hours"
    ws2.addRow(['EMP-001', '2026-06-01', '8', 'Project']);
    ws2.addRow(['EMP-001', '2026-06-02', '7.5', 'Internal']);
    ws2.addRow(['EMP-002', '2026-06-01', '4', 'Training']);
    ws2.addRow(['EMP-003', '2026-06-02', '6', 'Project']);
    ws2.addRow(['EMP-004', '2026-06-01', '8', 'Admin']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await detectSchema(buffer);

    const tsTable = result.tables.find((t) => t.tableId === 'timesheet');
    expect(tsTable).toBeDefined();
    const hoursMapping = tsTable?.mappings.find((m) => m.canonicalField === 'logged_hours');
    expect(hoursMapping).toBeDefined();
    expect(hoursMapping?.sourceColumn).toBe('Hours');
  });

  it('block path: remove Member_ID from RA → blocked', async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('DS01_Resource_Allocation');
    ws1.addRow(['Project_ID', 'Allocation_pct', 'Start_date', 'End_date']);
    ws1.addRow(['PRJ-001', '0.5', '2026-06-01', '2026-06-30']);
    ws1.addRow(['PRJ-002', '0.75', '2026-07-01', '2026-07-31']);
    ws1.addRow(['PRJ-001', '1.0', '2026-06-01', '2026-06-30']);
    ws1.addRow(['PRJ-003', '0.6', '2026-07-01', '2026-07-31']);
    ws1.addRow(['PRJ-002', '0.8', '2026-06-01', '2026-06-30']);

    const ws2 = wb.addWorksheet('DS02_Timesheet_Log');
    ws2.addRow(['Member_ID', 'Work_date', 'Logged_hours', 'Log_category']);
    ws2.addRow(['EMP-001', '2026-06-01', '8', 'Project']);
    ws2.addRow(['EMP-002', '2026-06-02', '7.5', 'Internal']);
    ws2.addRow(['EMP-003', '2026-06-01', '4', 'Training']);
    ws2.addRow(['EMP-004', '2026-06-02', '6', 'Project']);
    ws2.addRow(['EMP-005', '2026-06-01', '8', 'Admin']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await detectSchema(buffer);

    expect(result.validation.status).toBe('blocked');
    const raTable = result.tables.find((t) => t.tableId === 'resource_allocation');
    expect(raTable?.unmappedRequired).toContain('member_id');
  });

  it('total row count matches all data sheets', async () => {
    const buffer = await createFullFixture();
    const result = await detectSchema(buffer);

    // DS01:10 + DS02:10 + DS03:1 + DS04:4 + DS05:4 + DS06:8 + REF_Cal:6 + REF_KPI:3 = 46
    expect(result.workbookMeta.totalRows).toBe(46);
  });
});
