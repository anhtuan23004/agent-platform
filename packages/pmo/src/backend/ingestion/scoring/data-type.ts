import type { CanonicalField } from '../canonical-schema.ts';
import type { ColumnProfile } from '../profile-columns.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataTypeScoreResult {
  score: number;
  blocked: boolean; // true if required field with < 50% compatibility
}

// ── Type compatibility checkers ──────────────────────────────────────────────

const DATE_PATTERNS = [/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/, /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/];

function isCompatibleNumber(value: string): boolean {
  const trimmed = value.trim().replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(trimmed);
}

function isCompatiblePercentage(value: string): boolean {
  const trimmed = value.trim();
  // Accept: "50%", "0.5", "50", "0.50"
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return true;
  return isCompatibleNumber(value);
}

function isCompatibleDate(value: string): boolean {
  const trimmed = value.trim();
  if (DATE_PATTERNS.some((p) => p.test(trimmed))) return true;
  // Fallback: try native Date parse
  if (trimmed.length >= 8) {
    const d = new Date(trimmed);
    return !Number.isNaN(d.getTime());
  }
  return false;
}

function isCompatibleBoolean(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return ['true', 'false', 'yes', 'no', '0', '1', 'y', 'n'].includes(lower);
}

function isCompatibleEnum(value: string): boolean {
  // Enums are strings — almost anything is compatible
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^\d+(\.\d+)?$/.test(trimmed);
}

function isCompatibleString(_value: string): boolean {
  return true; // strings accept anything
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreDataType(
  _profile: ColumnProfile,
  canonicalField: CanonicalField,
  allValues: string[],
): DataTypeScoreResult {
  const nonEmpty = allValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) {
    return { score: 0, blocked: canonicalField.required };
  }

  // Choose checker based on canonical field's expected data type
  let checker: (value: string) => boolean;
  switch (canonicalField.dataType) {
    case 'number':
      checker = isCompatibleNumber;
      break;
    case 'percentage':
      checker = isCompatiblePercentage;
      break;
    case 'date':
      checker = isCompatibleDate;
      break;
    case 'boolean':
      checker = isCompatibleBoolean;
      break;
    case 'enum':
      checker = isCompatibleEnum;
      break;
    default:
      checker = isCompatibleString;
      break;
  }

  const compatibleCount = nonEmpty.filter(checker).length;
  const ratio = compatibleCount / nonEmpty.length;

  // Map ratio to score band
  let score: number;
  if (ratio >= 0.95) score = 1.0;
  else if (ratio >= 0.85) score = 0.8;
  else if (ratio >= 0.7) score = 0.6;
  else if (ratio >= 0.5) score = 0.3;
  else score = 0.0;

  // Hard rule: required field with < 50% compatibility → blocked
  const blocked = canonicalField.required && ratio < 0.5;

  return { score, blocked };
}
