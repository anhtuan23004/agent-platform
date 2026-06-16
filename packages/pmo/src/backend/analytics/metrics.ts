import { computeAvailableHours } from './available-hours.ts';
import { computeBillableHours, computeLoggedHours, computePlannedHours } from './planned-hours.ts';
import type { AllocationRow, LeaveRow, TimesheetRow, WeekRow } from './types.ts';

export interface WeekMetricInputs {
  memberId: string;
  stdHoursWeek: number;
  week: WeekRow;
  allocations: AllocationRow[]; // member's allocations
  timesheets: TimesheetRow[]; // member's timesheets
  leaves: LeaveRow[]; // all leaves (filtered inside by member)
  overtimeHours?: number; // approved OT hours for this member-week
}

export interface WeekMetrics {
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  expectedLoggedHours: number;
  billableHours: number;
  benchHours: number;
  overtimeHours: number;
  busyRate: number | null; // N01: planned / available
  utilization: number | null; // N02: logged / available
  billableRate: number | null; // N03: billable / logged
  benchRate: number | null; // N04: bench / available
  overtimeRatio: number | null; // N05: overtime / standard
  effortConsumption: number | null; // N06: logged / planned
}

/**
 * Compute the per-week metrics for one member, using the REF_KPI_Norms
 * (official) formulas:
 *   N01 Busy        = planned / available
 *   N02 Utilization = logged / available
 *   N03 Billable    = billable / logged
 *   N04 Bench       = max(0, available − planned) / available
 *   N05 Overtime    = overtime / standard
 *   N06 Effort      = logged / planned
 *
 * Because Busy/Effort divide by availability/plan directly, a holiday or
 * leave week inflates these ratios — those weeks are excluded at the
 * member-level aggregation step (see findings.ts), not neutralised here.
 */
export function computeWeekMetrics(inputs: WeekMetricInputs): WeekMetrics {
  const {
    memberId,
    stdHoursWeek,
    week,
    allocations,
    timesheets,
    leaves,
    overtimeHours = 0,
  } = inputs;

  const availableHours = computeAvailableHours(memberId, stdHoursWeek, week, leaves);
  const plannedHours = computePlannedHours(allocations, week);
  const loggedHours = computeLoggedHours(timesheets, week);
  const expectedLoggedHours = stdHoursWeek > 0 ? plannedHours * (availableHours / stdHoursWeek) : 0;
  const billableHours = computeBillableHours(timesheets, week);
  const benchHours = Math.max(0, availableHours - plannedHours);

  const busyRate = availableHours > 0 ? plannedHours / availableHours : null;
  const utilization = availableHours > 0 ? loggedHours / availableHours : null;
  const billableRate = loggedHours > 0 ? billableHours / loggedHours : null;
  const benchRate = availableHours > 0 ? benchHours / availableHours : null;
  const overtimeRatio = stdHoursWeek > 0 ? overtimeHours / stdHoursWeek : null;
  const effortConsumption = expectedLoggedHours > 0 ? loggedHours / expectedLoggedHours : null;

  return {
    availableHours,
    plannedHours,
    loggedHours,
    expectedLoggedHours,
    billableHours,
    benchHours,
    overtimeHours,
    busyRate,
    utilization,
    billableRate,
    benchRate,
    overtimeRatio,
    effortConsumption,
  };
}

/** Round to 4 decimals for stable storage / comparison. */
export function round4(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 10000) / 10000;
}
