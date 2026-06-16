import { dateInWeek } from './dates.ts';
import type { LeaveRow, WeekRow } from './types.ts';

// Leave types that represent genuine absence and therefore reduce available
// hours. "Approved OT Comp" is extra work (does not reduce availability) and
// "Training" keeps the member available (counted as productive presence).
const ABSENCE_LEAVE_TYPES = new Set([
  'annual leave',
  'sick leave',
  'sick',
  'maternity',
  'maternity leave',
  'public holiday',
  'unpaid leave',
]);

export function isAbsenceLeaveType(leaveType: string): boolean {
  return ABSENCE_LEAVE_TYPES.has(leaveType.trim().toLowerCase());
}

/** Standard hours for one working day given a member's weekly standard. */
export function dailyStandardHours(stdHoursWeek: number): number {
  return stdHoursWeek / 5;
}

/**
 * Member-specific approved absence hours within a week.
 *
 * Company-wide holidays (member_id = null) are EXCLUDED here — they are already
 * reflected in `working_days` on the calendar week, so subtracting them again
 * would double-count (PMO_02 F-14).
 */
export function computeLeaveHours(
  memberId: string,
  stdHoursWeek: number,
  week: WeekRow,
  leaves: LeaveRow[],
): number {
  const perDay = dailyStandardHours(stdHoursWeek);
  let hours = 0;
  for (const leave of leaves) {
    if (leave.member_id !== memberId) continue; // excludes company-wide (null)
    if (leave.approved !== true) continue;
    if (!isAbsenceLeaveType(leave.leave_type)) continue;
    if (!dateInWeek(leave.leave_date, week)) continue;
    hours += (leave.duration_days ?? 1) * perDay;
  }
  return hours;
}

/**
 * Available hours for a member in a week:
 *   std × (working_days / 5) − approved member-specific absence.
 *
 * PT-aware (std=20 → half capacity, F-17) and holiday-aware via working_days
 * (W3 = 4 days → 80% capacity, F-14). Never negative.
 */
export function computeAvailableHours(
  memberId: string,
  stdHoursWeek: number,
  week: WeekRow,
  leaves: LeaveRow[],
): number {
  const baseCapacity = stdHoursWeek * (week.working_days / 5);
  const leaveHours = computeLeaveHours(memberId, stdHoursWeek, week, leaves);
  return Math.max(0, baseCapacity - leaveHours);
}

const APPROVED_OT_TYPE = 'approved ot comp';

/**
 * Approved overtime hours for a member in a week, from leave/holiday records of
 * type "Approved OT Comp" (DS04). Each record's duration_days × std/5 = hours.
 * Used for N05 Overtime Ratio and to exclude sanctioned-OT weeks from mismatch.
 */
export function computeOvertimeHours(
  memberId: string,
  stdHoursWeek: number,
  week: WeekRow,
  leaves: LeaveRow[],
): number {
  const perDay = dailyStandardHours(stdHoursWeek);
  let hours = 0;
  for (const leave of leaves) {
    if (leave.member_id !== memberId) continue;
    if (leave.approved !== true) continue;
    if (leave.leave_type.trim().toLowerCase() !== APPROVED_OT_TYPE) continue;
    if (!dateInWeek(leave.leave_date, week)) continue;
    hours += (leave.duration_days ?? 1) * perDay;
  }
  return hours;
}
