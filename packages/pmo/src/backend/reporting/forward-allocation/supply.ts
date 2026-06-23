import type { LeaveRow } from '../../analytics/types.ts';
import { buildMemberAllocationPeriods } from '../recommendations/ra-segmentation.ts';
import type {
  ForwardAllocationEvidence,
  ForwardAllocationRiskSummary,
  MemberAvailabilityWindow,
} from './contracts.ts';
import { nextWorkingDay } from './window.ts';

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function overlaps(
  left: { from: Date; to: Date },
  right: { from: Date; to: Date },
): { from: Date; to: Date } | null {
  const from = maxDate(left.from, right.from);
  const to = minDate(left.to, right.to);
  return from.getTime() <= to.getTime() ? { from, to } : null;
}

function riskFlags(risk: ForwardAllocationRiskSummary | undefined): string[] {
  if (!risk) return [];
  const flags: string[] = [];
  if (risk.utilization !== null && risk.utilization > 1) flags.push('actual_utilization_above_100');
  if (risk.effortConsumption !== null && Math.abs(risk.effortConsumption - 1) > 0.2) {
    flags.push(risk.effortConsumption > 1 ? 'effort_consumption_over' : 'effort_consumption_under');
  }
  if (risk.overtimeRatio !== null && risk.overtimeRatio > 0) flags.push('overtime_present');
  if (risk.benchHours > 0) flags.push('bench_present');
  return flags;
}

function leaveConflictsForWindow(
  leaves: LeaveRow[],
  memberId: string,
  window: { from: Date; to: Date | null },
): Array<{ from: Date; to: Date; reason: string }> {
  if (!window.to) return [];
  const windowTo = window.to;
  return leaves
    .filter((leave) => leave.member_id === memberId)
    .map((leave) => ({
      from: leave.leave_date,
      to: leave.leave_date,
      reason: leave.leave_type,
    }))
    .filter((leave) =>
      overlaps({ from: leave.from, to: leave.to }, { from: window.from, to: windowTo }),
    )
    .sort((left, right) => left.from.getTime() - right.from.getTime());
}

function currentProjectId(period: {
  projects: Array<{ projectId: string; allocationPct: number }>;
}): string | null {
  const sorted = [...period.projects].sort(
    (left, right) =>
      right.allocationPct - left.allocationPct || left.projectId.localeCompare(right.projectId),
  );
  return sorted[0]?.projectId ?? null;
}

function memberStdHoursWeek(evidence: ForwardAllocationEvidence, memberId: string): number {
  return evidence.members.find((member) => member.memberId === memberId)?.stdHoursWeek ?? 40;
}

function windowEnd(evidence: ForwardAllocationEvidence): Date {
  return evidence.window.planningEnd;
}

function periodAfterPlanningStart(period: { to: Date }, planningStart: Date): boolean {
  return period.to.getTime() >= planningStart.getTime();
}

export function buildMemberAvailabilityWindows(
  evidence: ForwardAllocationEvidence,
): MemberAvailabilityWindow[] {
  const periods = buildMemberAllocationPeriods(evidence.allocations);
  const periodsByMember = new Map<string, typeof periods>();
  for (const period of periods) {
    const memberPeriods = periodsByMember.get(period.memberId) ?? [];
    memberPeriods.push(period);
    periodsByMember.set(period.memberId, memberPeriods);
  }

  const availability: MemberAvailabilityWindow[] = [];
  const planningWindow = { from: evidence.window.planningStart, to: windowEnd(evidence) };

  for (const member of evidence.members) {
    const memberPeriods = (periodsByMember.get(member.memberId) ?? [])
      .filter((period) => periodAfterPlanningStart(period, evidence.window.planningStart))
      .sort((left, right) => left.from.getTime() - right.from.getTime());
    const risk = evidence.riskByMember.get(member.memberId);
    const stdHoursWeek = memberStdHoursWeek(evidence, member.memberId);

    if (memberPeriods.length === 0) {
      availability.push({
        memberId: member.memberId,
        currentProjectId: null,
        assignmentEndDate: null,
        availableFrom: evidence.window.planningStart,
        availableTo: evidence.window.planningEnd,
        currentRaBusyRate: 0,
        availableCapacityPct: 1,
        availableCapacityHoursPerWeek: stdHoursWeek,
        actualUtilization: risk?.utilization ?? null,
        overtimeRatio: risk?.overtimeRatio ?? null,
        leaveConflicts: leaveConflictsForWindow(evidence.leaves, member.memberId, planningWindow),
        riskFlags: riskFlags(risk),
        evidenceFlags: ['no_future_ra'],
        availabilityKind: 'assignment_end',
      });
      continue;
    }

    for (const period of memberPeriods) {
      if (period.totalAllocationPct < 1) {
        availability.push({
          memberId: member.memberId,
          currentProjectId: currentProjectId(period),
          assignmentEndDate: period.to,
          availableFrom: maxDate(period.from, evidence.window.planningStart),
          availableTo: period.to,
          currentRaBusyRate: round4(period.totalAllocationPct),
          availableCapacityPct: round4(Math.max(0, 1 - period.totalAllocationPct)),
          availableCapacityHoursPerWeek: round4(
            Math.max(0, 1 - period.totalAllocationPct) * stdHoursWeek,
          ),
          actualUtilization: risk?.utilization ?? null,
          overtimeRatio: risk?.overtimeRatio ?? null,
          leaveConflicts: leaveConflictsForWindow(evidence.leaves, member.memberId, {
            from: maxDate(period.from, evidence.window.planningStart),
            to: period.to,
          }),
          riskFlags: riskFlags(risk),
          evidenceFlags: [],
          availabilityKind: 'partial_capacity',
        });
      }
    }

    const lastPeriod = memberPeriods.at(-1);
    if (!lastPeriod) continue;
    if (lastPeriod.to.getTime() < evidence.window.planningEnd.getTime()) {
      const availableFrom = nextWorkingDay(new Date(lastPeriod.to.getTime() + 24 * 60 * 60 * 1000));
      availability.push({
        memberId: member.memberId,
        currentProjectId: currentProjectId(lastPeriod),
        assignmentEndDate: lastPeriod.to,
        availableFrom,
        availableTo: evidence.window.planningEnd,
        currentRaBusyRate: round4(lastPeriod.totalAllocationPct),
        availableCapacityPct: 1,
        availableCapacityHoursPerWeek: stdHoursWeek,
        actualUtilization: risk?.utilization ?? null,
        overtimeRatio: risk?.overtimeRatio ?? null,
        leaveConflicts: leaveConflictsForWindow(evidence.leaves, member.memberId, {
          from: availableFrom,
          to: evidence.window.planningEnd,
        }),
        riskFlags: riskFlags(risk),
        evidenceFlags: [],
        availabilityKind: 'assignment_end',
      });
    }
  }

  return availability.sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) ||
      left.availableFrom.getTime() - right.availableFrom.getTime() ||
      (left.currentProjectId ?? '').localeCompare(right.currentProjectId ?? ''),
  );
}
