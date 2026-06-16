import { allocationActiveInWeek, dateInWeek } from './dates.ts';
import type { AllocationRow, TimesheetRow, WeekRow } from './types.ts';

/**
 * Planned hours for a member in a week = SUM of weekly_planned_hours across all
 * allocations active that week.
 *
 * Allocations are already de-duplicated at ingest (natural key
 * member+project+start+end → duplicate_in_upload skipped on publish), so a
 * naive SUM here is correct — the duplicated EMP-010×PRJ-002 RA row (F-16) only
 * contributes once in the canonical table.
 */
export function computePlannedHours(allocations: AllocationRow[], week: WeekRow): number {
  let hours = 0;
  for (const alloc of allocations) {
    if (!allocationActiveInWeek(alloc.start_date, alloc.end_date, week)) continue;
    hours += alloc.weekly_planned_hours ?? 0;
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
