import type { Thresholds } from '../../analytics/types.ts';
import type {
  CandidateRejectionReason,
  CandidateSlot,
  RebalanceOpportunity,
  RecommendationMember,
  RecommendationRiskSummary,
} from './contracts.ts';

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
  left: { from: Date; to: Date | null },
  right: { from: Date; to: Date },
): { from: Date; to: Date } | null {
  const effectiveRightTo = right.to;
  const effectiveLeftTo = left.to ?? right.to;
  const from = maxDate(left.from, right.from);
  const to = minDate(effectiveLeftTo, effectiveRightTo);
  return from.getTime() <= to.getTime() ? { from, to } : null;
}

function hasFlag(risk: RecommendationRiskSummary | undefined, thresholds: Thresholds): string[] {
  if (!risk) return [];
  const flags: string[] = [];
  if (risk.utilization !== null && risk.utilization > 1) flags.push('actual_utilization_above_100');
  if (risk.overtimeRatio !== null && risk.overtimeRatio > thresholds.otMaxHoursPerWeek / 40) {
    flags.push('ot_risk_high');
  } else if (risk.overtimeRatio !== null && risk.overtimeRatio > 0) {
    flags.push('overtime_present');
  }
  if (
    risk.effortConsumption !== null &&
    Math.abs(risk.effortConsumption - 1) > thresholds.mismatchPctThreshold
  ) {
    flags.push('effort_mismatch_present');
  }
  return flags;
}

export function buildCandidateSlots(input: {
  opportunities: RebalanceOpportunity[];
  periods: Array<{
    memberId: string;
    from: Date;
    to: Date;
    totalAllocationPct: number;
    projects: Array<{ projectId: string; role: string | null; allocationPct: number }>;
  }>;
  members: RecommendationMember[];
  riskByMember?: Map<string, RecommendationRiskSummary>;
  thresholds: Thresholds;
  candidateSoftCeiling?: number;
  actualUtilizationPartialCutoff?: number;
  overtimePartialCutoff?: number;
}): CandidateSlot[] {
  const candidateSoftCeiling = input.candidateSoftCeiling ?? 1;
  const actualUtilizationPartialCutoff = input.actualUtilizationPartialCutoff ?? 1.05;
  const overtimePartialCutoff = input.overtimePartialCutoff ?? 0.15;
  const membersById = new Map(input.members.map((member) => [member.memberId, member]));
  const slots: CandidateSlot[] = [];

  for (const opportunity of input.opportunities) {
    for (const period of input.periods) {
      if (period.memberId === opportunity.sourceMemberId) continue;
      const member = membersById.get(period.memberId);
      const risk = input.riskByMember?.get(period.memberId);
      const overlap = overlaps(opportunity.planningPeriod, { from: period.from, to: period.to });
      const rejectionReasons: CandidateRejectionReason[] = [];

      if ((member?.employmentStatus ?? '').toLowerCase() !== 'active') {
        rejectionReasons.push('inactive_member');
      }
      if (!overlap) rejectionReasons.push('no_planning_overlap');

      const availableCapacityPct = round4(candidateSoftCeiling - period.totalAllocationPct);
      const stdHoursWeek = member?.stdHoursWeek ?? 40;
      const availableCapacityHoursPerWeek = round4(
        Math.max(0, availableCapacityPct * stdHoursWeek),
      );
      if (availableCapacityPct <= 0) rejectionReasons.push('no_spare_capacity');

      const leaveConflict = false;
      const trainingConflict = false;
      if (leaveConflict) rejectionReasons.push('leave_conflict');
      if (trainingConflict) rejectionReasons.push('training_conflict');

      if (risk && risk.utilization !== null && risk.utilization >= actualUtilizationPartialCutoff) {
        rejectionReasons.push('actual_utilization_too_high');
      }
      if (risk && risk.overtimeRatio !== null && risk.overtimeRatio >= overtimePartialCutoff) {
        rejectionReasons.push('ot_risk_too_high');
      }

      slots.push({
        opportunityId: opportunity.opportunityId,
        memberId: period.memberId,
        roleTitle: member?.roleTitle ?? null,
        allocationRoleSet: [
          ...new Set(period.projects.map((project) => project.role ?? '').filter(Boolean)),
        ],
        activePeriod: { from: period.from, to: period.to },
        planningOverlap: overlap,
        currentRaBusyRate: round4(period.totalAllocationPct),
        targetRaBusyRate: opportunity.candidateSoftCeiling,
        availableCapacityPct,
        availableCapacityHoursPerWeek,
        actualUtilization: risk?.utilization ?? null,
        effortConsumption: risk?.effortConsumption ?? null,
        overtimeRatio: risk?.overtimeRatio ?? null,
        leaveConflict,
        trainingConflict,
        candidateRiskFlags: hasFlag(risk, input.thresholds),
        rejectionReasons,
      });
    }
  }

  return slots.sort((left, right) => left.memberId.localeCompare(right.memberId));
}
