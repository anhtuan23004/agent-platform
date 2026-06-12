import { describe, expect, it } from 'vitest';
import type { ParsedSheet } from '../../src/backend/ingestion/parse-workbook.ts';
import { profileColumns } from '../../src/backend/ingestion/profile-columns.ts';

// ── Helper ───────────────────────────────────────────────────────────────────

function makeSheet(headers: string[], rows: Record<string, string>[]): ParsedSheet {
  return {
    name: 'TestSheet',
    rowCount: rows.length,
    colCount: headers.length,
    headerRow: 1,
    headers,
    columns: headers.map((name, idx) => ({
      index: idx + 1,
      name,
      sampleValues: rows
        .slice(0, 10)
        .map((r) => r[name] ?? '')
        .filter((v) => v !== ''),
      nonEmptyCount: rows.filter((r) => (r[name] ?? '').trim() !== '').length,
      totalRowCount: rows.length,
    })),
    rows,
    sampleDataRows: rows.slice(0, 5),
    warnings: [],
  };
}

function makeRows(headers: string[], data: string[][]): Record<string, string>[] {
  return data.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = row[i] ?? '';
    });
    return record;
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('profileColumns', () => {
  it('infers date type for column with all dates', () => {
    const headers = ['work_date'];
    const rows = makeRows(headers, [
      ['2026-06-01'],
      ['2026-06-02'],
      ['2026-06-03'],
      ['2026-06-04'],
      ['2026-06-05'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('date');
    expect(col!.nullRate).toBe(0);
    expect(col!.valuePattern).toBe('DATE_ISO');
    expect(col!.stats.min).toBe('2026-06-01');
    expect(col!.stats.max).toBe('2026-06-05');
  });

  it('infers percentage type for column with percent values', () => {
    const headers = ['allocation'];
    const rows = makeRows(headers, [['50%'], ['75%'], ['100%'], ['25%'], ['80%']]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('percentage');
    expect(col!.valuePattern).toBe('PERCENTAGE');
    expect(col!.stats.min).toBe(0.25);
    expect(col!.stats.max).toBe(1.0);
    expect(col!.stats.mean).toBeCloseTo(0.66, 1);
  });

  it('infers number type for numeric column without percent', () => {
    const headers = ['hours'];
    const rows = makeRows(headers, [['8'], ['7.5'], ['4'], ['6'], ['8']]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('number');
    expect(col!.stats.min).toBe(4);
    expect(col!.stats.max).toBe(8);
    expect(col!.stats.mean).toBeCloseTo(6.7, 1);
  });

  it('infers mixed type for column with numbers and text', () => {
    const headers = ['data'];
    const rows = makeRows(headers, [
      ['hello'],
      ['123'],
      ['world'],
      ['456'],
      ['foo'],
      ['789'],
      ['bar'],
      ['101'],
      ['baz'],
      ['202'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('mixed');
  });

  it('computes correct null rate', () => {
    const headers = ['val'];
    const rows = makeRows(headers, [
      ['a'],
      [''],
      ['b'],
      [''],
      [''],
      ['c'],
      [''],
      ['d'],
      [''],
      ['e'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.nullRate).toBeCloseTo(0.5, 2);
  });

  it('computes uniqueRate for ID column', () => {
    const headers = ['member_id'];
    const rows = makeRows(headers, [['EMP001'], ['EMP002'], ['EMP003'], ['EMP004'], ['EMP005']]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.uniqueCount).toBe(5);
    expect(col!.uniqueRate).toBe(1.0);
    expect(col!.nullRate).toBe(0);
    expect(col!.valuePattern).toBe('ID_PREFIX_DIGITS');
  });

  it('computes low uniqueRate for category column', () => {
    const headers = ['category'];
    const rows = makeRows(headers, [
      ['Project'],
      ['Internal'],
      ['Training'],
      ['Project'],
      ['Internal'],
      ['Project'],
      ['Training'],
      ['Project'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('string');
    expect(col!.uniqueCount).toBe(3);
    expect(col!.uniqueRate).toBeCloseTo(3 / 8, 2);
  });

  it('infers boolean type for yes/no column', () => {
    const headers = ['active'];
    const rows = makeRows(headers, [
      ['yes'],
      ['no'],
      ['yes'],
      ['yes'],
      ['no'],
      ['yes'],
      ['no'],
      ['no'],
      ['yes'],
      ['yes'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.inferredType).toBe('boolean');
  });

  it('returns correct sheetName and headerRow', () => {
    const headers = ['A', 'B'];
    const rows = makeRows(headers, [['1', '2']]);
    const sheet = makeSheet(headers, rows);
    sheet.name = 'DS01_RA';
    sheet.headerRow = 2;

    const profile = profileColumns(sheet);
    expect(profile.sheetName).toBe('DS01_RA');
    expect(profile.headerRow).toBe(2);
    expect(profile.rowCount).toBe(1);
  });

  it('provides first 5 unique sample values', () => {
    const headers = ['id'];
    const rows = makeRows(headers, [['A'], ['B'], ['A'], ['C'], ['D'], ['E'], ['F'], ['B']]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.sampleValues).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('detects email pattern', () => {
    const headers = ['email'];
    const rows = makeRows(headers, [
      ['alice@test.com'],
      ['bob@test.com'],
      ['carol@test.com'],
      ['dave@test.com'],
      ['eve@test.com'],
    ]);
    const profile = profileColumns(makeSheet(headers, rows));
    const col = profile.columns[0]!;

    expect(col!.valuePattern).toBe('EMAIL');
  });
});
