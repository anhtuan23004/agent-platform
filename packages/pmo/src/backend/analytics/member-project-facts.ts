import { computeAvailableHours } from './available-hours.ts';
import { allocationActiveInWeek, dateInWeek } from './dates.ts';
import { round4 } from './metrics.ts';
import { computePlannedHours } from './planned-hours.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  ProjectRow,
  TimesheetRow,
  WeekRow,
} from './types.ts';

export interface MemberProjectAllocationFact {
  projectId: string;
  projectName: string;
  pmId: string | null;
  pmName: string | null;
  memberId: string;
  memberName: string;
  memberRoleTitle: string | null;
  allocationRole: string | null;
  weeklyPlannedHours: number;
  plannedHoursInWindow: number;
  loggedHours: number;
  capacityShare: number | null;
  effortConsumption: number | null;
}

function sumLoggedHoursForMemberProject(
  timesheets: TimesheetRow[],
  memberId: string,
  projectId: string,
  weeks: WeekRow[],
): number {
  let hours = 0;
  for (const ts of timesheets) {
    if (ts.member_id !== memberId || ts.project_id !== projectId) continue;
    if (!weeks.some((week) => dateInWeek(ts.work_date, week))) continue;
    hours += ts.logged_hours ?? 0;
  }
  return hours;
}

function computePlannedHoursInWindow(
  allocation: AllocationRow,
  member: MemberRow,
  weeks: WeekRow[],
  leaves: LeaveRow[],
  defaultStdHoursWeek = 40,
): number {
  const stdHoursWeek = member.std_hours_week ?? defaultStdHoursWeek;
  let total = 0;
  for (const week of weeks) {
    if (member.join_date && member.join_date.getTime() > week.week_end.getTime()) continue;
    if (!allocationActiveInWeek(allocation.start_date, allocation.end_date, week)) continue;
    const availableHours = computeAvailableHours(member.member_id, stdHoursWeek, week, leaves);
    total += computePlannedHours({
      allocations: [allocation],
      week,
      availableHours,
      stdHoursWeek,
    });
  }
  return total;
}

/**
 * Build member × project allocation facts for rebalance planning.
 *
 * One row per active RA segment: planned hours from DS01, logged hours from DS02
 * (matched by member_id + project_id inside the reporting window).
 */
export function buildMemberProjectAllocationFacts(
  projects: ProjectRow[],
  members: MemberRow[],
  allocations: AllocationRow[],
  timesheets: TimesheetRow[],
  weeks: WeekRow[],
  leaves: LeaveRow[] = [],
): MemberProjectAllocationFact[] {
  const projectById = new Map(projects.map((project) => [project.project_id, project]));
  const memberById = new Map(members.map((member) => [member.member_id, member]));

  const rows: MemberProjectAllocationFact[] = [];
  for (const allocation of allocations) {
    const project = projectById.get(allocation.project_id);
    const member = memberById.get(allocation.member_id);
    if (!project || !member) continue;

    const stdHoursWeek = member.std_hours_week ?? 40;
    const weeklyPlannedHours = allocation.weekly_planned_hours ?? 0;
    const plannedHoursInWindow = computePlannedHoursInWindow(allocation, member, weeks, leaves);
    const loggedHours = sumLoggedHoursForMemberProject(
      timesheets,
      member.member_id,
      project.project_id,
      weeks,
    );
    const pm = project.pm_id ? memberById.get(project.pm_id) : undefined;

    rows.push({
      projectId: project.project_id,
      projectName: project.project_name,
      pmId: project.pm_id,
      pmName: pm?.full_name ?? null,
      memberId: member.member_id,
      memberName: member.full_name,
      memberRoleTitle: member.role_title ?? null,
      allocationRole: allocation.role ?? null,
      weeklyPlannedHours,
      plannedHoursInWindow: round4(plannedHoursInWindow) ?? 0,
      loggedHours: round4(loggedHours) ?? 0,
      capacityShare: stdHoursWeek > 0 ? round4(weeklyPlannedHours / stdHoursWeek) : null,
      effortConsumption:
        plannedHoursInWindow > 0 ? round4(loggedHours / plannedHoursInWindow) : null,
    });
  }

  return rows.sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) ||
      left.projectId.localeCompare(right.projectId) ||
      (left.pmId ?? '').localeCompare(right.pmId ?? ''),
  );
}
