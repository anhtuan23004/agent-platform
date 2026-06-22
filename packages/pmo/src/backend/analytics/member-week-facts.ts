import { computeOvertimeHours } from './available-hours.ts';
import { classifyRag } from './classify.ts';
import type { DateRange } from './dates.ts';
import { sortWeeks, weekCoverageFraction } from './dates.ts';
import {
  buildMemberWeekProjectFacts,
  type MemberWeekProjectFact,
} from './member-week-project-facts.ts';
import { computeWeekMetrics, round4 } from './metrics.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  MemberWeekFact,
  ProjectRow,
  Thresholds,
  TimesheetRow,
  WeekRow,
} from './types.ts';

export interface BuildFactsInputs {
  members: MemberRow[];
  allocations: AllocationRow[];
  timesheets: TimesheetRow[];
  leaves: LeaveRow[];
  weeks: WeekRow[];
  thresholds: Thresholds;
  /** When omitted, stub Active projects are inferred from allocation / timesheet keys. */
  projects?: ProjectRow[];
  /** Default standard week when a member has no std_hours_week (FT assumption). */
  defaultStdHoursWeek?: number;
  /** Prorate boundary weeks when the reporting range cuts through calendar weeks. */
  dateRange?: DateRange;
}

function indexByMember<T extends { member_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.member_id) ?? [];
    list.push(row);
    map.set(row.member_id, list);
  }
  return map;
}

function preHireFact(memberId: string, weekId: string): MemberWeekFact {
  return {
    memberId,
    weekId,
    scopeStatus: 'PRE_HIRE',
    availableHours: 0,
    plannedHours: 0,
    loggedHours: 0,
    expectedLoggedHours: 0,
    billableHours: 0,
    benchHours: 0,
    overtimeHours: 0,
    trainingHours: 0,
    busyRate: null,
    utilization: null,
    billableRate: null,
    benchRate: null,
    overtimeRatio: null,
    effortConsumption: null,
    trainingCompliance: null,
    ragColor: 'none',
    issueType: 'ok',
  };
}

function inferProjectsFromAllocations(
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
): ProjectRow[] {
  const ids = new Set<string>();
  for (const allocation of allocations) ids.add(allocation.project_id);
  for (const timesheet of timesheets) {
    if (timesheet.project_id) ids.add(timesheet.project_id);
  }
  return [...ids].sort().map((project_id) => ({
    project_id,
    project_name: project_id,
    account_id: null,
    project_type: null,
    status: 'Active',
    pm_id: null,
    start_date: null,
    end_date: null,
  }));
}

function sumProjectHours(
  projectFacts: MemberWeekProjectFact[],
): Map<string, { planned: number; logged: number }> {
  const sums = new Map<string, { planned: number; logged: number }>();
  for (const row of projectFacts) {
    if (row.scopeStatus === 'PRE_HIRE') continue;
    const key = `${row.memberId}::${row.weekId}`;
    const current = sums.get(key) ?? { planned: 0, logged: 0 };
    current.planned += row.plannedHours;
    current.logged += row.loggedHours;
    sums.set(key, current);
  }
  return sums;
}

/**
 * Roll member × week × project facts up to member × week for findings and persistence.
 * Planned hours come from the project grain; logged/billable/training still read full
 * member timesheets so rows without project_id remain counted.
 */
export function rollupMemberWeekFactsFromProjectFacts(
  projectFacts: MemberWeekProjectFact[],
  inputs: BuildFactsInputs,
): MemberWeekFact[] {
  const {
    members,
    allocations,
    timesheets,
    leaves,
    weeks,
    thresholds,
    defaultStdHoursWeek = 40,
  } = inputs;

  const allocByMember = indexByMember(allocations);
  const tsByMember = indexByMember(timesheets);
  const plannedLoggedByMemberWeek = sumProjectHours(projectFacts);
  const sortedWeeks = sortWeeks(weeks);
  const facts: MemberWeekFact[] = [];

  for (const member of members) {
    const stdHoursWeek = member.std_hours_week ?? defaultStdHoursWeek;
    const memberAllocs = allocByMember.get(member.member_id) ?? [];
    const memberTs = tsByMember.get(member.member_id) ?? [];

    for (const week of sortedWeeks) {
      if (member.join_date && member.join_date.getTime() > week.week_end.getTime()) {
        facts.push(preHireFact(member.member_id, week.week_id));
        continue;
      }

      const key = `${member.member_id}::${week.week_id}`;
      const projectSums = plannedLoggedByMemberWeek.get(key) ?? { planned: 0, logged: 0 };
      const weekFraction = weekCoverageFraction(week, inputs.dateRange);
      const overtimeHours = computeOvertimeHours(member.member_id, stdHoursWeek, week, leaves);
      const baseMetrics = computeWeekMetrics({
        memberId: member.member_id,
        stdHoursWeek,
        week,
        allocations: memberAllocs,
        timesheets: memberTs,
        leaves,
        overtimeHours,
        requiredTrainingHours: thresholds.requiredTrainingHours,
      });

      const plannedHours =
        projectSums.planned > 0 ? projectSums.planned : baseMetrics.plannedHours * weekFraction;
      const loggedHours = baseMetrics.loggedHours;
      const availableHours = baseMetrics.availableHours * weekFraction;
      const billableHours = baseMetrics.billableHours;
      const trainingHours = baseMetrics.trainingHours;
      const benchHours = Math.max(0, availableHours - plannedHours);
      const busyRate = availableHours > 0 ? plannedHours / availableHours : null;
      const utilization = availableHours > 0 ? loggedHours / availableHours : null;
      const billableRate = loggedHours > 0 ? billableHours / loggedHours : null;
      const benchRate = availableHours > 0 ? benchHours / availableHours : null;
      const overtimeRatio = stdHoursWeek > 0 ? overtimeHours / stdHoursWeek : null;
      const effortConsumption = plannedHours > 0 ? loggedHours / plannedHours : null;
      const trainingCompliance =
        thresholds.requiredTrainingHours > 0
          ? trainingHours / thresholds.requiredTrainingHours
          : null;

      const metrics = {
        availableHours,
        plannedHours,
        loggedHours,
        expectedLoggedHours: plannedHours,
        billableHours,
        benchHours,
        overtimeHours,
        trainingHours,
        busyRate,
        utilization,
        billableRate,
        benchRate,
        overtimeRatio,
        effortConsumption,
        trainingCompliance,
      };
      const { ragColor, issueType } = classifyRag(metrics, thresholds);

      facts.push({
        memberId: member.member_id,
        weekId: week.week_id,
        scopeStatus: 'IN_SCOPE',
        availableHours: round4(metrics.availableHours) ?? 0,
        plannedHours: round4(metrics.plannedHours) ?? 0,
        loggedHours: round4(metrics.loggedHours) ?? 0,
        expectedLoggedHours: round4(metrics.expectedLoggedHours) ?? 0,
        billableHours: round4(metrics.billableHours) ?? 0,
        benchHours: round4(metrics.benchHours) ?? 0,
        overtimeHours: round4(metrics.overtimeHours) ?? 0,
        trainingHours: round4(metrics.trainingHours) ?? 0,
        busyRate: round4(metrics.busyRate),
        utilization: round4(metrics.utilization),
        billableRate: round4(metrics.billableRate),
        benchRate: round4(metrics.benchRate),
        overtimeRatio: round4(metrics.overtimeRatio),
        effortConsumption: round4(metrics.effortConsumption),
        trainingCompliance: round4(metrics.trainingCompliance),
        ragColor,
        issueType,
      });
    }
  }

  return facts;
}

/**
 * Build the member × week fact grid by rolling up member × week × project facts.
 *
 * Scope: a member-week before the member's join_date is marked PRE_HIRE and
 * carries no metrics — empty RA/logs there are "missing", not idle (F-15).
 */
export function buildMemberWeekFacts(inputs: BuildFactsInputs): MemberWeekFact[] {
  const projects =
    inputs.projects ?? inferProjectsFromAllocations(inputs.allocations, inputs.timesheets);
  const projectFacts = buildMemberWeekProjectFacts(
    projects,
    inputs.members,
    inputs.allocations,
    inputs.timesheets,
    inputs.weeks,
    inputs.leaves,
    inputs.defaultStdHoursWeek,
    inputs.dateRange,
  );
  return rollupMemberWeekFactsFromProjectFacts(projectFacts, inputs);
}
