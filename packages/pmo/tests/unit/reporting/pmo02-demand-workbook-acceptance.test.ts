import fs from 'node:fs';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { detectSchema } from '../../../src/backend/ingestion/detect-schema.ts';
import { normalizeRows } from '../../../src/backend/ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../../src/backend/ingestion/parse-workbook.ts';

interface DemandCsvRow {
  demand_id: string;
  project_id: string;
  role_needed: string;
  required_skills?: string;
  demand_start: string;
  demand_end: string;
  demand_pct?: string;
  demand_hours_per_week?: string;
  urgency?: string;
  priority_score?: string;
  confirmed?: string;
  demand_source?: string;
  note?: string;
}

function projectDemandCsvRows(): DemandCsvRow[] {
  const root = path.resolve(__dirname, '../../../../..');
  const csvPath = path.join(root, 'hackathon/data/pmo_02_project_demand_plan.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as DemandCsvRow[];
}

async function demandWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Project Demand Plan');
  sheet.addRow([
    'Demand_ID',
    'Project_ID',
    'Role_Needed',
    'Required_Skills',
    'Demand_Start',
    'Demand_End',
    'Demand_Pct',
    'Demand_Hours_Per_Week',
    'Urgency',
    'Priority_Score',
    'Confirmed',
    'Demand_Source',
    'Note',
  ]);

  for (const row of projectDemandCsvRows()) {
    sheet.addRow([
      row.demand_id,
      row.project_id,
      row.role_needed,
      row.required_skills ?? '',
      row.demand_start,
      row.demand_end,
      row.demand_pct ?? '',
      row.demand_hours_per_week ?? '',
      row.urgency ?? '',
      row.priority_score ?? '',
      row.confirmed ?? '',
      row.demand_source ?? '',
      row.note ?? '',
    ]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('PMO demand workbook acceptance', () => {
  it('detects and normalizes project demand plan uploads for forward allocation reporting', async () => {
    const buffer = await demandWorkbookBuffer();
    const parsed = await parseWorkbook(buffer);
    const detected = await detectSchema(buffer);

    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['Project Demand Plan']);
    expect(detected.validation.status).not.toBe('blocked');
    expect(detected.tables).toHaveLength(1);
    expect(detected.tables[0]?.tableId).toBe('project_demand_plan');
    expect(detected.tables[0]?.unmappedRequired).toEqual([]);

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
    expect(normalized.rowCounts.project_demand_plan).toBe(3);

    const rows = normalized.tables.project_demand_plan ?? [];
    expect(rows[0]?.values).toMatchObject({
      demand_id: 'DEM-001',
      project_id: 'PRJ-105',
      role_needed: 'Designer',
      urgency: 'high',
      confirmed: true,
    });
    expect(rows[0]?.values.required_skills).toBe('figma|ux-research|wireframing');
  });
});
