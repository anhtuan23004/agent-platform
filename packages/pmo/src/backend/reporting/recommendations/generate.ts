import type { Finding, MemberWeekFact } from '../../analytics/types.ts';
import type {
  CandidateRejectionReason,
  CandidateSlot,
  GenerateRecommendationsInput,
  RebalanceOpportunity,
  RebalanceRecommendation,
  RebalanceRecommendationGroup,
  RecommendationMember,
  RecommendationRiskSummary,
  ScoreBreakdown,
} from './contracts.ts';
import { validateCandidateCount } from './contracts.ts';
import { buildRebalanceOpportunities } from './opportunities.ts';
import { scoreProjectContext } from './project-context.ts';
import { buildMemberAllocationPeriods } from './ra-segmentation.ts';
import { calculateCandidateScore, confidenceForScore, stableRank } from './rank.ts';
import { buildCandidateSlots } from './risk-gates.ts';
import { scoreRoleCompatibility } from './role-compatibility.ts';
import { scoreSkillCoverage } from './skill-coverage.ts';
import { scoreTaskHistory } from './task-similarity.ts';
import { buildWorkloadProfile } from './workload-profile.ts';

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildRiskByMember(facts: MemberWeekFact[]): Map<string, RecommendationRiskSummary> {
  const buckets = new Map<
    string,
    {
      availableHours: number;
      plannedHours: number;
      loggedHours: number;
      trainingHours: number;
      benchHours: number;
      overtimeHours: number;
    }
  >();

  for (const fact of facts) {
    const current = buckets.get(fact.memberId) ?? {
      availableHours: 0,
      plannedHours: 0,
      loggedHours: 0,
      trainingHours: 0,
      benchHours: 0,
      overtimeHours: 0,
    };
    current.availableHours += fact.availableHours;
    current.plannedHours += fact.plannedHours;
    current.loggedHours += fact.loggedHours;
    current.trainingHours += fact.trainingHours;
    current.benchHours += fact.benchHours;
    current.overtimeHours += fact.overtimeHours;
    buckets.set(fact.memberId, current);
  }

  return new Map(
    [...buckets.entries()].map(([memberId, bucket]) => {
      const availableHours = bucket.availableHours;
      const plannedHours = bucket.plannedHours;
      const loggedHours = bucket.loggedHours;
      return [
        memberId,
        {
          memberId,
          availableHours,
          plannedHours,
          loggedHours,
          utilization: availableHours > 0 ? round4(loggedHours / availableHours) : null,
          effortConsumption: plannedHours > 0 ? round4(loggedHours / plannedHours) : null,
          overtimeRatio: availableHours > 0 ? round4(bucket.overtimeHours / availableHours) : null,
          trainingHours: bucket.trainingHours,
          benchHours: bucket.benchHours,
        },
      ];
    }),
  );
}

function memberById(members: RecommendationMember[]): Map<string, RecommendationMember> {
  return new Map(members.map((member) => [member.memberId, member]));
}

function activeFindingMembers(findings: Finding[]): Set<string> {
  return new Set(
    findings
      .filter((finding) => finding.issueType === 'overbook' && finding.ragColor === 'red')
      .map((finding) => finding.memberId),
  );
}

function formatPeriod(from: Date, to: Date | null): string {
  return to ? `${isoDay(from)} to ${isoDay(to)}` : `${isoDay(from)} onward`;
}

function reasonForNoCandidates(
  rejections: Array<CandidateRejectionReason | 'candidate_data_unavailable'>,
  degraded: boolean,
): string[] {
  const reasons = [...new Set(rejections)];
  if (degraded) reasons.push('candidate_data_unavailable');
  return reasons.sort();
}

function roleContextScore(input: {
  opportunity: RebalanceOpportunity;
  source: RecommendationMember | undefined;
  target: RecommendationMember | undefined;
  targetTasksProjectScore: number;
  roleCompatibility: number;
}): number {
  const levelMatch = levelProximity(input.source?.level, input.target?.level);
  const departmentMatch =
    input.source?.department && input.target?.department
      ? input.source.department === input.target.department
        ? 1
        : 0
      : 0;
  const titleMatch =
    input.target?.roleTitle && input.opportunity.roleNeeded
      ? input.target.roleTitle.toLowerCase().includes(input.opportunity.roleNeeded.toLowerCase())
        ? 1
        : input.roleCompatibility
      : input.roleCompatibility;
  return round4(
    clamp01(
      0.5 * input.roleCompatibility + 0.2 * titleMatch + 0.15 * levelMatch + 0.15 * departmentMatch,
    ),
  );
}

function levelProximity(
  sourceLevel: string | null | undefined,
  targetLevel: string | null | undefined,
): number {
  const parse = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const match = value.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  };
  const source = parse(sourceLevel);
  const target = parse(targetLevel);
  if (source === null || target === null) return 0.5;
  const delta = Math.abs(source - target);
  if (delta === 0) return 1;
  if (delta === 1) return 0.8;
  if (delta === 2) return 0.5;
  return 0.2;
}

function capacityFit(input: { slot: CandidateSlot; opportunity: RebalanceOpportunity }): number {
  const reliefRatio =
    input.opportunity.reliefNeededPct > 0
      ? input.slot.availableCapacityPct / input.opportunity.reliefNeededPct
      : 0;
  let score = Math.min(reliefRatio, 1);
  const projectedRa = input.slot.currentRaBusyRate + input.opportunity.reliefNeededPct;
  if (projectedRa <= 0.95) return round4(clamp01(score));
  if (projectedRa <= input.opportunity.candidateSoftCeiling) score *= 0.9;
  else if (projectedRa <= input.opportunity.candidateHardCeiling) score *= 0.7;
  else score = 0;
  return round4(clamp01(score));
}

function riskAdjustment(slot: CandidateSlot, degraded: boolean): number {
  let value = 1;
  if (slot.actualUtilization !== null && slot.actualUtilization >= 0.95) value -= 0.15;
  if (slot.overtimeRatio !== null && slot.overtimeRatio >= 0.1) value -= 0.15;
  if (slot.effortConsumption !== null && Math.abs(slot.effortConsumption - 1) > 0.2) value -= 0.1;
  if (degraded) value -= 0.1;
  return round4(clamp01(value));
}

function buildRationale(input: {
  opportunity: RebalanceOpportunity;
  slot: CandidateSlot;
  target: RecommendationMember | undefined;
  skillMatch: { matchedSkills: string[]; missingSkills: string[] };
  history: { similarPastTasks: string[] };
}): string {
  const targetName = input.target?.memberId ?? input.slot.memberId;
  const matchedSkills = input.skillMatch.matchedSkills.length;
  const totalSkills = matchedSkills + input.skillMatch.missingSkills.length;
  const historyText =
    input.history.similarPastTasks.length > 0
      ? `prior similar history ${input.history.similarPastTasks.join(', ')}`
      : 'limited structured history';
  return [
    `Move ${Math.round(input.opportunity.reliefNeededPct * 100)}% allocation from ${input.opportunity.sourceMemberId} to ${targetName}`,
    `for ${input.opportunity.projectId}`,
    `during ${formatPeriod(input.opportunity.planningPeriod.from, input.opportunity.planningPeriod.to)}`,
    `${targetName} has ${Math.round(input.slot.availableCapacityPct * 100)}% spare RA capacity`,
    `${matchedSkills}/${totalSkills || matchedSkills} required skills matched`,
    historyText,
  ].join('. ');
}

function effectiveTo(opportunity: RebalanceOpportunity, slot: CandidateSlot): string | null {
  const dates = [opportunity.planningPeriod.to, slot.planningOverlap?.to].filter(
    (value): value is Date => Boolean(value),
  );
  if (dates.length === 0) return null;
  return isoDay(
    dates.reduce((min, current) => (current.getTime() < min.getTime() ? current : min)),
  );
}

function candidateForOpportunity(slots: CandidateSlot[], opportunityId: string): CandidateSlot[] {
  return slots.filter((slot) => slot.opportunityId === opportunityId);
}

function projectTransferHours(opportunity: RebalanceOpportunity, slot: CandidateSlot): number {
  return round4(Math.min(opportunity.reliefNeededHoursPerWeek, slot.availableCapacityHoursPerWeek));
}

export function generateRebalanceRecommendations(
  input: GenerateRecommendationsInput,
): RebalanceRecommendationGroup[] {
  if (!input.rules.recommendation.enabled) return [];
  const candidateCount = validateCandidateCount(input.candidateCount, input.rules);
  const overbookSources = activeFindingMembers(input.findings);
  if (overbookSources.size === 0) return [];

  const periods = buildMemberAllocationPeriods(
    input.evidence.allocations.filter((allocation) => overbookSources.has(allocation.member_id)),
  );
  const allPeriods = buildMemberAllocationPeriods(input.evidence.allocations);
  const riskByMember = buildRiskByMember(input.evidence.facts);
  const opportunities = buildRebalanceOpportunities({
    periods,
    allocations: input.evidence.allocations,
    window: input.evidence.window,
    thresholds: {
      ...input.rules.limits,
      overbookThreshold: input.rules.classification.overbook.yellow.gt ?? 1.1,
      overbookRedThreshold: input.rules.classification.overbook.red.gte ?? 1.2,
      idleThreshold: input.rules.classification.idle.red.lt ?? 0.75,
      idleYellowThreshold: input.rules.classification.idle.yellow.gte ?? 0.75,
      requiredTrainingHours: 0,
    },
    sourceTargetBusyRate: 1,
    candidateSoftCeiling: 1,
    candidateHardCeiling: 1.05,
    allowPartialRelief: true,
    riskByMember,
  }).filter((opportunity) => overbookSources.has(opportunity.sourceMemberId));

  const slots = buildCandidateSlots({
    opportunities,
    periods: allPeriods,
    members: input.evidence.members,
    riskByMember,
    thresholds: {
      ...input.rules.limits,
      overbookThreshold: input.rules.classification.overbook.yellow.gt ?? 1.1,
      overbookRedThreshold: input.rules.classification.overbook.red.gte ?? 1.2,
      idleThreshold: input.rules.classification.idle.red.lt ?? 0.75,
      idleYellowThreshold: input.rules.classification.idle.yellow.gte ?? 0.75,
      requiredTrainingHours: 0,
    },
    candidateSoftCeiling: 1,
  });

  const membersById = memberById(input.evidence.members);
  const groups: RebalanceRecommendationGroup[] = [];

  for (const opportunity of opportunities) {
    const source = membersById.get(opportunity.sourceMemberId);
    const sourceSkills = input.evidence.skills.filter(
      (skill) => skill.memberId === opportunity.sourceMemberId,
    );
    const projectTasks = input.evidence.taskHistory.filter(
      (task) =>
        task.memberId === opportunity.sourceMemberId && task.projectId === opportunity.projectId,
    );
    const profile = buildWorkloadProfile({
      role: opportunity.roleNeeded,
      sourceSkills,
      projectTasks,
    });

    const reasons = new Set<CandidateRejectionReason | 'candidate_data_unavailable'>();
    const eligible: RebalanceRecommendation[] = [];
    const slotsForOpportunity = candidateForOpportunity(slots, opportunity.opportunityId);

    for (const slot of slotsForOpportunity) {
      const target = membersById.get(slot.memberId);
      const roleCompatibility = scoreRoleCompatibility({
        roleNeeded: opportunity.roleNeeded,
        candidate: target,
      });
      if (roleCompatibility < 0.7) {
        reasons.add('role_mismatch');
        continue;
      }
      if (slot.rejectionReasons.length > 0) {
        for (const reason of slot.rejectionReasons) {
          reasons.add(reason);
        }
        continue;
      }

      const candidateSkills = input.evidence.skills.filter(
        (skill) => skill.memberId === slot.memberId,
      );
      if (candidateSkills.length === 0) {
        reasons.add('candidate_data_unavailable');
        continue;
      }
      const skill = scoreSkillCoverage({
        requiredSkills: profile.requiredSkills,
        candidateSkills,
        adjacentSkills: input.rules.recommendation.adjacentSkills,
      });
      if (skill.score < input.rules.recommendation.minimumSkillCoverage) {
        reasons.add('skill_coverage_below_threshold');
        continue;
      }

      const targetTasks = input.evidence.taskHistory.filter(
        (task) => task.memberId === slot.memberId,
      );
      const history = scoreTaskHistory({
        workloadEmbedding: profile.embedding,
        tasks: targetTasks,
        effectiveAt: input.effectiveAt,
        historyWindowDays: input.rules.recommendation.historyWindowDays,
        topK: input.rules.recommendation.taskHistoryTopK,
      });
      const projectContext = scoreProjectContext({
        projectId: opportunity.projectId,
        role: opportunity.roleNeeded,
        source,
        target,
        targetTasks,
      });
      const roleContextMatch = roleContextScore({
        opportunity,
        source,
        target,
        targetTasksProjectScore: projectContext,
        roleCompatibility,
      });
      const degraded = profile.dataQualityFlags.length > 0 || history.degraded;
      const scoreBreakdown: ScoreBreakdown = {
        skillMatch: round4(skill.score),
        historyMatch: round4(clamp01(0.5 * projectContext + 0.5 * history.score)),
        roleContextMatch,
        capacityFit: capacityFit({ slot, opportunity }),
        riskAdjustment: riskAdjustment(slot, degraded),
      };
      const score = round4(calculateCandidateScore(scoreBreakdown, input.rules));
      if (score < 0.5) continue;
      const transferHoursPerWeek = projectTransferHours(opportunity, slot);
      if (transferHoursPerWeek <= 0) {
        reasons.add('no_spare_capacity');
        continue;
      }
      const transferPct = round4(
        opportunity.reliefNeededHoursPerWeek > 0
          ? (transferHoursPerWeek / opportunity.reliefNeededHoursPerWeek) *
              opportunity.reliefNeededPct
          : 0,
      );
      const allFlags = [
        ...new Set([
          ...opportunity.sourceRiskFlags,
          ...slot.candidateRiskFlags,
          ...profile.dataQualityFlags,
          ...history.flags,
        ]),
      ].sort();
      eligible.push({
        type: 'rebalance',
        opportunityId: opportunity.opportunityId,
        sourceMemberId: opportunity.sourceMemberId,
        targetMemberId: slot.memberId,
        projectId: opportunity.projectId,
        roleNeeded: opportunity.roleNeeded,
        effectiveFrom: isoDay(opportunity.planningPeriod.from) ?? '',
        effectiveTo: effectiveTo(opportunity, slot),
        transferPct,
        transferHoursPerWeek,
        score,
        confidence: confidenceForScore(score, input.rules),
        rankWithinOpportunity: 0,
        portfolioSelected: false,
        mutuallyExclusiveAlternative: true,
        beforeAfter: {
          sourceBeforeBusyRate: opportunity.currentRaBusyRate,
          sourceAfterBusyRate: round4(
            Math.max(opportunity.sourceTargetBusyRate, opportunity.currentRaBusyRate - transferPct),
          ),
          targetBeforeBusyRate: slot.currentRaBusyRate,
          targetAfterBusyRate: round4(slot.currentRaBusyRate + transferPct),
        },
        scoreBreakdown,
        evidence: {
          matchedSkills: skill.matchedSkills,
          missingSkills: skill.missingSkills,
          similarPastTasks: history.similarPastTasks,
          sourceRiskFlags: opportunity.sourceRiskFlags,
          candidateRiskFlags: slot.candidateRiskFlags,
          rationale: buildRationale({
            opportunity,
            slot,
            target,
            skillMatch: skill,
            history,
          }),
        },
        recommendationDegraded: allFlags.length > 0,
        dataQualityFlags: allFlags,
      });
    }

    const ranked = stableRank(eligible).slice(0, candidateCount);
    const groupFlags = [
      ...new Set([
        ...ranked.flatMap((recommendation) => recommendation.dataQualityFlags),
        ...(profile.dataQualityFlags.length > 0 ? profile.dataQualityFlags : []),
      ]),
    ].sort();
    groups.push({
      opportunityId: opportunity.opportunityId,
      sourceMemberId: opportunity.sourceMemberId,
      projectId: opportunity.projectId,
      roleNeeded: opportunity.roleNeeded,
      severity: opportunity.severity,
      evidenceWindow: {
        from: isoDay(input.evidence.window.evidenceFrom) ?? '',
        to: isoDay(input.evidence.window.evidenceTo) ?? '',
      },
      planningPeriod: {
        from: isoDay(opportunity.planningPeriod.from) ?? '',
        to: isoDay(opportunity.planningPeriod.to),
      },
      currentRaBusyRate: opportunity.currentRaBusyRate,
      targetRaBusyRate: opportunity.sourceTargetBusyRate,
      requiredReductionPct: opportunity.reliefNeededPct,
      requiredReductionHoursPerWeek: opportunity.reliefNeededHoursPerWeek,
      status:
        ranked.length === 0
          ? 'no_valid_rebalance_found'
          : ranked.some(
                (recommendation) =>
                  recommendation.beforeAfter.sourceAfterBusyRate <=
                  opportunity.sourceTargetBusyRate,
              )
            ? 'full_solution'
            : 'partial_relief',
      requiresRaConfirmation: opportunity.requiresRaConfirmation,
      recommendations: ranked,
      noResultReasons:
        ranked.length === 0
          ? reasonForNoCandidates(
              slotsForOpportunity.flatMap((slot) => slot.rejectionReasons),
              profile.dataQualityFlags.length > 0,
            )
          : [],
      recommendationDegraded: groupFlags.length > 0,
      dataQualityFlags: groupFlags,
      evidenceVersions: {
        sourceVersions: [
          ...new Set(
            [...input.evidence.skills, ...input.evidence.taskHistory].map(
              (item) => item.sourceVersion,
            ),
          ),
        ].sort(),
        embeddingModelIds: [
          ...new Set(
            input.evidence.taskHistory
              .map((task) => task.embeddingModelId)
              .filter((value): value is string => Boolean(value)),
          ),
        ].sort(),
        embeddingSourceHashes: [
          ...new Set(
            input.evidence.taskHistory
              .map((task) => task.embeddingSourceHash)
              .filter((value): value is string => Boolean(value)),
          ),
        ].sort(),
      },
    });
  }

  return applyPortfolioReservation(groups);
}

export function applyPortfolioReservation(
  groups: RebalanceRecommendationGroup[],
): RebalanceRecommendationGroup[] {
  const reserved = new Map<string, number>();
  const ordered = [...groups].sort(
    (a, b) =>
      Number(b.severity === 'red') - Number(a.severity === 'red') ||
      b.requiredReductionHoursPerWeek - a.requiredReductionHoursPerWeek ||
      a.sourceMemberId.localeCompare(b.sourceMemberId) ||
      a.opportunityId.localeCompare(b.opportunityId),
  );

  for (const group of ordered) {
    const choice = group.recommendations.find((candidate) => {
      const key = `${candidate.targetMemberId}:${candidate.effectiveFrom}`;
      const after =
        candidate.beforeAfter.targetBeforeBusyRate +
        (reserved.get(key) ?? 0) +
        candidate.transferPct;
      if (after > 1.05) return false;
      reserved.set(key, (reserved.get(key) ?? 0) + candidate.transferPct);
      return true;
    });
    if (choice) {
      choice.portfolioSelected = true;
      choice.mutuallyExclusiveAlternative = false;
    }
  }
  return groups;
}
