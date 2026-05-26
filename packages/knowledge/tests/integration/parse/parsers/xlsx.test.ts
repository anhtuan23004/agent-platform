import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { xlsxParser } from '../../../../src/backend/parse/parsers/xlsx.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

beforeAll(async () => {
  mkdirSync(FIXTURES, { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRows([
    ['name', 'role'],
    ['Alice', 'terraform'],
    ['Bob', 'react'],
  ]);
  const buf = await wb.xlsx.writeBuffer();
  await writeFile(resolve(FIXTURES, 'small.xlsx'), Buffer.from(buf));
});

describe('xlsxParser', () => {
  it('extracts one section per sheet with sheet name as page_hint', async () => {
    const buf = await readFile(resolve(FIXTURES, 'small.xlsx'));
    const doc = await xlsxParser.parse(buf);
    expect(doc.sections.length).toBeGreaterThanOrEqual(1);
    expect(doc.sections[0]?.page_hint).toMatch(/^Sheet[^.]+/);
  });
});
