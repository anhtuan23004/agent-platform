import type { CanonicalField } from '../canonical-schema.ts';
import type { ColumnProfile } from '../profile-columns.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValuePatternResult {
  score: number; // 0–1
  details: string; // human-readable explanation
}

// ── Utility ──────────────────────────────────────────────────────────────────

function parsePercentage(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const numStr = trimmed.slice(0, -1);
    if (!/^-?\d+(\.\d+)?$/.test(numStr)) return null;
    return Number.parseFloat(numStr) / 100;
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  // If value is between 0 and 1.5, treat as ratio; if > 1.5, treat as percentage
  if (n > 1.5) return n / 100;
  return n;
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

function isDateParseable(value: string): boolean {
  const trimmed = value.trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(trimmed)) return true;
  // Try native Date parse as fallback
  const d = new Date(trimmed);
  return !Number.isNaN(d.getTime()) && trimmed.length >= 8;
}

// ── Field-specific sub-scorers ───────────────────────────────────────────────

function scoreMemberId(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values to analyze' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All values empty' };

  // Check: mostly strings (not numbers/dates)
  const stringCount = nonEmpty.filter(
    (v) => !/^\d+(\.\d+)?$/.test(v.trim()) && !/^\d{4}-\d{2}-\d{2}/.test(v.trim()),
  ).length;
  const stringRatio = stringCount / nonEmpty.length;

  // Check: format consistency (same prefix pattern)
  const patterns = nonEmpty.map((v) => v.trim().replace(/\d/g, '#'));
  const topPattern = [
    ...new Map(patterns.map((p) => [p, patterns.filter((x) => x === p).length])),
  ].sort((a, b) => b[1] - a[1])[0];
  const formatConsistency = topPattern ? topPattern[1] / nonEmpty.length : 0;

  // Check: high uniqueness
  const uniqueRate = new Set(nonEmpty.map((v) => v.trim().toLowerCase())).size / nonEmpty.length;

  const score = 0.3 * stringRatio + 0.35 * formatConsistency + 0.35 * uniqueRate;
  return {
    score: Math.min(score, 1.0),
    details: `string=${(stringRatio * 100).toFixed(0)}%, consistency=${(formatConsistency * 100).toFixed(0)}%, unique=${(uniqueRate * 100).toFixed(0)}%`,
  };
}

function scoreAllocationPct(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  let parseableCount = 0;
  let inRangeCount = 0;

  for (const v of nonEmpty) {
    const parsed = parsePercentage(v);
    if (parsed !== null) {
      parseableCount++;
      // Valid allocation: 0–1.5 (allowing some overbook)
      if (parsed >= 0 && parsed <= 1.5) inRangeCount++;
    }
  }

  const parseRatio = parseableCount / nonEmpty.length;
  const rangeRatio = parseableCount > 0 ? inRangeCount / parseableCount : 0;

  const score = 0.6 * parseRatio + 0.4 * rangeRatio;
  return {
    score,
    details: `parseable=${(parseRatio * 100).toFixed(0)}%, inRange=${(rangeRatio * 100).toFixed(0)}%`,
  };
}

function scoreLoggedHours(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  let numericCount = 0;
  let dailyRangeCount = 0;

  for (const v of nonEmpty) {
    const n = parseNumber(v);
    if (n !== null) {
      numericCount++;
      // Daily hours typically 0–24
      if (n >= 0 && n <= 24) dailyRangeCount++;
    }
  }

  const numericRatio = numericCount / nonEmpty.length;
  const rangeRatio = numericCount > 0 ? dailyRangeCount / numericCount : 0;

  // Bonus: has decimal values (typical for hours like 7.5)
  const hasDecimal = nonEmpty.some((v) => /^\d+\.\d+$/.test(v.trim()));
  const decimalBonus = hasDecimal ? 0.1 : 0;

  const score = Math.min(0.5 * numericRatio + 0.4 * rangeRatio + decimalBonus, 1.0);
  return {
    score,
    details: `numeric=${(numericRatio * 100).toFixed(0)}%, dailyRange=${(rangeRatio * 100).toFixed(0)}%${hasDecimal ? ', hasDecimal' : ''}`,
  };
}

function scoreDate(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  const parseableCount = nonEmpty.filter(isDateParseable).length;
  const parseRatio = parseableCount / nonEmpty.length;

  const score = parseRatio;
  return {
    score,
    details: `datesParseable=${(parseRatio * 100).toFixed(0)}%`,
  };
}

function scoreCategory(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  const uniqueValues = new Set(nonEmpty.map((v) => v.trim().toLowerCase()));
  const cardinality = uniqueValues.size;

  // Categories: low cardinality (< 20 unique values), mostly strings
  const lowCardinality = cardinality <= 20 ? 1.0 : cardinality <= 50 ? 0.5 : 0.2;
  const isNotNumeric =
    nonEmpty.filter((v) => !/^\d+(\.\d+)?$/.test(v.trim())).length / nonEmpty.length;

  const score = 0.5 * lowCardinality + 0.5 * isNotNumeric;
  return {
    score,
    details: `cardinality=${cardinality}, nonNumeric=${(isNotNumeric * 100).toFixed(0)}%`,
  };
}

function scoreGenericNumber(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  const numericCount = nonEmpty.filter((v) => parseNumber(v) !== null).length;
  const ratio = numericCount / nonEmpty.length;

  return { score: ratio, details: `numeric=${(ratio * 100).toFixed(0)}%` };
}

function scoreGenericString(_profile: ColumnProfile, allValues: string[]): ValuePatternResult {
  if (allValues.length === 0) return { score: 0, details: 'No values' };

  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return { score: 0, details: 'All empty' };

  // Generic string: if data IS string (not purely numeric), field expecting string → high compatibility
  const stringCount = nonEmpty.filter((v) => !/^\d+(\.\d+)?%?$/.test(v.trim())).length;
  const ratio = stringCount / nonEmpty.length;

  // String fields are permissive — ratio ≥ 0.7 should score well
  const score = ratio >= 0.9 ? 0.95 : ratio >= 0.7 ? 0.85 : ratio >= 0.5 ? 0.7 : ratio * 0.7;
  return { score, details: `stringRatio=${(ratio * 100).toFixed(0)}%` };
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreValuePattern(
  profile: ColumnProfile,
  canonicalField: CanonicalField,
  allValues: string[],
): ValuePatternResult {
  // Dispatch to field-specific scorer based on data type + field name
  switch (canonicalField.dataType) {
    case 'percentage':
      return scoreAllocationPct(profile, allValues);

    case 'number':
      if (canonicalField.name === 'logged_hours') {
        return scoreLoggedHours(profile, allValues);
      }
      return scoreGenericNumber(profile, allValues);

    case 'date':
      return scoreDate(profile, allValues);

    case 'enum':
      return scoreCategory(profile, allValues);

    case 'string':
      if (canonicalField.name.includes('_id') || canonicalField.name === 'member_id') {
        return scoreMemberId(profile, allValues);
      }
      return scoreGenericString(profile, allValues);

    case 'boolean':
      return scoreCategory(profile, allValues); // reuse low cardinality logic

    default:
      return scoreGenericString(profile, allValues);
  }
}
