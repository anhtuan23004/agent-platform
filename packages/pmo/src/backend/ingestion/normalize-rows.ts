import type { IngestionDomainConfig } from './domain-config.ts';
import type { TableMapping } from './map-columns.ts';
import type { ParsedSheet } from './parse-workbook.ts';
import { PMO_DOMAIN_CONFIG } from './pmo-domain-config.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedRow {
  tableId: string;
  sourceRow: number;
  values: Record<string, unknown>; // canonical field name → parsed value
  parseErrors: Array<{ field: string; raw: string; error: string }>;
}

export interface NormalizationResult {
  tables: Record<string, NormalizedRow[]>; // tableId → rows
  rowCounts: Record<string, number>;
  errorCount: number;
}

// ── Value parsers ────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ISO format: 2026-06-01
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Slash format: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    const year = y?.length === 2 ? 2000 + Number(y) : Number(y);
    // Assume DD/MM/YYYY (common in Vietnamese/EU context)
    const d = new Date(year, Number(b) - 1, Number(a));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Fallback native parse
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePercentage(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.endsWith('%')) {
    const numStr = trimmed.slice(0, -1);
    if (!/^-?\d+(\.\d+)?$/.test(numStr)) return null;
    return Number.parseFloat(numStr) / 100;
  }

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  // If > 1.5, assume it's a percentage expressed as integer (e.g. 50 → 0.5)
  if (n > 1.5) return n / 100;
  return n;
}

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

function parseBoolean(raw: string): boolean | null {
  const lower = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'y'].includes(lower)) return true;
  if (['false', 'no', '0', 'n'].includes(lower)) return false;
  return null;
}

function parseString(raw: string): string {
  return raw.trim();
}

// ── Field type dispatcher ────────────────────────────────────────────────────

interface FieldMeta {
  name: string;
  dataType: string;
}

function parseValue(raw: string, field: FieldMeta): { value: unknown; error: string | null } {
  if (raw.trim() === '') {
    return { value: null, error: null };
  }

  switch (field.dataType) {
    case 'date': {
      const d = parseDate(raw);
      if (!d) return { value: null, error: `Cannot parse '${raw}' as date` };
      return { value: d.toISOString(), error: null };
    }
    case 'percentage': {
      const n = parsePercentage(raw);
      if (n === null) return { value: null, error: `Cannot parse '${raw}' as percentage` };
      return { value: n, error: null };
    }
    case 'number': {
      const n = parseNumber(raw);
      if (n === null) return { value: null, error: `Cannot parse '${raw}' as number` };
      return { value: n, error: null };
    }
    case 'boolean': {
      const b = parseBoolean(raw);
      if (b === null) return { value: null, error: `Cannot parse '${raw}' as boolean` };
      return { value: b, error: null };
    }
    default:
      return { value: parseString(raw), error: null };
  }
}

// ── Main function ────────────────────────────────────────────────────────────

export function normalizeRows(
  parsedSheets: ParsedSheet[],
  confirmedMappings: TableMapping[],
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): NormalizationResult {
  const tables: Record<string, NormalizedRow[]> = {};
  let errorCount = 0;

  for (const mapping of confirmedMappings) {
    const sheet = parsedSheets.find((s) => s.name === mapping.sourceSheet);
    if (!sheet) continue;

    const rows: NormalizedRow[] = [];

    for (let rowIdx = 0; rowIdx < sheet.rows.length; rowIdx++) {
      const srcRow = sheet.rows[rowIdx];
      if (!srcRow) continue;

      // Check if row is completely empty for mapped columns
      const hasAnyMappedValue = mapping.mappings.some((m) => {
        const raw = srcRow[m.sourceColumn];
        return raw && raw.trim() !== '';
      });
      if (!hasAnyMappedValue) continue; // skip empty rows

      const values: Record<string, unknown> = {};
      const parseErrors: NormalizedRow['parseErrors'] = [];

      for (const colMapping of mapping.mappings) {
        const raw = srcRow[colMapping.sourceColumn] ?? '';
        const fieldMeta: FieldMeta = {
          name: colMapping.canonicalField,
          dataType: getFieldDataType(domainConfig, mapping.tableId, colMapping.canonicalField),
        };

        const { value, error } = parseValue(raw, fieldMeta);
        values[colMapping.canonicalField] = value;

        if (error) {
          parseErrors.push({ field: colMapping.canonicalField, raw, error });
          errorCount++;
        }
      }

      rows.push({
        tableId: mapping.tableId,
        sourceRow: mapping.headerRow + rowIdx + 1, // 1-indexed original row
        values,
        parseErrors,
      });
    }

    tables[mapping.tableId] = rows;
  }

  const rowCounts: Record<string, number> = {};
  for (const [tableId, rows] of Object.entries(tables)) {
    rowCounts[tableId] = rows.length;
  }

  return { tables, rowCounts, errorCount };
}

// ── Helper: get data type for a field from canonical schema ──────────────────
// Inline lookup to avoid circular dependency with canonical-schema.ts at runtime

function getFieldDataType(
  domainConfig: IngestionDomainConfig,
  tableId: string,
  fieldName: string,
): string {
  const table = domainConfig.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.name === fieldName);
  return field?.dataType ?? 'string';
}
