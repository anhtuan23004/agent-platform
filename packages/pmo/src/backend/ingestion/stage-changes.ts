import { createHash } from 'node:crypto';
import { PMO_CANONICAL_SCHEMA } from './canonical-schema.ts';
import type { NormalizedRow } from './normalize-rows.ts';

// ── Natural key definitions ──────────────────────────────────────────────────

const NATURAL_KEY_FIELDS: Record<string, string[]> = {
  resource_allocation: ['member_id', 'project_id', 'start_date', 'end_date'],
  timesheet: ['member_id', 'work_date', 'project_id', 'log_category'],
  leave: ['member_id', 'leave_date', 'leave_type'],
  member_master: ['member_id'],
  project_master: ['project_id'],
  overbook_idle_config: ['config_id'],
  calendar_weeks: ['week_id'],
  kpi_norms: ['norm_id'],
};

// ── Mutable value fields (excluded from natural key, included in source_row_hash) ──

function getMutableFields(tableId: string): string[] {
  const table = PMO_CANONICAL_SCHEMA.tables.find((t) => t.id === tableId);
  if (!table) return [];
  const keyFields = new Set(NATURAL_KEY_FIELDS[tableId] ?? []);
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
): string {
  const keyFields = NATURAL_KEY_FIELDS[tableId] ?? [];
  const payload = stableStringify({ ...values, __tenant: tenantId }, ['__tenant', ...keyFields]);
  return createHash('sha256').update(payload).digest('hex');
}

export function computeSourceRowHash(tableId: string, values: Record<string, unknown>): string {
  const mutableFields = getMutableFields(tableId);
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

export interface ActiveRecord {
  natural_key_hash: string;
  source_row_hash: string;
}

export function classifyRows(
  tableId: string,
  tenantId: string,
  normalizedRows: NormalizedRow[],
  activeRecords: ActiveRecord[],
): StagedRow[] {
  const activeMap = new Map<string, string>();
  for (const rec of activeRecords) {
    activeMap.set(rec.natural_key_hash, rec.source_row_hash);
  }

  // Track keys seen in this upload for duplicate_in_upload detection
  const seenInUpload = new Map<string, number>(); // hash → first index
  const staged: StagedRow[] = [];

  for (let i = 0; i < normalizedRows.length; i++) {
    const row = normalizedRows[i]!;
    const naturalKeyHash = computeNaturalKeyHash(tableId, tenantId, row.values);
    const sourceRowHash = computeSourceRowHash(tableId, row.values);

    const keyFields = NATURAL_KEY_FIELDS[tableId] ?? [];
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

// ── Timesheet aggregation ────────────────────────────────────────────────────

export function aggregateTimesheetRows(tenantId: string, rows: NormalizedRow[]): NormalizedRow[] {
  const groups = new Map<
    string,
    { hours: number; description: string; sourceRow: number; values: Record<string, unknown> }
  >();

  for (const row of rows) {
    const hash = computeNaturalKeyHash('timesheet', tenantId, row.values);
    const existing = groups.get(hash);
    const hours = (row.values.logged_hours as number) ?? 0;

    if (!existing) {
      groups.set(hash, {
        hours,
        description: (row.values.description as string) ?? '',
        sourceRow: row.sourceRow,
        values: { ...row.values },
      });
    } else {
      // Aggregate: sum hours, keep latest non-empty description
      existing.hours += hours;
      const desc = (row.values.description as string) ?? '';
      if (desc && !existing.description) {
        existing.description = desc;
      }
    }
  }

  return [...groups.values()].map((g) => ({
    tableId: 'timesheet',
    sourceRow: g.sourceRow,
    values: { ...g.values, logged_hours: g.hours, description: g.description || null },
    parseErrors: [],
  }));
}

// ── Table-specific duplicate handling policy ─────────────────────────────────

export function shouldBlockDuplicateInUpload(tableId: string): boolean {
  // Timesheet duplicates are aggregated, not blocked
  if (tableId === 'timesheet') return false;
  return true;
}
