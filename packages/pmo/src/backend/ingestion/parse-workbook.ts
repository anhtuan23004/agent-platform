import ExcelJS from 'exceljs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedColumn {
  index: number;
  name: string;
  sampleValues: string[]; // first 10 non-empty
  nonEmptyCount: number;
  totalRowCount: number;
}

export interface ParsedSheet {
  name: string;
  rowCount: number;
  colCount: number;
  headerRow: number; // 1-indexed
  headers: string[];
  columns: ParsedColumn[];
  rows: Record<string, string>[]; // ALL data rows below header
  sampleDataRows: Record<string, string>[]; // first 5 rows (convenience subset)
  warnings: string[];
}

export interface WorkbookParseResult {
  sheets: ParsedSheet[];
  excludedSheets: string[];
  parseErrors: string[];
}

// ── Exclusion patterns ───────────────────────────────────────────────────────

const EXCLUDED_SHEET_PATTERNS = [
  /^legend/i,
  /^summary/i,
  /^answer[_\s]?key/i,
  /^instruction/i,
  /^note/i,
];

function isExcludedSheet(name: string): boolean {
  return EXCLUDED_SHEET_PATTERNS.some((p) => p.test(name.trim()));
}

// ── Header detection ─────────────────────────────────────────────────────────

interface RowSignals {
  rowIndex: number; // 1-indexed
  stringLikeRatio: number;
  nextRowDataDensity: number;
  nonEmptyRatio: number;
  uniqueCellRatio: number;
  noNumericCells: number;
}

function getCellString(cell: ExcelJS.Cell): string {
  if (cell.value === null || cell.value === undefined) return '';
  if (cell.type === ExcelJS.ValueType.Date) {
    return (cell.value as Date).toISOString();
  }
  if (typeof cell.value === 'object' && 'result' in cell.value) {
    // Formula cell — use the result
    const result = (cell.value as ExcelJS.CellFormulaValue).result;
    return result?.toString() ?? '';
  }
  if (typeof cell.value === 'object' && 'richText' in cell.value) {
    return (cell.value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join('');
  }
  return cell.value.toString();
}

function isNumericLike(value: string): boolean {
  if (!value) return false;
  // Match: 123, 12.5, 50%, 0.5, -3, 1,234.56
  return /^-?\d[\d,]*\.?\d*%?$/.test(value.trim());
}

function isDateLike(value: string): boolean {
  if (!value) return false;
  // Match common date patterns
  return (
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value.trim()) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(value.trim()) ||
    /^\d{4}-\d{2}-\d{2}T/.test(value.trim())
  );
}

function isStringLabel(value: string): boolean {
  if (!value) return false;
  // A cell looks like a label if it's not purely numeric or date
  return !isNumericLike(value) && !isDateLike(value);
}

function scoreRow(worksheet: ExcelJS.Worksheet, rowIndex: number, totalCols: number): RowSignals {
  const row = worksheet.getRow(rowIndex);
  const nextRow = rowIndex < worksheet.rowCount ? worksheet.getRow(rowIndex + 1) : null;

  const cells: string[] = [];
  for (let c = 1; c <= totalCols; c++) {
    cells.push(getCellString(row.getCell(c)));
  }

  const nonEmpty = cells.filter((v) => v.trim() !== '');
  const nonEmptyRatio = totalCols > 0 ? nonEmpty.length / totalCols : 0;
  const stringLikeCount = nonEmpty.filter(isStringLabel).length;
  const stringLikeRatio = nonEmpty.length > 0 ? stringLikeCount / nonEmpty.length : 0;
  const numericCount = nonEmpty.filter(isNumericLike).length;
  const noNumericCells = nonEmpty.length > 0 ? 1 - numericCount / nonEmpty.length : 1;
  const uniqueValues = new Set(nonEmpty.map((v) => v.toLowerCase().trim()));
  const uniqueCellRatio = nonEmpty.length > 0 ? uniqueValues.size / nonEmpty.length : 0;

  // Next row data density: ratio of numeric/date cells in the row below
  let nextRowDataDensity = 0;
  if (nextRow) {
    const nextCells: string[] = [];
    for (let c = 1; c <= totalCols; c++) {
      nextCells.push(getCellString(nextRow.getCell(c)));
    }
    const nextNonEmpty = nextCells.filter((v) => v.trim() !== '');
    const dataCount = nextNonEmpty.filter((v) => isNumericLike(v) || isDateLike(v)).length;
    nextRowDataDensity = nextNonEmpty.length > 0 ? dataCount / nextNonEmpty.length : 0;
  }

  return {
    rowIndex,
    stringLikeRatio,
    nextRowDataDensity,
    nonEmptyRatio,
    uniqueCellRatio,
    noNumericCells,
  };
}

function computeHeaderScore(signals: RowSignals): number {
  return (
    0.3 * signals.stringLikeRatio +
    0.25 * signals.nextRowDataDensity +
    0.2 * signals.nonEmptyRatio +
    0.15 * signals.uniqueCellRatio +
    0.1 * signals.noNumericCells
  );
}

function detectHeaderRow(worksheet: ExcelJS.Worksheet, totalCols: number): number {
  const maxScanRows = Math.min(10, worksheet.rowCount);
  if (maxScanRows === 0) return 1;

  let bestRow = 1;
  let bestScore = -1;

  const scores: Array<{ rowIndex: number; score: number; nonEmptyCount: number }> = [];

  for (let r = 1; r <= maxScanRows; r++) {
    const signals = scoreRow(worksheet, r, totalCols);
    const score = computeHeaderScore(signals);
    const row = worksheet.getRow(r);
    let nonEmptyCount = 0;
    for (let c = 1; c <= totalCols; c++) {
      if (getCellString(row.getCell(c)).trim() !== '') nonEmptyCount++;
    }
    scores.push({ rowIndex: r, score, nonEmptyCount });

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  // Override: if row 1 is sparse (note/title spanning few cells in a wide sheet)
  // and row 2 scores highest → header = row 2
  // Only applies when row 1 fills less than half the columns (avoids false trigger on narrow sheets)
  if (
    scores.length >= 2 &&
    (scores[0]?.nonEmptyCount ?? 0) <= 2 &&
    (scores[0]?.nonEmptyCount ?? 0) < totalCols * 0.5 &&
    (scores[1]?.score ?? 0) >= bestScore
  ) {
    return scores[1]?.rowIndex ?? bestRow;
  }

  return bestRow;
}

// ── Column width detection ───────────────────────────────────────────────────

function detectColumnCount(worksheet: ExcelJS.Worksheet): number {
  // Scan first 10 rows to find the max used column
  let maxCol = 0;
  const scanRows = Math.min(10, worksheet.rowCount);
  for (let r = 1; r <= scanRows; r++) {
    const row = worksheet.getRow(r);
    for (let c = row.cellCount; c >= 1; c--) {
      if (getCellString(row.getCell(c)).trim() !== '') {
        if (c > maxCol) maxCol = c;
        break;
      }
    }
  }
  return maxCol;
}

// ── Main parse function ──────────────────────────────────────────────────────

export async function parseWorkbook(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<WorkbookParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);

  const sheets: ParsedSheet[] = [];
  const excludedSheets: string[] = [];
  const parseErrors: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const name = worksheet.name;

    if (isExcludedSheet(name)) {
      excludedSheets.push(name);
      continue;
    }

    try {
      const parsed = parseSheet(worksheet);
      sheets.push(parsed);
    } catch (err) {
      parseErrors.push(`Sheet "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { sheets, excludedSheets, parseErrors };
}

function parseSheet(worksheet: ExcelJS.Worksheet): ParsedSheet {
  const warnings: string[] = [];
  const totalCols = detectColumnCount(worksheet);

  if (totalCols === 0 || worksheet.rowCount === 0) {
    return {
      name: worksheet.name,
      rowCount: 0,
      colCount: 0,
      headerRow: 1,
      headers: [],
      columns: [],
      rows: [],
      sampleDataRows: [],
      warnings: ['Empty sheet — no data detected'],
    };
  }

  const headerRow = detectHeaderRow(worksheet, totalCols);

  // Extract headers
  const headerRowObj = worksheet.getRow(headerRow);
  const headers: string[] = [];
  for (let c = 1; c <= totalCols; c++) {
    const val = getCellString(headerRowObj.getCell(c)).trim();
    headers.push(val || `Column_${c}`);
  }

  // Parse all data rows below header
  const rows: Record<string, string>[] = [];
  let blankRowCount = 0;
  const lastRowNum = worksheet.lastRow?.number ?? worksheet.rowCount;

  for (let r = headerRow + 1; r <= lastRowNum; r++) {
    const row = worksheet.getRow(r);
    const record: Record<string, string> = {};
    let hasAnyValue = false;

    for (let c = 1; c <= totalCols; c++) {
      const value = getCellString(row.getCell(c)).trim();
      const header = headers[c - 1] ?? `Column_${c}`;
      record[header] = value;
      if (value !== '') hasAnyValue = true;
    }

    if (!hasAnyValue) {
      blankRowCount++;
      continue; // skip blank rows
    }

    rows.push(record);
  }

  if (blankRowCount > 0) {
    warnings.push(`${blankRowCount} blank row(s) skipped`);
  }

  // Build columns metadata
  const columns: ParsedColumn[] = headers.map((name, idx) => {
    const values = rows.map((r) => r[name] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const sampleValues: string[] = nonEmpty.slice(0, 10);

    return {
      index: idx + 1,
      name,
      sampleValues,
      nonEmptyCount: nonEmpty.length,
      totalRowCount: rows.length,
    };
  });

  const sampleDataRows = rows.slice(0, 5);

  return {
    name: worksheet.name,
    rowCount: rows.length,
    colCount: totalCols,
    headerRow,
    headers,
    columns,
    rows,
    sampleDataRows,
    warnings,
  };
}
