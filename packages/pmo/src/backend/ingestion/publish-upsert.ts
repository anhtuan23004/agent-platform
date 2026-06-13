import { eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  kpiNorms,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  stagingChanges,
  timesheets,
} from '../db/schema.ts';
import { computeSourceRowHash } from './stage-changes.ts';

export interface PublishResult {
  rowsWritten: Record<string, number>;
  rowsUpdated: Record<string, number>;
  rowsSkipped: Record<string, number>;
}

type CanonicalTableId =
  | 'resource_allocation'
  | 'timesheet'
  | 'leave'
  | 'member_master'
  | 'project_master'
  | 'overbook_idle_config'
  | 'calendar_weeks'
  | 'kpi_norms';

const TABLE_IDS = new Set<CanonicalTableId>([
  'resource_allocation',
  'timesheet',
  'leave',
  'member_master',
  'project_master',
  'overbook_idle_config',
  'calendar_weeks',
  'kpi_norms',
]);

const REQUIRED_FIELDS: Record<CanonicalTableId, string[]> = {
  resource_allocation: ['member_id', 'project_id', 'allocation_pct', 'start_date', 'end_date'],
  timesheet: ['member_id', 'work_date', 'logged_hours'],
  leave: ['leave_date', 'leave_type'],
  member_master: ['member_id', 'full_name'],
  project_master: ['project_id', 'project_name'],
  overbook_idle_config: ['config_id', 'rule_name', 'overbook_threshold', 'idle_threshold'],
  calendar_weeks: ['week_id', 'week_start', 'week_end', 'working_days'],
  kpi_norms: ['norm_id', 'metric'],
};

export interface PublishValidationIssue {
  tableId: string;
  naturalKeyHash: string;
  reason: string;
}

function asTableId(value: string): CanonicalTableId | null {
  return TABLE_IDS.has(value as CanonicalTableId) ? (value as CanonicalTableId) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

function missingRequiredFields(
  tableId: CanonicalTableId,
  values: Record<string, unknown>,
): string[] {
  const requiredFields = REQUIRED_FIELDS[tableId] ?? [];
  return requiredFields.filter((field) => isMissingRequiredValue(values[field]));
}

function formatValidationError(issues: PublishValidationIssue[]): string {
  const preview = issues
    .slice(0, 8)
    .map((issue) => `${issue.tableId}[${issue.naturalKeyHash.slice(0, 8)}]: ${issue.reason}`)
    .join('; ');
  const tail = issues.length > 8 ? `; and ${issues.length - 8} more issue(s)` : '';
  return `invalid_staging_rows: ${preview}${tail}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const asText = typeof value === 'string' ? value.trim() : String(value).trim();
  return asText === '' ? null : asText;
}

function requireString(
  values: Record<string, unknown>,
  field: string,
  tableId: CanonicalTableId,
): string {
  const normalized = normalizeOptionalString(values[field]);
  if (normalized !== null) return normalized;
  throw new Error(`invalid_value:${tableId}.${field}:required string is missing`);
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function requireNumber(
  values: Record<string, unknown>,
  field: string,
  tableId: CanonicalTableId,
): number {
  const normalized = normalizeOptionalNumber(values[field]);
  if (normalized !== null) return normalized;
  throw new Error(`invalid_value:${tableId}.${field}:required number is missing`);
}

function normalizeOptionalInteger(value: unknown): number | null {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === null) return null;
  return Number.isInteger(normalized) ? normalized : Math.round(normalized);
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(normalized)) return true;
    if (['false', 'no', '0', 'n'].includes(normalized)) return false;
  }
  return null;
}

function normalizeOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function requireDate(
  values: Record<string, unknown>,
  field: string,
  tableId: CanonicalTableId,
): Date {
  const normalized = normalizeOptionalDate(values[field]);
  if (normalized !== null) return normalized;
  throw new Error(`invalid_value:${tableId}.${field}:required date is missing`);
}

function requireObjectValues(change: {
  table_id: string;
  natural_key_hash: string;
  new_values: unknown;
}): Record<string, unknown> {
  const values = asRecord(change.new_values);
  if (values) return values;
  throw new Error(
    `invalid_staging_values:${change.table_id}[${change.natural_key_hash.slice(0, 8)}]: new_values must be an object`,
  );
}

export function collectPublishValidationIssues(
  changes: Array<{
    table_id: string;
    natural_key_hash: string;
    change_type: string;
    new_values: unknown;
  }>,
): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];

  for (const change of changes) {
    if (change.change_type === 'exact_duplicate' || change.change_type === 'duplicate_in_upload') {
      continue;
    }

    const tableId = asTableId(change.table_id);
    if (!tableId) {
      issues.push({
        tableId: change.table_id,
        naturalKeyHash: change.natural_key_hash,
        reason: 'unsupported table id',
      });
      continue;
    }

    const values = asRecord(change.new_values);
    if (!values) {
      issues.push({
        tableId,
        naturalKeyHash: change.natural_key_hash,
        reason: 'new_values must be an object',
      });
      continue;
    }

    const missingFields = missingRequiredFields(tableId, values);
    if (missingFields.length > 0) {
      issues.push({
        tableId,
        naturalKeyHash: change.natural_key_hash,
        reason: `missing required field(s): ${missingFields.join(', ')}`,
      });
    }
  }

  return issues;
}

/**
 * Reads staging_changes for a session and executes upserts into canonical tables.
 * Returns counts of written/updated/skipped rows.
 */
export async function publishUpsert(
  ingestionSessionId: string,
  tenantId: string,
): Promise<PublishResult> {
  const db = pmoDb();
  return db.transaction(async (tx) => {
    const changes = await tx
      .select()
      .from(stagingChanges)
      .where(eq(stagingChanges.ingestion_session_id, ingestionSessionId));

    const validationIssues = collectPublishValidationIssues(changes);
    if (validationIssues.length > 0) {
      throw new Error(formatValidationError(validationIssues));
    }

    const rowsWritten: Record<string, number> = {};
    const rowsUpdated: Record<string, number> = {};
    const rowsSkipped: Record<string, number> = {};

    for (const change of changes) {
      const tableIdRaw = change.table_id;
      if (!rowsWritten[tableIdRaw]) rowsWritten[tableIdRaw] = 0;
      if (!rowsUpdated[tableIdRaw]) rowsUpdated[tableIdRaw] = 0;
      if (!rowsSkipped[tableIdRaw]) rowsSkipped[tableIdRaw] = 0;

      if (
        change.change_type === 'exact_duplicate' ||
        change.change_type === 'duplicate_in_upload'
      ) {
        rowsSkipped[tableIdRaw]++;
        continue;
      }

      const tableId = asTableId(tableIdRaw);
      if (!tableId) {
        rowsSkipped[tableIdRaw]++;
        continue;
      }

      const values = requireObjectValues(change);
      const sourceRowHash = computeSourceRowHash(tableId, values);

      if (change.change_type === 'new_record') {
        rowsWritten[tableIdRaw]++;
      } else if (change.change_type === 'updated_record') {
        rowsUpdated[tableIdRaw]++;
      }

      await upsertRow(tx as ReturnType<typeof pmoDb>, {
        tableId,
        naturalKeyHash: change.natural_key_hash,
        sourceRowHash,
        tenantId,
        sessionId: ingestionSessionId,
        values,
      });
    }

    await tx
      .delete(stagingChanges)
      .where(eq(stagingChanges.ingestion_session_id, ingestionSessionId));

    return { rowsWritten, rowsUpdated, rowsSkipped };
  });
}

async function upsertRow(
  db: ReturnType<typeof pmoDb>,
  input: {
    tableId: CanonicalTableId;
    naturalKeyHash: string;
    sourceRowHash: string;
    tenantId: string;
    sessionId: string;
    values: Record<string, unknown>;
  },
): Promise<void> {
  const { tableId, naturalKeyHash, sourceRowHash, tenantId, sessionId, values } = input;

  if (tableId === 'resource_allocation') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      member_id: requireString(values, 'member_id', tableId),
      project_id: requireString(values, 'project_id', tableId),
      role: normalizeOptionalString(values.role),
      allocation_pct: requireNumber(values, 'allocation_pct', tableId),
      start_date: requireDate(values, 'start_date', tableId),
      end_date: requireDate(values, 'end_date', tableId),
      weekly_planned_hours: normalizeOptionalNumber(values.weekly_planned_hours),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(resourceAllocations)
      .values(row)
      .onConflictDoUpdate({
        target: [resourceAllocations.tenant_id, resourceAllocations.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          member_id: row.member_id,
          project_id: row.project_id,
          role: row.role,
          allocation_pct: row.allocation_pct,
          start_date: row.start_date,
          end_date: row.end_date,
          weekly_planned_hours: row.weekly_planned_hours,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'timesheet') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      member_id: requireString(values, 'member_id', tableId),
      project_id: normalizeOptionalString(values.project_id),
      work_date: requireDate(values, 'work_date', tableId),
      logged_hours: requireNumber(values, 'logged_hours', tableId),
      log_category: normalizeOptionalString(values.log_category),
      task_ref: normalizeOptionalString(values.task_ref),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(timesheets)
      .values(row)
      .onConflictDoUpdate({
        target: [timesheets.tenant_id, timesheets.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          member_id: row.member_id,
          project_id: row.project_id,
          work_date: row.work_date,
          logged_hours: row.logged_hours,
          log_category: row.log_category,
          task_ref: row.task_ref,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'leave') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      record_id: normalizeOptionalString(values.record_id),
      member_id: normalizeOptionalString(values.member_id),
      leave_date: requireDate(values, 'leave_date', tableId),
      leave_type: requireString(values, 'leave_type', tableId),
      approved: normalizeOptionalBoolean(values.approved),
      duration_days: normalizeOptionalNumber(values.duration_days),
      note: normalizeOptionalString(values.note),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(leaveRecords)
      .values(row)
      .onConflictDoUpdate({
        target: [leaveRecords.tenant_id, leaveRecords.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          record_id: row.record_id,
          member_id: row.member_id,
          leave_date: row.leave_date,
          leave_type: row.leave_type,
          approved: row.approved,
          duration_days: row.duration_days,
          note: row.note,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'member_master') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      member_id: requireString(values, 'member_id', tableId),
      full_name: requireString(values, 'full_name', tableId),
      department: normalizeOptionalString(values.department),
      role_title: normalizeOptionalString(values.role_title),
      level: normalizeOptionalString(values.level),
      line_manager_id: normalizeOptionalString(values.line_manager_id),
      employment_status: normalizeOptionalString(values.employment_status),
      employment: normalizeOptionalString(values.employment),
      std_hours_week: normalizeOptionalNumber(values.std_hours_week),
      join_date: normalizeOptionalDate(values.join_date),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(memberMaster)
      .values(row)
      .onConflictDoUpdate({
        target: [memberMaster.tenant_id, memberMaster.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          member_id: row.member_id,
          full_name: row.full_name,
          department: row.department,
          role_title: row.role_title,
          level: row.level,
          line_manager_id: row.line_manager_id,
          employment_status: row.employment_status,
          employment: row.employment,
          std_hours_week: row.std_hours_week,
          join_date: row.join_date,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'project_master') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      project_id: requireString(values, 'project_id', tableId),
      project_name: requireString(values, 'project_name', tableId),
      account_id: normalizeOptionalString(values.account_id),
      project_type: normalizeOptionalString(values.project_type),
      status: normalizeOptionalString(values.status),
      pm_id: normalizeOptionalString(values.pm_id),
      start_date: normalizeOptionalDate(values.start_date),
      end_date: normalizeOptionalDate(values.end_date),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(projectMaster)
      .values(row)
      .onConflictDoUpdate({
        target: [projectMaster.tenant_id, projectMaster.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          project_id: row.project_id,
          project_name: row.project_name,
          account_id: row.account_id,
          project_type: row.project_type,
          status: row.status,
          pm_id: row.pm_id,
          start_date: row.start_date,
          end_date: row.end_date,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'overbook_idle_config') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      config_id: requireString(values, 'config_id', tableId),
      rule_name: requireString(values, 'rule_name', tableId),
      overbook_threshold: requireNumber(values, 'overbook_threshold', tableId),
      overbook_red_threshold: normalizeOptionalNumber(values.overbook_red_threshold),
      idle_threshold: requireNumber(values, 'idle_threshold', tableId),
      mismatch_pct_threshold: normalizeOptionalNumber(values.mismatch_pct_threshold),
      ot_max_hours_per_week: normalizeOptionalNumber(values.ot_max_hours_per_week),
      effective_date: normalizeOptionalDate(values.effective_date),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(overbookIdleConfig)
      .values(row)
      .onConflictDoUpdate({
        target: [overbookIdleConfig.tenant_id, overbookIdleConfig.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          config_id: row.config_id,
          rule_name: row.rule_name,
          overbook_threshold: row.overbook_threshold,
          overbook_red_threshold: row.overbook_red_threshold,
          idle_threshold: row.idle_threshold,
          mismatch_pct_threshold: row.mismatch_pct_threshold,
          ot_max_hours_per_week: row.ot_max_hours_per_week,
          effective_date: row.effective_date,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'calendar_weeks') {
    const workingDays = Math.round(requireNumber(values, 'working_days', tableId));
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      week_id: requireString(values, 'week_id', tableId),
      week_start: requireDate(values, 'week_start', tableId),
      week_end: requireDate(values, 'week_end', tableId),
      working_days: workingDays,
      holiday_hours_ft: normalizeOptionalNumber(values.holiday_hours_ft),
      note: normalizeOptionalString(values.note),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(calendarWeeks)
      .values(row)
      .onConflictDoUpdate({
        target: [calendarWeeks.tenant_id, calendarWeeks.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          week_id: row.week_id,
          week_start: row.week_start,
          week_end: row.week_end,
          working_days: row.working_days,
          holiday_hours_ft: row.holiday_hours_ft,
          note: row.note,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
    return;
  }

  if (tableId === 'kpi_norms') {
    const row = {
      tenant_id: tenantId,
      natural_key_hash: naturalKeyHash,
      source_row_hash: sourceRowHash,
      last_ingestion_session_id: sessionId,
      is_active: true,
      norm_id: requireString(values, 'norm_id', tableId),
      metric: requireString(values, 'metric', tableId),
      formula: normalizeOptionalString(values.formula),
      green: normalizeOptionalString(values.green),
      yellow: normalizeOptionalString(values.yellow),
      red: normalizeOptionalString(values.red),
      used_for: normalizeOptionalString(values.used_for),
      source_row: normalizeOptionalInteger(values.source_row),
    };

    await db
      .insert(kpiNorms)
      .values(row)
      .onConflictDoUpdate({
        target: [kpiNorms.tenant_id, kpiNorms.natural_key_hash],
        set: {
          source_row_hash: row.source_row_hash,
          last_ingestion_session_id: row.last_ingestion_session_id,
          is_active: true,
          norm_id: row.norm_id,
          metric: row.metric,
          formula: row.formula,
          green: row.green,
          yellow: row.yellow,
          red: row.red,
          used_for: row.used_for,
          source_row: row.source_row,
          updated_at: new Date(),
        },
      });
  }
}
