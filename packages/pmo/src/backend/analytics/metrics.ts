import { computeAvailableHours } from './available-hours.ts';
import {
  computeBillableHours,
  computeLoggedHours,
  computePlannedHours,
  computeTrainingHours,
} from './planned-hours.ts';
import type { AllocationRow, LeaveRow, TimesheetRow, WeekRow } from './types.ts';

export interface WeekMetricInputs {
  memberId: string;
  stdHoursWeek: number;
  week: WeekRow;
  allocations: AllocationRow[]; // member's allocations
  timesheets: TimesheetRow[]; // member's timesheets
  leaves: LeaveRow[]; // all leaves (filtered inside by member)
  overtimeHours?: number; // approved OT hours for this member-week
  requiredTrainingHours?: number; // N12 denominator (0 = not tracked)
}

export interface WeekMetrics {
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  expectedLoggedHours: number;
  billableHours: number;
  benchHours: number;
  overtimeHours: number;
  trainingHours: number;
  busyRate: number | null; // N01: planned / available
  utilization: number | null; // N02: logged / available
  billableRate: number | null; // N03: billable / logged
  benchRate: number | null; // N04: bench / available
  overtimeRatio: number | null; // N05: overtime / standard
  effortConsumption: number | null; // N06: logged / planned
  trainingCompliance: number | null; // N12: training / required (null when no required training configured)
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
    requiredTrainingHours = 0,
  } = inputs;

  const availableHours = computeAvailableHours(memberId, stdHoursWeek, week, leaves);
  const plannedHours = computePlannedHours({
    allocations,
    week,
    availableHours,
    stdHoursWeek,
  });
  const loggedHours = computeLoggedHours(timesheets, week);
  const expectedLoggedHours = plannedHours;
  const billableHours = computeBillableHours(timesheets, week);
  const trainingHours = computeTrainingHours(timesheets, week);
  const benchHours = Math.max(0, availableHours - plannedHours);

  const busyRate = availableHours > 0 ? plannedHours / availableHours : null;
  const utilization = availableHours > 0 ? loggedHours / availableHours : null;
  const billableRate = loggedHours > 0 ? billableHours / loggedHours : null;
  const benchRate = availableHours > 0 ? benchHours / availableHours : null;
  const overtimeRatio = stdHoursWeek > 0 ? overtimeHours / stdHoursWeek : null;
  const effortConsumption = plannedHours > 0 ? loggedHours / plannedHours : null;
  const trainingCompliance =
    requiredTrainingHours > 0 ? trainingHours / requiredTrainingHours : null;

  return {
    availableHours,
    plannedHours,
    loggedHours,
    expectedLoggedHours,
    billableHours,
    trainingHours,
    benchHours,
    overtimeHours,
    busyRate,
    utilization,
    billableRate,
    benchRate,
    overtimeRatio,
    effortConsumption,
    trainingCompliance,
  };
}

/** Round to 4 decimals for stable storage / comparison. */
export function round4(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 10000) / 10000;
}
