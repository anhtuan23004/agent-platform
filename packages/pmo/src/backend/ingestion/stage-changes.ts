import { createHash } from 'node:crypto';
import type { ActiveRecord, IngestionDomainConfig, IngestionTableConfig } from '@seta/ingestion';
import type { NormalizedRow } from './normalize-rows.ts';
import { PMO_DOMAIN_CONFIG } from './pmo-domain-config.ts';

// ── Natural key definitions ──────────────────────────────────────────────────

// ── Mutable value fields (excluded from natural key, included in source_row_hash) ──

function getTableConfig(
  domainConfig: IngestionDomainConfig,
  tableId: string,
): IngestionTableConfig | undefined {
  return domainConfig.tables.find((table) => table.id === tableId);
}

function getMutableFields(domainConfig: IngestionDomainConfig, tableId: string): string[] {
  const table = getTableConfig(domainConfig, tableId);
  if (!table) return [];
  const keyFields = new Set(table.naturalKey);
  return table.fields.map((f) => f.name).filter((name) => !keyFields.has(name));
}

// ── Hash computation ─────────────────────────────────────────────────────────

function stableStringify(values: Record<string, unknown>, fields: string[]): string {
  const obj: Record<string, unknown> = {};
  for (const field of fields.sort()) {
    const val = values[field];
    // Normalize: null/undefined → null, dates → ISO string, trim strings
    if (val === null || val === undefined) {
      obj[field] = null;
    } else if (typeof val === 'string') {
      obj[field] = val.trim().toLowerCase();
    } else {
      obj[field] = val;
    }
  }
  return JSON.stringify(obj);
}

export function computeNaturalKeyHash(
  tableId: string,
  tenantId: string,
  values: Record<string, unknown>,
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): string {
  const keyFields = getTableConfig(domainConfig, tableId)?.naturalKey ?? [];
  const payload = stableStringify({ ...values, __tenant: tenantId }, ['__tenant', ...keyFields]);
  return createHash('sha256').update(payload).digest('hex');
}

export function computeSourceRowHash(
  tableId: string,
  values: Record<string, unknown>,
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): string {
  const mutableFields = getMutableFields(domainConfig, tableId);
  const payload = stableStringify(values, mutableFields);
  return createHash('sha256').update(payload).digest('hex');
}

// ── Change types ─────────────────────────────────────────────────────────────

export type ChangeType =
  | 'new_record'
  | 'updated_record'
  | 'exact_duplicate'
  | 'duplicate_in_upload';

export interface StagedRow {
  tableId: string;
  naturalKeyHash: string;
  sourceRowHash: string;
  changeType: ChangeType;
  values: Record<string, unknown>;
  naturalKeyDisplay: Record<string, string>;
  oldValues?: Record<string, unknown>;
  sourceRow: number;
}

// ── Staging logic ────────────────────────────────────────────────────────────

export function classifyRows(
  tableId: string,
  tenantId: string,
  normalizedRows: NormalizedRow[],
  activeRecords: ActiveRecord[],
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): StagedRow[] {
  const activeMap = new Map<string, string>();
  for (const rec of activeRecords) {
    activeMap.set(rec.natural_key_hash, rec.source_row_hash);
  }

  // Track keys seen in this upload for duplicate_in_upload detection
  const seenInUpload = new Map<string, number>(); // hash → first index
  const staged: StagedRow[] = [];

  for (const [i, row] of normalizedRows.entries()) {
    const naturalKeyHash = computeNaturalKeyHash(tableId, tenantId, row.values, domainConfig);
    const sourceRowHash = computeSourceRowHash(tableId, row.values, domainConfig);

    const keyFields = getTableConfig(domainConfig, tableId)?.naturalKey ?? [];
    const naturalKeyDisplay: Record<string, string> = {};
    for (const f of keyFields) {
      naturalKeyDisplay[f] = String(row.values[f] ?? '');
    }

    // Check duplicate within upload
    if (seenInUpload.has(naturalKeyHash)) {
      staged.push({
        tableId,
        naturalKeyHash,
        sourceRowHash,
        changeType: 'duplicate_in_upload',
        values: row.values,
        naturalKeyDisplay,
        sourceRow: row.sourceRow,
      });
      continue;
    }
    seenInUpload.set(naturalKeyHash, i);

    // Compare against active DB data
    const existingHash = activeMap.get(naturalKeyHash);
    if (existingHash === undefined) {
      // Not in DB → new record
      staged.push({
        tableId,
        naturalKeyHash,
        sourceRowHash,
        changeType: 'new_record',
        values: row.values,
        naturalKeyDisplay,
        sourceRow: row.sourceRow,
      });
    } else if (existingHash === sourceRowHash) {
      // Same values → exact duplicate
      staged.push({
        tableId,
        naturalKeyHash,
        sourceRowHash,
        changeType: 'exact_duplicate',
        values: row.values,
        naturalKeyDisplay,
        sourceRow: row.sourceRow,
      });
    } else {
      // Different values → updated record
      staged.push({
        tableId,
        naturalKeyHash,
        sourceRowHash,
        changeType: 'updated_record',
        values: row.values,
        naturalKeyDisplay,
        sourceRow: row.sourceRow,
      });
    }
  }

  return staged;
}

// ── Row aggregation (e.g. timesheet hours summing) ───────────────────────────

export interface AggregateRowsOptions {
  tableId: string;
  /** Field whose numeric values should be summed within each natural key group */
  sumField: string;
  /** Optional text field to merge (keep first non-empty) */
  mergeTextField?: string;
}

export function aggregateRows(
  tenantId: string,
  rows: NormalizedRow[],
  options: AggregateRowsOptions,
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): NormalizedRow[] {
  const { tableId, sumField, mergeTextField } = options;
  const groups = new Map<
    string,
    { sum: number; mergeText: string; sourceRow: number; values: Record<string, unknown> }
  >();

  for (const row of rows) {
    const hash = computeNaturalKeyHash(tableId, tenantId, row.values, domainConfig);
    const existing = groups.get(hash);
    const numVal = (row.values[sumField] as number) ?? 0;

    if (!existing) {
      groups.set(hash, {
        sum: numVal,
        mergeText: mergeTextField ? ((row.values[mergeTextField] as string) ?? '') : '',
        sourceRow: row.sourceRow,
        values: { ...row.values },
      });
    } else {
      existing.sum += numVal;
      if (mergeTextField) {
        const text = (row.values[mergeTextField] as string) ?? '';
        if (text && !existing.mergeText) {
          existing.mergeText = text;
        }
      }
    }
  }

  return [...groups.values()].map((g) => {
    const values: Record<string, unknown> = { ...g.values, [sumField]: g.sum };
    if (mergeTextField) {
      values[mergeTextField] = g.mergeText || null;
    }
    return {
      tableId,
      sourceRow: g.sourceRow,
      values,
      parseErrors: [],
    };
  });
}

/**
 * @deprecated Use `aggregateRows()` with explicit options instead.
 * Kept for backward compatibility with existing callers.
 */
export function aggregateTimesheetRows(tenantId: string, rows: NormalizedRow[]): NormalizedRow[] {
  return aggregateRows(tenantId, rows, {
    tableId: 'timesheet',
    sumField: 'logged_hours',
    mergeTextField: 'description',
  });
}

// ── Table-specific duplicate handling policy ─────────────────────────────────

export function shouldBlockDuplicateInUpload(
  tableId: string,
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): boolean {
  return (getTableConfig(domainConfig, tableId)?.duplicatePolicy ?? 'block') === 'block';
}
