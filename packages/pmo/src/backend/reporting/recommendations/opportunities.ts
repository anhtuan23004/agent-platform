import type { AllocationRow, Thresholds } from '../../analytics/types.ts';
import type {
  MemberAllocationPeriod,
  RebalanceOpportunity,
  RecommendationRiskSummary,
  RecommendationWindow,
} from './contracts.ts';

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildOpportunityId(input: {
  memberId: string;
  projectId: string;
  role: string | null;
  from: Date;
  to: Date;
}): string {
  return [
    input.memberId,
    input.projectId,
    input.role ?? 'unassigned-role',
    isoDay(input.from),
    isoDay(input.to),
  ].join(':');
}

function classifySeverity(busyRate: number, thresholds: Thresholds): 'warning' | 'red' | null {
  if (busyRate >= thresholds.overbookRedThreshold) return 'red';
  if (busyRate > thresholds.overbookThreshold) return 'warning';
  return null;
}

function riskFlags(risk: RecommendationRiskSummary | undefined, thresholds: Thresholds): string[] {
  if (!risk) return [];
  const flags: string[] = [];
  if (risk.utilization !== null && risk.utilization > 1) flags.push('actual_utilization_above_100');
  if (
    risk.effortConsumption !== null &&
    Math.abs(risk.effortConsumption - 1) > thresholds.mismatchPctThreshold
  ) {
    flags.push(risk.effortConsumption > 1 ? 'effort_consumption_over' : 'effort_consumption_under');
  }
  if (risk.overtimeRatio !== null && risk.overtimeRatio > 0) flags.push('overtime_present');
  return flags;
}

export function buildRebalanceOpportunities(input: {
  periods: MemberAllocationPeriod[];
  allocations: AllocationRow[];
  window: RecommendationWindow;
  thresholds: Thresholds;
  sourceTargetBusyRate?: number;
  candidateSoftCeiling?: number;
  candidateHardCeiling?: number;
  allowPartialRelief?: boolean;
  riskByMember?: Map<string, RecommendationRiskSummary>;
}): RebalanceOpportunity[] {
  const sourceTargetBusyRate = input.sourceTargetBusyRate ?? 1;
  const candidateSoftCeiling = input.candidateSoftCeiling ?? 1;
  const candidateHardCeiling = input.candidateHardCeiling ?? 1.05;
  const allowPartialRelief = input.allowPartialRelief ?? true;
  const opportunities: RebalanceOpportunity[] = [];

  for (const period of input.periods) {
    const severity = classifySeverity(period.totalAllocationPct, input.thresholds);
    if (!severity) continue;

    const requiresRaConfirmation = period.to.getTime() < input.window.planningStart.getTime();
    const shared = {
      sourceMemberId: period.memberId,
      severity,
      activePeriod: { from: period.from, to: period.to },
      planningPeriod: {
        from: input.window.planningStart,
        to: requiresRaConfirmation ? null : period.to,
      },
      currentRaBusyRate: round4(period.totalAllocationPct),
      sourceTargetBusyRate,
      candidateSoftCeiling,
      candidateHardCeiling,
      allowPartialRelief,
      sourceRiskFlags: riskFlags(input.riskByMember?.get(period.memberId), input.thresholds),
      sourceValidation: {
        utilization: input.riskByMember?.get(period.memberId)?.utilization ?? null,
        effortConsumption: input.riskByMember?.get(period.memberId)?.effortConsumption ?? null,
        overtimeRatio: input.riskByMember?.get(period.memberId)?.overtimeRatio ?? null,
      },
      requiresRaConfirmation,
    } as const;

    for (const project of period.projects) {
      const totalOveragePct = Math.max(0, period.totalAllocationPct - sourceTargetBusyRate);
      if (totalOveragePct <= 0) continue;
      const projectShare =
        period.totalAllocationPct > 0 ? project.allocationPct / period.totalAllocationPct : 0;
      const reliefNeededPct = totalOveragePct * projectShare;
      if (reliefNeededPct <= 0) continue;
      const baseHours =
        project.weeklyPlannedHours ?? (project.allocationPct > 0 ? project.allocationPct * 40 : 0);
      const reliefNeededHoursPerWeek =
        project.allocationPct > 0 ? baseHours * (reliefNeededPct / project.allocationPct) : 0;
      opportunities.push({
        opportunityId: buildOpportunityId({
          memberId: period.memberId,
          projectId: project.projectId,
          role: project.role,
          from: period.from,
          to: period.to,
        }),
        ...shared,
        projectId: project.projectId,
        roleNeeded: project.role,
        reliefNeededPct: round4(reliefNeededPct),
        reliefNeededHoursPerWeek: round4(reliefNeededHoursPerWeek),
      });
    }
  }

  return opportunities.sort(
    (left, right) =>
      Number(right.severity === 'red') - Number(left.severity === 'red') ||
      right.reliefNeededHoursPerWeek - left.reliefNeededHoursPerWeek ||
      left.sourceMemberId.localeCompare(right.sourceMemberId) ||
      left.projectId.localeCompare(right.projectId) ||
      (left.roleNeeded ?? '').localeCompare(right.roleNeeded ?? ''),
  );
}
