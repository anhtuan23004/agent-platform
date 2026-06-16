import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  resourceAllocations,
  timesheets,
} from '../db/schema.ts';
import type { ConfigRow } from './thresholds.ts';
import type { AllocationRow, LeaveRow, MemberRow, TimesheetRow, WeekRow } from './types.ts';

export interface CanonicalInputs {
  members: MemberRow[];
  allocations: AllocationRow[];
  timesheets: TimesheetRow[];
  leaves: LeaveRow[];
  weeks: WeekRow[];
  configRows: ConfigRow[];
}

/**
 * Load the active canonical rows a tenant needs for utilization analytics.
 * Reads only `is_active` rows — the upsert publish step keeps exactly one
 * active row per natural key, so duplicates (F-16) are already collapsed here.
 */
export async function loadCanonicalInputs(tenantId: string): Promise<CanonicalInputs> {
  const db = pmoDb();
  const activeFilter = (table: { tenant_id: never; is_active: never }) =>
    and(eq(table.tenant_id, tenantId as never), eq(table.is_active, true as never));

  const [memberRows, allocRows, tsRows, leaveRows, weekRows, configRowsRaw] = await Promise.all([
    db
      .select({
        member_id: memberMaster.member_id,
        std_hours_week: memberMaster.std_hours_week,
        join_date: memberMaster.join_date,
      })
      .from(memberMaster)
      .where(activeFilter(memberMaster as never)),
    db
      .select({
        member_id: resourceAllocations.member_id,
        project_id: resourceAllocations.project_id,
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
        overbook_threshold: overbookIdleConfig.overbook_threshold,
        overbook_red_threshold: overbookIdleConfig.overbook_red_threshold,
        idle_threshold: overbookIdleConfig.idle_threshold,
        mismatch_pct_threshold: overbookIdleConfig.mismatch_pct_threshold,
        ot_max_hours_per_week: overbookIdleConfig.ot_max_hours_per_week,
        effective_date: overbookIdleConfig.effective_date,
      })
      .from(overbookIdleConfig)
      .where(activeFilter(overbookIdleConfig as never)),
  ]);

  return {
    members: memberRows as MemberRow[],
    allocations: allocRows as AllocationRow[],
    timesheets: tsRows as TimesheetRow[],
    leaves: leaveRows as LeaveRow[],
    weeks: weekRows as WeekRow[],
    configRows: configRowsRaw as ConfigRow[],
  };
}
