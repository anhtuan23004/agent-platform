import { createHash } from 'node:crypto';

function canonicalValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('report_rule_canonicalization_non_finite_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`report_rule_canonicalization_unsupported:${typeof value}`);
}

export function canonicalizeReportRules(value: unknown): string {
  return canonicalValue(value);
}

export function hashReportRules(value: unknown): string {
  return createHash('sha256').update(canonicalizeReportRules(value)).digest('hex');
}
