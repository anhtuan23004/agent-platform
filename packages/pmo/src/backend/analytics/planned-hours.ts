import { allocationActiveInWeek, dateInWeek } from './dates.ts';
import type { AllocationRow, TimesheetRow, WeekRow } from './types.ts';

/**
 * Planned hours for a member in a week.
 *
 * Preferred formula follows capacity-adjusted allocation percentages:
 *   allocation_pct * available_hours
 *
 * When allocation_pct is unavailable, fall back to weekly_planned_hours scaled
 * to the week's effective capacity:
 *   weekly_planned_hours * (available_hours / std_hours_week)
 *
 * Allocations are already de-duplicated at ingest (natural key
 * member+project+start+end → duplicate_in_upload skipped on publish), so a
 * naive SUM here is correct — the duplicated EMP-010×PRJ-002 RA row (F-16) only
 * contributes once in the canonical table.
 */
export function computePlannedHours(params: {
  allocations: AllocationRow[];
  week: WeekRow;
  availableHours: number;
  stdHoursWeek: number;
}): number {
  const { allocations, week, availableHours, stdHoursWeek } = params;
  let hours = 0;
  for (const alloc of allocations) {
    if (!allocationActiveInWeek(alloc.start_date, alloc.end_date, week)) continue;
    if (alloc.allocation_pct !== null) {
      hours += alloc.allocation_pct * availableHours;
      continue;
    }
    if (alloc.weekly_planned_hours !== null && stdHoursWeek > 0) {
      hours += alloc.weekly_planned_hours * (availableHours / stdHoursWeek);
    }
  }
  return hours;
}

/** Logged hours for a member in a week = SUM of logged_hours on dates in week. */
export function computeLoggedHours(timesheets: TimesheetRow[], week: WeekRow): number {
  let hours = 0;
  for (const ts of timesheets) {
    if (!dateInWeek(ts.work_date, week)) continue;
    hours += ts.logged_hours ?? 0;
  }
  return hours;
}

/**
 * Billable hours = SUM of logged_hours where log_category is project work
 * (revenue-generating). Internal/Training/Admin are non-billable. Match is
 * case-insensitive on 'project'.
 */
export function computeBillableHours(timesheets: TimesheetRow[], week: WeekRow): number {
  let hours = 0;
  for (const ts of timesheets) {
    if (!dateInWeek(ts.work_date, week)) continue;
    if ((ts.log_category ?? '').trim().toLowerCase() !== 'project') continue;
    hours += ts.logged_hours ?? 0;
  }
  return hours;
}

/**
 * Training hours = SUM of logged_hours where log_category is training
 * (non-project, non-billable). Case-insensitive on 'training'.
 */
export function computeTrainingHours(timesheets: TimesheetRow[], week: WeekRow): number {
  let hours = 0;
  for (const ts of timesheets) {
    if (!dateInWeek(ts.work_date, week)) continue;
    if ((ts.log_category ?? '').trim().toLowerCase() !== 'training') continue;
    hours += ts.logged_hours ?? 0;
  }
  return hours;
}

/** Logged hours for one member × project × week. */
export function computeLoggedHoursForProject(
  timesheets: TimesheetRow[],
  projectId: string,
  week: WeekRow,
): number {
  let hours = 0;
  for (const ts of timesheets) {
    if (ts.project_id !== projectId) continue;
    if (!dateInWeek(ts.work_date, week)) continue;
    hours += ts.logged_hours ?? 0;
  }
  return hours;
}
