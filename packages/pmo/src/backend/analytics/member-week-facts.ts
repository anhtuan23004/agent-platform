import { classifyRag } from './classify.ts';
import { sortWeeks } from './dates.ts';
import { computeWeekMetrics, round4 } from './metrics.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  MemberWeekFact,
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
  /** Default standard week when a member has no std_hours_week (FT assumption). */
  defaultStdHoursWeek?: number;
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

/**
 * Build the member × week fact grid.
 *
 * Scope: a member-week before the member's join_date is marked PRE_HIRE and
 * carries no metrics — empty RA/logs there are "missing", not idle (F-15).
 */
export function buildMemberWeekFacts(inputs: BuildFactsInputs): MemberWeekFact[] {
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
  const sortedWeeks = sortWeeks(weeks);
  const facts: MemberWeekFact[] = [];

  for (const member of members) {
    const stdHoursWeek = member.std_hours_week ?? defaultStdHoursWeek;
    const memberAllocs = allocByMember.get(member.member_id) ?? [];
    const memberTs = tsByMember.get(member.member_id) ?? [];

    for (const week of sortedWeeks) {
      // ── Scope: pre-hire weeks carry no metrics ─────────────────────────────
      if (member.join_date && member.join_date.getTime() > week.week_end.getTime()) {
        facts.push({
          memberId: member.member_id,
          weekId: week.week_id,
          scopeStatus: 'PRE_HIRE',
          availableHours: 0,
          plannedHours: 0,
          loggedHours: 0,
          expectedLoggedHours: 0,
          busyRate: null,
          effortConsumption: null,
          utilization: null,
          ragColor: 'none',
          issueType: 'ok',
        });
        continue;
      }

      const metrics = computeWeekMetrics({
        memberId: member.member_id,
        stdHoursWeek,
        week,
        allocations: memberAllocs,
        timesheets: memberTs,
        leaves,
      });

      const { ragColor, issueType } = classifyRag(metrics, thresholds);

      facts.push({
        memberId: member.member_id,
        weekId: week.week_id,
        scopeStatus: 'IN_SCOPE',
        availableHours: round4(metrics.availableHours) ?? 0,
        plannedHours: round4(metrics.plannedHours) ?? 0,
        loggedHours: round4(metrics.loggedHours) ?? 0,
        expectedLoggedHours: round4(metrics.expectedLoggedHours) ?? 0,
        busyRate: round4(metrics.busyRate),
        effortConsumption: round4(metrics.effortConsumption),
        utilization: round4(metrics.utilization),
        ragColor,
        issueType,
      });
    }
  }

  return facts;
}
