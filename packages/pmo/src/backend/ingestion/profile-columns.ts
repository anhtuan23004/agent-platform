import type { ParsedSheet } from './parse-workbook.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ColumnProfile {
  columnName: string;
  inferredType: 'string' | 'number' | 'date' | 'percentage' | 'boolean' | 'mixed';
  nullRate: number; // 0.0–1.0
  uniqueCount: number;
  uniqueRate: number; // unique / non-empty
  sampleValues: string[]; // first 5 unique non-empty
  valuePattern: string | null; // detected regex pattern
  stats: {
    min?: number | string;
    max?: number | string;
    mean?: number;
  };
}

export interface SheetProfile {
  sheetName: string;
  headerRow: number;
  columns: ColumnProfile[];
  rowCount: number;
}

// ── Type inference ───────────────────────────────────────────────────────────

const DATE_PATTERNS = [
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/, // 2026-06-01, 2026/6/1
  /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/, // 01-06-2026, 1/6/26
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime
];

const PERCENTAGE_PATTERN = /^-?\d+(\.\d+)?%$/;
const NUMBER_PATTERN = /^-?\d[\d,]*\.?\d*$/;
const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', '0', '1', 'y', 'n']);

function isDate(value: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(value.trim()));
}

function isPercentage(value: string): boolean {
  return PERCENTAGE_PATTERN.test(value.trim());
}

function isNumber(value: string): boolean {
  const trimmed = value.trim().replace(/,/g, '');
  if (trimmed === '') return false;
  return NUMBER_PATTERN.test(trimmed) || isPercentage(value);
}

function isBoolean(value: string): boolean {
  return BOOLEAN_VALUES.has(value.trim().toLowerCase());
}

type InferredType = ColumnProfile['inferredType'];

function inferType(values: string[]): InferredType {
  if (values.length === 0) return 'string';

  let dateCount = 0;
  let percentCount = 0;
  let numberCount = 0;
  let boolCount = 0;

  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed === '') continue;

    if (isPercentage(trimmed)) {
      percentCount++;
      numberCount++; // percentages are also numbers
    } else if (isNumber(trimmed)) {
      numberCount++;
    } else if (isDate(trimmed)) {
      dateCount++;
    } else if (isBoolean(trimmed)) {
      boolCount++;
    }
  }

  const total = values.length;
  const threshold = 0.7;

  // Priority order: percentage > number > date > boolean > string
  // Percentage must be dominant over plain numbers
  if (percentCount / total >= threshold) return 'percentage';
  if (numberCount / total >= threshold) return 'number';
  if (dateCount / total >= threshold) return 'date';
  if (boolCount / total >= threshold) return 'boolean';

  // Check if it's "mixed" — multiple types each with significant presence
  const typeCounts = [dateCount, numberCount, boolCount].filter((c) => c / total >= 0.2);
  if (typeCounts.length >= 2) return 'mixed';

  // If numbers are present but below threshold, still mixed
  if (numberCount > 0 && numberCount / total >= 0.3 && numberCount / total < threshold) {
    return 'mixed';
  }

  return 'string';
}

// ── Pattern detection ────────────────────────────────────────────────────────

function detectPattern(values: string[]): string | null {
  if (values.length === 0) return null;

  // Check common patterns
  const sample = values.slice(0, 50);

  // ID pattern: PREFIX + digits (e.g. EMP001, PRJ-A)
  const idPattern = /^[A-Z]{2,5}[-_]?\d{2,6}$/;
  if (sample.filter((v) => idPattern.test(v.trim())).length / sample.length >= 0.8) {
    return 'ID_PREFIX_DIGITS';
  }

  // Email pattern
  const emailPattern = /^.+@.+\..+$/;
  if (sample.filter((v) => emailPattern.test(v.trim())).length / sample.length >= 0.8) {
    return 'EMAIL';
  }

  // Date ISO pattern
  if (sample.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v.trim())).length / sample.length >= 0.8) {
    return 'DATE_ISO';
  }

  // Date slash pattern
  if (
    sample.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v.trim())).length / sample.length >=
    0.8
  ) {
    return 'DATE_SLASH';
  }

  // Percentage pattern
  if (sample.filter((v) => isPercentage(v)).length / sample.length >= 0.8) {
    return 'PERCENTAGE';
  }

  // Decimal number pattern
  if (sample.filter((v) => /^-?\d+\.\d+$/.test(v.trim())).length / sample.length >= 0.8) {
    return 'DECIMAL';
  }

  // Integer pattern
  if (sample.filter((v) => /^-?\d+$/.test(v.trim())).length / sample.length >= 0.8) {
    return 'INTEGER';
  }

  return null;
}

// ── Stats computation ────────────────────────────────────────────────────────

function computeStats(values: string[], type: InferredType): ColumnProfile['stats'] {
  if (type === 'number' || type === 'percentage') {
    const nums = values
      .map((v) => {
        const trimmed = v.trim().replace(/,/g, '').replace(/%$/, '');
        const n = Number.parseFloat(trimmed);
        return Number.isNaN(n) ? null : isPercentage(v) ? n / 100 : n;
      })
      .filter((n): n is number => n !== null);

    if (nums.length === 0) return {};

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const mean = nums.reduce((sum, n) => sum + n, 0) / nums.length;

    return { min, max, mean };
  }

  if (type === 'date') {
    const sorted = values.filter((v) => v.trim() !== '').sort();
    if (sorted.length > 0) {
      return { min: sorted[0], max: sorted[sorted.length - 1] };
    }
  }

  return {};
}

// ── Main function ────────────────────────────────────────────────────────────

export function profileColumns(sheet: ParsedSheet): SheetProfile {
  const columns: ColumnProfile[] = sheet.headers.map((headerName) => {
    const allValues = sheet.rows.map((row) => row[headerName] ?? '');
    const nonEmpty = allValues.filter((v) => v.trim() !== '');

    const nullRate =
      allValues.length > 0 ? (allValues.length - nonEmpty.length) / allValues.length : 0;

    const uniqueSet = new Set(nonEmpty.map((v) => v.trim().toLowerCase()));
    const uniqueCount = uniqueSet.size;
    const uniqueRate = nonEmpty.length > 0 ? uniqueCount / nonEmpty.length : 0;

    const inferredType = inferType(nonEmpty);
    const valuePattern = detectPattern(nonEmpty);
    const stats = computeStats(nonEmpty, inferredType);

    // First 5 unique non-empty values (preserving original case)
    const seen = new Set<string>();
    const sampleValues: string[] = [];
    for (const v of nonEmpty) {
      const key = v.trim().toLowerCase();
      if (!seen.has(key) && sampleValues.length < 5) {
        seen.add(key);
        sampleValues.push(v.trim());
      }
    }

    return {
      columnName: headerName,
      inferredType,
      nullRate,
      uniqueCount,
      uniqueRate,
      sampleValues,
      valuePattern,
      stats,
    };
  });

  return {
    sheetName: sheet.name,
    headerRow: sheet.headerRow,
    columns,
    rowCount: sheet.rowCount,
  };
}
