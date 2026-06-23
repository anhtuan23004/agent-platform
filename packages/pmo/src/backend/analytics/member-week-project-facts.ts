import { computeAvailableHours } from './available-hours.ts';
import type { DateRange } from './dates.ts';
import { allocationActiveInWeek, dateInWeek, sortWeeks, weekCoverageFraction } from './dates.ts';
import { round4 } from './metrics.ts';
import { computeLoggedHoursForProject, computePlannedHours } from './planned-hours.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  ProjectRow,
  ScopeStatus,
  TimesheetRow,
  WeekRow,
} from './types.ts';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoDateOrNull(d: Date | null | undefined): string | null {
  if (!d) return null;
  return isoDate(d);
}

function allocationDatesForProjectWeek(allocations: AllocationRow[]): {
  startDate: string;
  endDate: string;
} {
  const primary = allocations[0];
  if (!primary) return { startDate: '', endDate: '' };
  let start = primary.start_date;
  let end = primary.end_date;
  for (const allocation of allocations.slice(1)) {
    if (allocation.start_date.getTime() < start.getTime()) start = allocation.start_date;
    if (allocation.end_date.getTime() > end.getTime()) end = allocation.end_date;
  }
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export interface MemberWeekProjectFact {
  memberId: string;
  weekId: string;
  projectId: string;
  projectName: string;
  scopeStatus: ScopeStatus;
  plannedHours: number;
  loggedHours: number;
  capacityShare: number | null;
  effortConsumption: number | null;
  allocationStartDate: string;
  allocationEndDate: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  projectStatus: string | null;
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

function projectIdsForMemberWeek(
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
  week: WeekRow,
): Set<string> {
  const projectIds = new Set<string>();
  for (const allocation of allocations) {
    if (allocationActiveInWeek(allocation.start_date, allocation.end_date, week)) {
      projectIds.add(allocation.project_id);
    }
  }
  for (const timesheet of timesheets) {
    if (!timesheet.project_id) continue;
    if (dateInWeek(timesheet.work_date, week)) projectIds.add(timesheet.project_id);
  }
  return projectIds;
}

/**
 * Trace grid: planned and logged hours per member, week, and project.
 * Member-week availability is not duplicated here — use memberWeekFacts for totals.
 */
export function buildMemberWeekProjectFacts(
  projects: ProjectRow[],
  members: MemberRow[],
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
  weeks: WeekRow[],
  leaves: LeaveRow[] = [],
  defaultStdHoursWeek = 40,
  dateRange?: DateRange,
): MemberWeekProjectFact[] {
  const projectById = new Map(projects.map((project) => [project.project_id, project]));
  const allocByMember = indexByMember(allocations);
  const tsByMember = indexByMember(timesheets);
  const rows: MemberWeekProjectFact[] = [];

  for (const member of members) {
    const stdHoursWeek = member.std_hours_week ?? defaultStdHoursWeek;
    const memberAllocs = allocByMember.get(member.member_id) ?? [];
    const memberTs = tsByMember.get(member.member_id) ?? [];

    for (const week of sortWeeks(weeks)) {
      const weekFraction = weekCoverageFraction(week, dateRange);
      const joinDate = member.join_date;
      const isPreHire = joinDate !== null && joinDate !== undefined && joinDate > week.week_end;
      const scopeStatus: ScopeStatus = isPreHire ? 'PRE_HIRE' : 'IN_SCOPE';
      const availableHours = isPreHire
        ? 0
        : computeAvailableHours(member.member_id, stdHoursWeek, week, leaves);

      for (const projectId of projectIdsForMemberWeek(memberAllocs, memberTs, week)) {
        const project = projectById.get(projectId);
        if (!project) continue;

        const activeAllocations = memberAllocs.filter(
          (allocation) =>
            allocation.project_id === projectId &&
            allocationActiveInWeek(allocation.start_date, allocation.end_date, week),
        );
        const plannedHours = isPreHire
          ? 0
          : computePlannedHours({
              allocations: activeAllocations,
              week,
              availableHours,
              stdHoursWeek,
            }) * weekFraction;
        const loggedHours = isPreHire ? 0 : computeLoggedHoursForProject(memberTs, projectId, week);

        if (!isPreHire && plannedHours === 0 && loggedHours === 0) continue;

        const { startDate, endDate } = allocationDatesForProjectWeek(activeAllocations);
        rows.push({
          memberId: member.member_id,
          weekId: week.week_id,
          projectId: project.project_id,
          projectName: project.project_name,
          scopeStatus,
          plannedHours: round4(plannedHours) ?? 0,
          loggedHours: round4(loggedHours) ?? 0,
          capacityShare:
            !isPreHire && stdHoursWeek > 0 ? round4(plannedHours / stdHoursWeek) : null,
          effortConsumption:
            !isPreHire && plannedHours > 0 ? round4(loggedHours / plannedHours) : null,
          allocationStartDate: startDate,
          allocationEndDate: endDate,
          projectStartDate: isoDateOrNull(project.start_date),
          projectEndDate: isoDateOrNull(project.end_date),
          projectStatus: project.status ?? null,
        });
      }
    }
  }

  return rows.sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) ||
      left.weekId.localeCompare(right.weekId) ||
      left.projectId.localeCompare(right.projectId),
  );
}
