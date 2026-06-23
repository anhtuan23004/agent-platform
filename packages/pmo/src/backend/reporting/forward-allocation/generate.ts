import { scoreRoleCompatibility } from '../recommendations/role-compatibility.ts';
import { normalizeSkill, scoreSkillCoverage } from '../recommendations/skill-coverage.ts';
import type {
  ForwardAllocationEvidence,
  ForwardAllocationRecommendationRow,
  ForwardAllocationScoreBreakdown,
  MemberAvailabilityWindow,
  ProjectDemandGapWindow,
} from './contracts.ts';
import { buildMemberAvailabilityWindows } from './supply.ts';

const DEFAULT_TOP_N = 3;
const DEFAULT_MIN_ROLE_COMPATIBILITY = 0.7;
const DEFAULT_MIN_SKILL_COVERAGE = 0.5;
const DEFAULT_UTILIZATION_HARD_CEILING = 1;
const DEFAULT_OVERTIME_HARD_CEILING = 0.15;
const SCORE_WEIGHTS = {
  availabilityOverlap: 0.3,
  roleSkillMatch: 0.3,
  demandUrgency: 0.2,
  historicalFit: 0.1,
  workloadBalance: 0.1,
} as const;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
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

function overlapDays(window: { from: Date; to: Date }): number {
  return Math.max(1, Math.floor((window.to.getTime() - window.from.getTime()) / 86_400_000) + 1);
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function confidenceForScore(score: number): ForwardAllocationRecommendationRow['confidence'] {
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

function memberStdHoursWeek(evidence: ForwardAllocationEvidence, memberId: string): number {
  return evidence.members.find((member) => member.memberId === memberId)?.stdHoursWeek ?? 40;
}

function roleSkillMatch(input: {
  evidence: ForwardAllocationEvidence;
  availability: MemberAvailabilityWindow;
  gap: ProjectDemandGapWindow;
}) {
  const member = input.evidence.members.find(
    (candidate) => candidate.memberId === input.availability.memberId,
  );
  const roleCompatibility = scoreRoleCompatibility({
    roleNeeded: input.gap.roleNeeded,
    candidate: member
      ? {
          memberId: member.memberId,
          department: member.department,
          roleTitle: member.roleTitle,
          level: member.level,
          lineManagerId: member.lineManagerId,
          employmentStatus: member.employmentStatus,
          employmentType: member.employmentType,
          stdHoursWeek: member.stdHoursWeek,
          joinDate: member.joinDate,
        }
      : undefined,
  });
  const skillCoverage = scoreSkillCoverage({
    requiredSkills: input.gap.requiredSkills.map((skillKey) => ({ skillKey, level: null })),
    candidateSkills: input.evidence.skills.filter(
      (skill) => skill.memberId === input.availability.memberId,
    ),
    adjacentSkills: {},
  });
  return {
    roleCompatibility,
    skillCoverage,
    score: round4(clamp01(roleCompatibility * 0.5 + skillCoverage.score * 0.5)),
  };
}

function urgencyScore(gap: ProjectDemandGapWindow): number {
  const urgency = normalize(gap.urgency);
  const base =
    urgency === 'critical' ? 1 : urgency === 'high' ? 0.85 : urgency === 'low' ? 0.35 : 0.6;
  const priority =
    gap.priorityScore === null
      ? null
      : gap.priorityScore <= 1
        ? clamp01(gap.priorityScore)
        : clamp01(gap.priorityScore / 100);
  return round4(priority === null ? base : (base + priority) / 2);
}

function workloadBalanceScore(input: {
  currentRaBusyRate: number;
  suggestedAllocationPct: number;
}): number {
  const projected = input.currentRaBusyRate + input.suggestedAllocationPct;
  const target = 0.85;
  return round4(clamp01(1 - Math.abs(projected - target) / target));
}

function availabilityOverlapScore(input: {
  availability: MemberAvailabilityWindow;
  gap: ProjectDemandGapWindow;
  overlap: { from: Date; to: Date };
}): number {
  const demandDays = overlapDays({ from: input.gap.demandStart, to: input.gap.demandEnd });
  const overlapRatio = overlapDays(input.overlap) / demandDays;
  const capacityCoverage =
    input.gap.unresolvedDemandPct > 0
      ? Math.min(input.availability.availableCapacityPct / input.gap.unresolvedDemandPct, 1)
      : 0;
  return round4(clamp01(overlapRatio * capacityCoverage));
}

function rankHistoricalTasks(input: {
  evidence: ForwardAllocationEvidence;
  memberId: string;
  gap: ProjectDemandGapWindow;
}) {
  const requiredSkills = new Set(input.gap.requiredSkills.map(normalizeSkill));
  const scored = input.evidence.taskHistory
    .filter((task) => task.memberId === input.memberId)
    .map((task) => {
      const projectScore = task.projectId === input.gap.projectId ? 1 : 0;
      const roleScore =
        normalize(task.allocationRole) === normalize(input.gap.roleNeeded) ? 0.7 : 0;
      const skillOverlapCount = task.skillTags
        .map(normalizeSkill)
        .filter((skill) => requiredSkills.has(skill)).length;
      const skillScore = requiredSkills.size === 0 ? 0 : skillOverlapCount / requiredSkills.size;
      const recencyScore = clamp01(
        1 - (Date.now() - task.completedAt.getTime()) / (365 * 86_400_000),
      );
      const score = Math.max(projectScore, roleScore, skillScore * 0.5) * 0.9 + recencyScore * 0.1;
      return { task, score: round4(clamp01(score)) };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.task.completedAt.getTime() - left.task.completedAt.getTime() ||
        left.task.historyId.localeCompare(right.task.historyId),
    );
  const top = scored.slice(0, 3);
  return {
    score: round4(top[0]?.score ?? 0),
    similarPastTasks: top.map((item) => item.task.historyId),
  };
}

function riskAdjustedCeiling(availability: MemberAvailabilityWindow): number {
  if (availability.leaveConflicts.length > 0) return 0.75;
  if (availability.riskFlags.length > 0) return 0.85;
  return 1;
}

function overlappingLeaveDays(input: {
  availability: MemberAvailabilityWindow;
  overlap: { from: Date; to: Date };
}): number {
  return input.availability.leaveConflicts.filter((leave) =>
    overlaps(
      { from: leave.from, to: leave.to },
      { from: input.overlap.from, to: input.overlap.to },
    ),
  ).length;
}

function hardConstraintFlags(input: {
  evidence: ForwardAllocationEvidence;
  availability: MemberAvailabilityWindow;
  gap: ProjectDemandGapWindow;
  roleCompatibility: number;
  skillCoverage: number;
  overlap: { from: Date; to: Date } | null;
}): string[] {
  const flags: string[] = [];
  const member = input.evidence.members.find(
    (candidate) => candidate.memberId === input.availability.memberId,
  );
  if (!member || normalize(member.employmentStatus) === 'inactive') flags.push('inactive_member');
  if (!input.overlap) flags.push('no_planning_overlap');
  if (input.availability.availableCapacityPct <= 0) flags.push('no_spare_capacity');
  if (input.gap.unresolvedDemandPct <= 0) flags.push('demand_gap_resolved');
  if (
    input.availability.actualUtilization !== null &&
    input.availability.actualUtilization > DEFAULT_UTILIZATION_HARD_CEILING
  ) {
    flags.push('actual_utilization_too_high');
  }
  if (
    input.availability.overtimeRatio !== null &&
    input.availability.overtimeRatio > DEFAULT_OVERTIME_HARD_CEILING
  ) {
    flags.push('ot_risk_too_high');
  }
  if (input.roleCompatibility < DEFAULT_MIN_ROLE_COMPATIBILITY) flags.push('role_mismatch');
  if (input.skillCoverage < DEFAULT_MIN_SKILL_COVERAGE)
    flags.push('skill_coverage_below_threshold');
  if (input.overlap) {
    const leaveDays = overlappingLeaveDays({
      availability: input.availability,
      overlap: input.overlap,
    });
    if (leaveDays / overlapDays(input.overlap) > 0.5) flags.push('leave_conflict');
  }
  return flags;
}

function recommendationType(input: {
  availability: MemberAvailabilityWindow;
  gap: ProjectDemandGapWindow;
}): ForwardAllocationRecommendationRow['type'] {
  if (input.availability.currentProjectId === input.gap.projectId) return 'extend';
  if (input.availability.currentProjectId) return 'reassign';
  return 'fill_gap';
}

function weightedScore(breakdown: ForwardAllocationScoreBreakdown): number {
  return round4(
    breakdown.availabilityOverlap * SCORE_WEIGHTS.availabilityOverlap +
      breakdown.roleSkillMatch * SCORE_WEIGHTS.roleSkillMatch +
      breakdown.demandUrgency * SCORE_WEIGHTS.demandUrgency +
      breakdown.historicalFit * SCORE_WEIGHTS.historicalFit +
      breakdown.workloadBalance * SCORE_WEIGHTS.workloadBalance,
  );
}

function rationale(input: {
  availability: MemberAvailabilityWindow;
  gap: ProjectDemandGapWindow;
  matchedSkills: string[];
  missingSkills: string[];
  similarPastTasks: string[];
  score: number;
}): string {
  const type = recommendationType({ availability: input.availability, gap: input.gap });
  const matched = input.matchedSkills.length;
  const totalSkills = matched + input.missingSkills.length;
  const historyText =
    input.similarPastTasks.length > 0
      ? `history ${input.similarPastTasks.join(', ')}`
      : 'no close project history';
  return [
    `${type} toward ${input.gap.projectId} because ${Math.round(input.gap.unresolvedDemandPct * 100)}% demand remains in the planning overlap`,
    `${Math.round(input.availability.availableCapacityPct * 100)}% member capacity is available`,
    `${matched}/${totalSkills || matched} required skills matched`,
    historyText,
    `deterministic score ${input.score}`,
  ].join('. ');
}

function stableRank(
  rows: ForwardAllocationRecommendationRow[],
): ForwardAllocationRecommendationRow[] {
  return [...rows].sort(
    (left, right) =>
      right.score - left.score ||
      Number(right.recommendationMode === 'demand_backed') -
        Number(left.recommendationMode === 'demand_backed') ||
      right.scoreBreakdown.roleSkillMatch - left.scoreBreakdown.roleSkillMatch ||
      right.scoreBreakdown.historicalFit - left.scoreBreakdown.historicalFit ||
      (left.targetProjectId ?? '').localeCompare(right.targetProjectId ?? '') ||
      left.recommendationId.localeCompare(right.recommendationId),
  );
}

function releaseWarningRow(input: {
  evidence: ForwardAllocationEvidence;
  availability: MemberAvailabilityWindow;
  reasons: string[];
}): ForwardAllocationRecommendationRow {
  const stdHoursWeek = memberStdHoursWeek(input.evidence, input.availability.memberId);
  return {
    recommendationId: `${input.availability.memberId}:release_warning:${isoDay(input.availability.availableFrom)}`,
    type: 'release_warning',
    confidence: 'low',
    recommendationMode: 'inferred',
    memberId: input.availability.memberId,
    currentProjectId: input.availability.currentProjectId,
    assignmentEndDate: isoDay(input.availability.assignmentEndDate),
    availableFrom: isoDay(input.availability.availableFrom),
    targetProjectId: null,
    suggestedAllocationPct: null,
    suggestedAllocationHoursPerWeek: null,
    effectiveFrom: isoDay(input.availability.availableFrom),
    effectiveTo: isoDay(input.availability.availableTo),
    score: 0,
    scoreBreakdown: {
      availabilityOverlap: 0,
      roleSkillMatch: 0,
      demandUrgency: 0,
      historicalFit: 0,
      workloadBalance: 0,
    },
    expectedBusyRateAfterAllocation: input.availability.currentRaBusyRate,
    hardConstraintFlags: input.reasons,
    dataQualityFlags: [...input.availability.evidenceFlags],
    rationale:
      input.reasons.length > 0
        ? `No strong fit cleared hard constraints for ${Math.round(input.availability.availableCapacityPct * 100)}% future capacity.`
        : `No strong fit was found for ${Math.round(input.availability.availableCapacityPct * 100)}% future capacity.`,
    risks: [
      ...new Set([
        ...input.availability.riskFlags,
        `spare_capacity_${stdHoursWeek}h_week_reference`,
      ]),
    ],
    evidence: {
      demandId: null,
      demandStart: null,
      demandEnd: null,
      currentRaBusyRate: input.availability.currentRaBusyRate,
      demandHoursPerWeek: null,
      matchedSkills: [],
      missingSkills: [],
      similarPastTasks: [],
    },
  };
}

function buildCandidateRows(input: {
  evidence: ForwardAllocationEvidence;
  availability: MemberAvailabilityWindow;
  topN: number;
}): ForwardAllocationRecommendationRow[] {
  const stdHoursWeek = memberStdHoursWeek(input.evidence, input.availability.memberId);
  const rows: ForwardAllocationRecommendationRow[] = [];
  const rejectedReasons = new Set<string>();

  for (const gap of input.evidence.demandGaps) {
    const availabilityTo = input.availability.availableTo ?? input.evidence.window.planningEnd;
    const overlap = overlaps(
      { from: input.availability.availableFrom, to: availabilityTo },
      { from: gap.demandStart, to: gap.demandEnd },
    );
    const {
      roleCompatibility,
      skillCoverage,
      score: roleSkillScore,
    } = roleSkillMatch({
      evidence: input.evidence,
      availability: input.availability,
      gap,
    });
    const constraintFlags = hardConstraintFlags({
      evidence: input.evidence,
      availability: input.availability,
      gap,
      roleCompatibility,
      skillCoverage: skillCoverage.score,
      overlap,
    });
    if (constraintFlags.length > 0) {
      for (const flag of constraintFlags) rejectedReasons.add(flag);
      continue;
    }
    if (!overlap) continue;

    const suggestedAllocationPct = round4(
      Math.min(
        input.availability.availableCapacityPct,
        gap.unresolvedDemandPct,
        riskAdjustedCeiling(input.availability),
      ),
    );
    if (suggestedAllocationPct <= 0) {
      rejectedReasons.add('demand_gap_resolved');
      continue;
    }
    const suggestedAllocationHoursPerWeek = round4(suggestedAllocationPct * stdHoursWeek);
    const history = rankHistoricalTasks({
      evidence: input.evidence,
      memberId: input.availability.memberId,
      gap,
    });
    const breakdown: ForwardAllocationScoreBreakdown = {
      availabilityOverlap: availabilityOverlapScore({
        availability: input.availability,
        gap,
        overlap,
      }),
      roleSkillMatch: roleSkillScore,
      demandUrgency: urgencyScore(gap),
      historicalFit: history.score,
      workloadBalance: workloadBalanceScore({
        currentRaBusyRate: input.availability.currentRaBusyRate,
        suggestedAllocationPct,
      }),
    };
    const score = weightedScore(breakdown);
    rows.push({
      recommendationId: `${input.availability.memberId}:${gap.demandId}:${recommendationType({
        availability: input.availability,
        gap,
      })}`,
      type: recommendationType({ availability: input.availability, gap }),
      confidence: confidenceForScore(score),
      recommendationMode: gap.recommendationMode,
      memberId: input.availability.memberId,
      currentProjectId: input.availability.currentProjectId,
      assignmentEndDate: isoDay(input.availability.assignmentEndDate),
      availableFrom: isoDay(input.availability.availableFrom),
      targetProjectId: gap.projectId,
      suggestedAllocationPct,
      suggestedAllocationHoursPerWeek,
      effectiveFrom: isoDay(overlap.from),
      effectiveTo: isoDay(minDate(overlap.to, availabilityTo)),
      score,
      scoreBreakdown: breakdown,
      expectedBusyRateAfterAllocation: round4(
        input.availability.currentRaBusyRate + suggestedAllocationPct,
      ),
      hardConstraintFlags: [],
      dataQualityFlags: [...new Set([...input.availability.evidenceFlags, ...gap.evidenceFlags])],
      rationale: rationale({
        availability: input.availability,
        gap,
        matchedSkills: skillCoverage.matchedSkills,
        missingSkills: skillCoverage.missingSkills,
        similarPastTasks: history.similarPastTasks,
        score,
      }),
      risks: [...new Set([...input.availability.riskFlags])],
      evidence: {
        demandId: gap.demandId,
        demandStart: isoDay(gap.demandStart),
        demandEnd: isoDay(gap.demandEnd),
        currentRaBusyRate: input.availability.currentRaBusyRate,
        demandHoursPerWeek: gap.unresolvedDemandHoursPerWeek,
        matchedSkills: skillCoverage.matchedSkills,
        missingSkills: skillCoverage.missingSkills,
        similarPastTasks: history.similarPastTasks,
      },
    });
  }

  const ranked = stableRank(rows).slice(0, input.topN);
  if (ranked.length > 0) return ranked;
  return [
    releaseWarningRow({
      evidence: input.evidence,
      availability: input.availability,
      reasons: [...rejectedReasons].sort(),
    }),
  ];
}

export function generateForwardAllocationRecommendations(input: {
  evidence: ForwardAllocationEvidence;
  topN?: number;
}): ForwardAllocationRecommendationRow[] {
  const topN = input.topN ?? DEFAULT_TOP_N;
  const availabilityWindows = buildMemberAvailabilityWindows(input.evidence);
  return availabilityWindows.flatMap((availability) =>
    buildCandidateRows({
      evidence: input.evidence,
      availability,
      topN,
    }),
  );
}
