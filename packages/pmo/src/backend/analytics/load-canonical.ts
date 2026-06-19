import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
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
          weekly_planned_hours: resourceAllocations.weekly_planned_hours,
          start_date: resourceAllocations.start_date,
          end_date: resourceAllocations.end_date,
        })
        .from(resourceAllocations)
        .where(activeFilter(resourceAllocations as never)),
      db
        .select({
          member_id: timesheets.member_id,
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
