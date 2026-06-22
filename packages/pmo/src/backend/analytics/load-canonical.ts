import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  stagingChanges,
  timesheets,
} from '../db/schema.ts';
import type { ConfigRow } from './thresholds.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  ProjectRow,
  TimesheetRow,
  WeekRow,
} from './types.ts';

export interface CanonicalInputs {
  members: MemberRow[];
  projects: ProjectRow[];
  allocations: AllocationRow[];
  timesheets: TimesheetRow[];
  leaves: LeaveRow[];
  weeks: WeekRow[];
  configRows: ConfigRow[];
}

export interface CanonicalInputDateRange {
  from: Date;
  to: Date;
}

export interface LoadCanonicalInputsOptions {
  dateRange?: CanonicalInputDateRange;
  ingestionSessionId?: string;
}

function overlapsRange(
  start: Date | null,
  end: Date | null,
  range: CanonicalInputDateRange,
): boolean {
  const effectiveStart = start ?? new Date(-8640000000000000);
  const effectiveEnd = end ?? new Date(8640000000000000);
  return (
    effectiveStart.getTime() <= range.to.getTime() && effectiveEnd.getTime() >= range.from.getTime()
  );
}

function inRange(date: Date, range: CanonicalInputDateRange): boolean {
  const t = date.getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/**
 * Load the active canonical rows a tenant needs for utilization analytics.
 * Reads only `is_active` rows — the upsert publish step keeps exactly one
 * active row per natural key, so duplicates (F-16) are already collapsed here.
 */
export async function loadCanonicalInputs(
  tenantId: string,
  options: LoadCanonicalInputsOptions = {},
): Promise<CanonicalInputs> {
  const db = pmoDb();
  const activeFilter = (table: {
    tenant_id: never;
    is_active: never;
    last_ingestion_session_id: never;
  }) =>
    and(
      eq(table.tenant_id, tenantId as never),
      eq(table.is_active, true as never),
      ...(options.ingestionSessionId
        ? [eq(table.last_ingestion_session_id, options.ingestionSessionId as never)]
        : []),
    );

  const [memberRows, projectRows, allocRows, tsRows, leaveRows, weekRows, configRowsRaw] =
    await Promise.all([
      db
        .select({
          member_id: memberMaster.member_id,
          full_name: memberMaster.full_name,
          role_title: memberMaster.role_title,
          std_hours_week: memberMaster.std_hours_week,
          join_date: memberMaster.join_date,
        })
        .from(memberMaster)
        .where(activeFilter(memberMaster as never)),
      db
        .select({
          project_id: projectMaster.project_id,
          project_name: projectMaster.project_name,
          account_id: projectMaster.account_id,
          project_type: projectMaster.project_type,
          status: projectMaster.status,
          pm_id: projectMaster.pm_id,
          start_date: projectMaster.start_date,
          end_date: projectMaster.end_date,
        })
        .from(projectMaster)
        .where(activeFilter(projectMaster as never)),
      db
        .select({
          member_id: resourceAllocations.member_id,
          project_id: resourceAllocations.project_id,
          role: resourceAllocations.role,
          allocation_pct: resourceAllocations.allocation_pct,
          weekly_planned_hours: resourceAllocations.weekly_planned_hours,
          start_date: resourceAllocations.start_date,
          end_date: resourceAllocations.end_date,
        })
        .from(resourceAllocations)
        .where(activeFilter(resourceAllocations as never)),
      db
        .select({
          member_id: timesheets.member_id,
          project_id: timesheets.project_id,
          work_date: timesheets.work_date,
          logged_hours: timesheets.logged_hours,
          log_category: timesheets.log_category,
        })
        .from(timesheets)
        .where(activeFilter(timesheets as never)),
      db
        .select({
          member_id: leaveRecords.member_id,
          leave_date: leaveRecords.leave_date,
          leave_type: leaveRecords.leave_type,
          approved: leaveRecords.approved,
          duration_days: leaveRecords.duration_days,
        })
        .from(leaveRecords)
        .where(activeFilter(leaveRecords as never)),
      db
        .select({
          week_id: calendarWeeks.week_id,
          week_start: calendarWeeks.week_start,
          week_end: calendarWeeks.week_end,
          working_days: calendarWeeks.working_days,
          holiday_hours_ft: calendarWeeks.holiday_hours_ft,
        })
        .from(calendarWeeks)
        .where(activeFilter(calendarWeeks as never)),
      db
        .select({
          config_id: overbookIdleConfig.config_id,
          rule_name: overbookIdleConfig.rule_name,
          overbook_threshold: overbookIdleConfig.overbook_threshold,
          overbook_red_threshold: overbookIdleConfig.overbook_red_threshold,
          idle_threshold: overbookIdleConfig.idle_threshold,
          mismatch_pct_threshold: overbookIdleConfig.mismatch_pct_threshold,
          ot_max_hours_per_week: overbookIdleConfig.ot_max_hours_per_week,
          required_training_hours: overbookIdleConfig.required_training_hours,
          effective_date: overbookIdleConfig.effective_date,
        })
        .from(overbookIdleConfig)
        .where(activeFilter(overbookIdleConfig as never)),
    ]);

  const range = options.dateRange;

  return {
    members: memberRows as MemberRow[],
    projects: range
      ? (projectRows as ProjectRow[]).filter((row) =>
          overlapsRange(row.start_date, row.end_date, range),
        )
      : (projectRows as ProjectRow[]),
    allocations: range
      ? (allocRows as AllocationRow[]).filter((row) =>
          overlapsRange(row.start_date, row.end_date, range),
        )
      : (allocRows as AllocationRow[]),
    timesheets: range
      ? (tsRows as TimesheetRow[]).filter((row) => inRange(row.work_date, range))
      : (tsRows as TimesheetRow[]),
    leaves: range
      ? (leaveRows as LeaveRow[]).filter((row) => inRange(row.leave_date, range))
      : (leaveRows as LeaveRow[]),
    weeks: range
      ? (weekRows as WeekRow[]).filter((row) => overlapsRange(row.week_start, row.week_end, range))
      : (weekRows as WeekRow[]),
    configRows: configRowsRaw as ConfigRow[],
  };
}

// ── Staging preview loader ────────────────────────────────────────────────────

type StagingRow = {
  table_id: string;
  change_type: string;
  new_values: unknown;
  natural_key_hash: string;
};

function parseDateField(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function asBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toMemberRow(values: Record<string, unknown>): MemberRow | null {
  const memberId = values.member_id;
  const fullName = values.full_name;
  if (!memberId || !fullName) return null;
  return {
    member_id: asString(memberId),
    full_name: asString(fullName),
    role_title: values.role_title != null ? asString(values.role_title) : null,
    std_hours_week: asNumber(values.std_hours_week),
    join_date: parseDateField(values.join_date),
  };
}

function toProjectRow(values: Record<string, unknown>): ProjectRow | null {
  const projectId = values.project_id;
  const projectName = values.project_name;
  if (!projectId || !projectName) return null;
  return {
    project_id: asString(projectId),
    project_name: asString(projectName),
    account_id: values.account_id != null ? asString(values.account_id) : null,
    project_type: values.project_type != null ? asString(values.project_type) : null,
    status: values.status != null ? asString(values.status) : null,
    pm_id: values.pm_id != null ? asString(values.pm_id) : null,
    start_date: parseDateField(values.start_date),
    end_date: parseDateField(values.end_date),
  };
}

function toAllocationRow(values: Record<string, unknown>): AllocationRow | null {
  const memberId = values.member_id;
  const projectId = values.project_id;
  const startDate = parseDateField(values.start_date);
  const endDate = parseDateField(values.end_date);
  if (!memberId || !projectId || !startDate || !endDate) return null;
  return {
    member_id: asString(memberId),
    project_id: asString(projectId),
    role: values.role != null ? asString(values.role) : null,
    allocation_pct: asNumber(values.allocation_pct),
    weekly_planned_hours: asNumber(values.weekly_planned_hours),
    start_date: startDate,
    end_date: endDate,
  };
}

function toTimesheetRow(values: Record<string, unknown>): TimesheetRow | null {
  const memberId = values.member_id;
  const workDate = parseDateField(values.work_date);
  const loggedHours = asNumber(values.logged_hours);
  if (!memberId || !workDate || loggedHours === null) return null;
  return {
    member_id: asString(memberId),
    project_id: values.project_id != null ? asString(values.project_id) : null,
    work_date: workDate,
    logged_hours: loggedHours,
    log_category: values.log_category != null ? asString(values.log_category) : null,
  };
}

function toLeaveRow(values: Record<string, unknown>): LeaveRow | null {
  const leaveDate = parseDateField(values.leave_date);
  const leaveType = values.leave_type;
  if (!leaveDate || !leaveType) return null;
  return {
    member_id: values.member_id != null ? asString(values.member_id) : null,
    leave_date: leaveDate,
    leave_type: asString(leaveType),
    approved: asBooleanOrNull(values.approved),
    duration_days: asNumber(values.duration_days),
  };
}

function toWeekRow(values: Record<string, unknown>): WeekRow | null {
  const weekId = values.week_id;
  const weekStart = parseDateField(values.week_start);
  const weekEnd = parseDateField(values.week_end);
  const workingDays = asNumber(values.working_days);
  if (!weekId || !weekStart || !weekEnd || workingDays === null) return null;
  return {
    week_id: asString(weekId),
    week_start: weekStart,
    week_end: weekEnd,
    working_days: workingDays,
    holiday_hours_ft: asNumber(values.holiday_hours_ft),
  };
}

function toConfigRow(values: Record<string, unknown>): ConfigRow | null {
  return {
    config_id: values.config_id != null ? asString(values.config_id) : null,
    rule_name: values.rule_name != null ? asString(values.rule_name) : null,
    overbook_threshold: asNumber(values.overbook_threshold),
    overbook_red_threshold: asNumber(values.overbook_red_threshold),
    idle_threshold: asNumber(values.idle_threshold),
    mismatch_pct_threshold: asNumber(values.mismatch_pct_threshold),
    ot_max_hours_per_week: asNumber(values.ot_max_hours_per_week),
    required_training_hours: asNumber(values.required_training_hours),
    effective_date: parseDateField(values.effective_date),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Load staging data for a given ingestion session and convert JSONB
 * `new_values` into typed analytics rows. Only includes `new_record` and
 * `updated_record` changes (skips exact duplicates and in-upload duplicates).
 */
export async function loadStagingInputs(
  ingestionSessionId: string,
  options: { dateRange?: CanonicalInputDateRange } = {},
): Promise<CanonicalInputs> {
  const db = pmoDb();
  const rows: StagingRow[] = (await db
    .select({
      table_id: stagingChanges.table_id,
      change_type: stagingChanges.change_type,
      new_values: stagingChanges.new_values,
      natural_key_hash: stagingChanges.natural_key_hash,
    })
    .from(stagingChanges)
    .where(eq(stagingChanges.ingestion_session_id, ingestionSessionId))) as StagingRow[];

  const members: MemberRow[] = [];
  const projects: ProjectRow[] = [];
  const allocations: AllocationRow[] = [];
  const tss: TimesheetRow[] = [];
  const leaves: LeaveRow[] = [];
  const weeks: WeekRow[] = [];
  const configRows: ConfigRow[] = [];

  for (const row of rows) {
    if (row.change_type === 'exact_duplicate' || row.change_type === 'duplicate_in_upload') {
      continue;
    }

    const values = asRecord(row.new_values);
    if (!values) continue;

    switch (row.table_id) {
      case 'member_master': {
        const member = toMemberRow(values);
        if (member) members.push(member);
        break;
      }
      case 'project_master': {
        const project = toProjectRow(values);
        if (project) projects.push(project);
        break;
      }
      case 'resource_allocation': {
        const alloc = toAllocationRow(values);
        if (alloc) allocations.push(alloc);
        break;
      }
      case 'timesheet': {
        const ts = toTimesheetRow(values);
        if (ts) tss.push(ts);
        break;
      }
      case 'leave': {
        const leave = toLeaveRow(values);
        if (leave) leaves.push(leave);
        break;
      }
      case 'calendar_weeks': {
        const week = toWeekRow(values);
        if (week) weeks.push(week);
        break;
      }
      case 'overbook_idle_config': {
        const config = toConfigRow(values);
        if (config) configRows.push(config);
        break;
      }
    }
  }

  const range = options.dateRange;
  return {
    members,
    projects: range
      ? projects.filter((row) => overlapsRange(row.start_date, row.end_date, range))
      : projects,
    allocations: range
      ? allocations.filter((row) => overlapsRange(row.start_date, row.end_date, range))
      : allocations,
    timesheets: range ? tss.filter((row) => inRange(row.work_date, range)) : tss,
    leaves: range ? leaves.filter((row) => inRange(row.leave_date, range)) : leaves,
    weeks: range
      ? weeks.filter((row) => overlapsRange(row.week_start, row.week_end, range))
      : weeks,
    configRows,
  };
}

/**
 * Merge staging diffs on top of canonical data. Updated records (matched by
 * natural key) replace their canonical counterparts; new records are appended.
 * The result is a complete `CanonicalInputs` that represents the state of the
 * database as if the staged changes had been published.
 */
export async function loadMergedInputs(
  tenantId: string,
  ingestionSessionId: string,
  options: { dateRange?: CanonicalInputDateRange } = {},
): Promise<CanonicalInputs> {
  const [canonical, staging] = await Promise.all([
    loadCanonicalInputs(tenantId, { dateRange: options.dateRange }),
    loadStagingInputs(ingestionSessionId, { dateRange: options.dateRange }),
  ]);

  return {
    members: mergeByKey(canonical.members, staging.members, (r) => r.member_id),
    projects: mergeByKey(canonical.projects, staging.projects, (r) => r.project_id),
    allocations: mergeByCompositeKey(
      canonical.allocations,
      staging.allocations,
      (r) => `${r.member_id}::${r.project_id}::${r.start_date.toISOString()}`,
    ),
    timesheets: mergeByCompositeKey(
      canonical.timesheets,
      staging.timesheets,
      (r) => `${r.member_id}::${r.project_id ?? ''}::${r.work_date.toISOString()}`,
    ),
    leaves: mergeByCompositeKey(
      canonical.leaves,
      staging.leaves,
      (r) => `${r.member_id ?? ''}::${r.leave_date.toISOString()}::${r.leave_type}`,
    ),
    weeks: mergeByKey(canonical.weeks, staging.weeks, (r) => r.week_id),
    configRows: staging.configRows.length > 0 ? staging.configRows : canonical.configRows,
  };
}

/**
 * Overlay staging rows on canonical rows, matching by a single primary key.
 * Staging rows with a matching key replace the canonical row; unmatched staging
 * rows are appended.
 */
function mergeByKey<T>(canonical: T[], staging: T[], keyFn: (row: T) => string): T[] {
  if (staging.length === 0) return canonical;
  const stagingKeys = new Set(staging.map(keyFn));
  const kept = canonical.filter((row) => !stagingKeys.has(keyFn(row)));
  return [...kept, ...staging];
}

/**
 * Same as `mergeByKey` but for tables where the natural key is a composite of
 * multiple fields.
 */
function mergeByCompositeKey<T>(canonical: T[], staging: T[], keyFn: (row: T) => string): T[] {
  return mergeByKey(canonical, staging, keyFn);
}
