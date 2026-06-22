import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectSchema } from '../../../src/backend/ingestion/detect-schema.ts';
import { normalizeRows } from '../../../src/backend/ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../../src/backend/ingestion/parse-workbook.ts';

function workbookBuffer(): Buffer {
  const root = path.resolve(__dirname, '../../../../..');
  return fs.readFileSync(path.join(root, 'hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx'));
}

describe('PMO_02 workbook acceptance', () => {
  it('detects the uploaded workbook structure and preserves expected row counts', async () => {
    const buffer = workbookBuffer();
    const parsed = await parseWorkbook(buffer);
    const detected = await detectSchema(buffer);

    expect(parsed.excludedSheets).toEqual(
      expect.arrayContaining(['LEGEND & SUMMARY', 'Answer_Key']),
    );
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual([
      'DS01_Resource_Allocation',
      'DS02_Timesheet_Log',
      'DS03_Overbook_Idle_Config',
      'DS04_Leave_Holiday_Records',
      'DS05_Project_Master',
      'DS06_Member_Master',
      'REF_Calendar_Weeks',
      'REF_KPI_Norms',
    ]);

    const projectSheet = parsed.sheets.find((sheet) => sheet.name === 'DS05_Project_Master');
    const memberSheet = parsed.sheets.find((sheet) => sheet.name === 'DS06_Member_Master');
    expect(projectSheet?.headerRow).toBe(2);
    expect(memberSheet?.headerRow).toBe(2);

    expect(detected.validation.status).toBe('needs_review');
    expect(detected.validation.workbookConfidence).toBeGreaterThanOrEqual(0.95);
    expect(detected.tables.every((table) => table.unmappedRequired.length === 0)).toBe(true);

    const mappings = detected.tables.map((table) => ({
      ...table,
      mappings: table.mappings.map((mapping) => ({
        ...mapping,
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

    const normalized = normalizeRows(parsed.sheets, mappings);
    expect(normalized.errorCount).toBe(0);
    expect(normalized.rowCounts).toMatchObject({
      resource_allocation: 40,
      timesheet: 1116,
      overbook_idle_config: 1,
      leave: 11,
      project_master: 23,
      member_master: 30,
      calendar_weeks: 6,
      kpi_norms: 12,
    });
  });
});
