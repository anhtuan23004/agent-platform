import type { AllocationRow, MemberWeekFact } from '../../analytics/types.ts';
import { buildCandidatePool } from './candidate-pool.ts';
import { requiredReductionHours, simulateCapacity } from './capacity-simulation.ts';
import type {
  GenerateRecommendationsInput,
  RebalanceRecommendation,
  RebalanceRecommendationGroup,
} from './contracts.ts';
import { validateCandidateCount } from './contracts.ts';
import { scoreProjectContext } from './project-context.ts';
import { calculateCandidateScore, confidenceForScore, stableRank } from './rank.ts';
import { scoreSkillCoverage } from './skill-coverage.ts';
import { scoreTaskHistory } from './task-similarity.ts';
import { buildWorkloadProfile } from './workload-profile.ts';

function activeAllocation(allocation: AllocationRow, weekStart: Date, weekEnd: Date): boolean {
  return allocation.start_date <= weekEnd && allocation.end_date >= weekStart;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function generateRebalanceRecommendations(
  input: GenerateRecommendationsInput,
): RebalanceRecommendationGroup[] {
  if (!input.rules.recommendation.enabled) return [];
  const candidateCount = validateCandidateCount(input.candidateCount, input.rules);
  const greenMin = input.rules.classification.healthy.gte ?? 0;
  const greenMax = input.rules.classification.healthy.lte ?? 1;
  const overbookIds = new Map(
    input.findings
      .filter((finding) => finding.issueType === 'overbook' && finding.ragColor !== 'none')
      .map((finding) => [finding.memberId, finding.ragColor as 'yellow' | 'red']),
  );
  const groups: RebalanceRecommendationGroup[] = [];

  for (const source of input.evidence.facts
    .filter((fact) => overbookIds.has(fact.memberId) && (fact.busyRate ?? 0) > greenMax)
    .sort((a, b) => a.memberId.localeCompare(b.memberId) || a.weekId.localeCompare(b.weekId))) {
    const week = input.evidence.weeks.find((item) => item.week_id === source.weekId);
    if (!week) continue;
    const sourceAllocations = input.evidence.allocations
      .filter(
        (allocation) =>
          allocation.member_id === source.memberId &&
          activeAllocation(allocation, week.week_start, week.week_end),
      )
      .sort(
        (a, b) =>
          (b.weekly_planned_hours ?? 0) - (a.weekly_planned_hours ?? 0) ||
          a.project_id.localeCompare(b.project_id),
      );
    const required = requiredReductionHours(source.plannedHours, source.availableHours, greenMax);
    const full: RebalanceRecommendation[] = [];
    const partial: RebalanceRecommendation[] = [];
    const reasons = new Set<string>();
    const candidatePool = buildCandidatePool({
      sourceMemberId: source.memberId,
      weekId: source.weekId,
      facts: input.evidence.facts,
      members: input.evidence.members,
    });

    if (sourceAllocations.length === 0) reasons.add('project_allocation_unavailable');
    if (candidatePool.length === 0) reasons.add('no_candidate_available');
    for (const allocation of sourceAllocations) {
      const sourceSkills = input.evidence.skills.filter(
        (skill) => skill.memberId === source.memberId,
      );
      const projectTasks = input.evidence.taskHistory.filter(
        (task) => task.memberId === source.memberId && task.projectId === allocation.project_id,
      );
      const profile = buildWorkloadProfile({
        role: allocation.role ?? null,
        sourceSkills,
        projectTasks,
      });
      if (profile.requiredSkills.length === 0) {
        reasons.add('candidate_data_unavailable');
        continue;
      }
      for (const target of candidatePool) {
        const targetSkills = input.evidence.skills.filter(
          (skill) => skill.memberId === target.memberId,
        );
        if (targetSkills.length === 0) {
          reasons.add('candidate_data_unavailable');
          continue;
        }
        const skill = scoreSkillCoverage({
          requiredSkills: profile.requiredSkills,
          candidateSkills: targetSkills,
          adjacentSkills: input.rules.recommendation.adjacentSkills,
        });
        if (skill.score < input.rules.recommendation.minimumSkillCoverage) {
          reasons.add('skill_coverage_below_threshold');
          continue;
        }
        const simulations = simulateCapacity({
          sourcePlanned: source.plannedHours,
          sourceAvailable: source.availableHours,
          targetPlanned: target.plannedHours + target.trainingHours,
          targetAvailable: target.availableHours,
          projectTransferableHours: allocation.weekly_planned_hours ?? 0,
          greenMin,
          greenMax,
          transferStepHours: input.rules.recommendation.transferStepHours,
        });
        if (simulations.length === 0) {
          reasons.add('insufficient_capacity_or_transferable_hours');
          continue;
        }
        const targetTasks = input.evidence.taskHistory.filter(
          (task) => task.memberId === target.memberId,
        );
        const history = scoreTaskHistory({
          workloadEmbedding: profile.embedding,
          tasks: targetTasks,
          effectiveAt: input.effectiveAt,
          historyWindowDays: input.rules.recommendation.historyWindowDays,
          topK: input.rules.recommendation.taskHistoryTopK,
        });
        const simulation = simulations.find((item) => item.fullSolution) ?? simulations[0];
        if (!simulation) continue;
        const capacityFit =
          1 -
          Math.min(
            Math.abs(
              simulation.targetAfterBusyRate - input.rules.recommendation.idealTargetBusyRate,
            ) / input.rules.recommendation.capacityFitTolerance,
            1,
          );
        const projectContext = scoreProjectContext({
          projectId: allocation.project_id,
          role: allocation.role ?? null,
          source: input.evidence.members.find((member) => member.memberId === source.memberId),
          target: input.evidence.members.find((member) => member.memberId === target.memberId),
          targetTasks,
        });
        const scoreBreakdown = {
          skillCoverage: skill.score,
          taskHistorySimilarity: history.score,
          capacityFit,
          projectContext,
        };
        const score = calculateCandidateScore(scoreBreakdown, input.rules);
        const flags = [...new Set([...profile.dataQualityFlags, ...history.flags])].sort();
        const recommendation: RebalanceRecommendation = {
          type: 'rebalance',
          sourceMemberId: source.memberId,
          targetMemberId: target.memberId,
          weekId: source.weekId,
          projectId: allocation.project_id,
          transferHours: simulation.transferHours,
          score: round4(score),
          confidence: confidenceForScore(score, input.rules),
          rankWithinSource: 0,
          portfolioSelected: false,
          mutuallyExclusiveAlternative: true,
          beforeAfter: {
            sourceBeforeBusyRate: source.busyRate ?? source.plannedHours / source.availableHours,
            sourceAfterBusyRate: round4(simulation.sourceAfterBusyRate),
            targetBeforeBusyRate: round4(
              (target.plannedHours + target.trainingHours) / target.availableHours,
            ),
            targetAfterBusyRate: round4(simulation.targetAfterBusyRate),
          },
          scoreBreakdown,
          evidence: {
            matchedSkills: skill.matchedSkills,
            missingSkills: skill.missingSkills,
            similarPastTasks: history.similarPastTasks,
            capacityReason: simulation.fullSolution
              ? 'both_members_green'
              : 'source_overbook_reduced',
          },
          recommendationDegraded: flags.length > 0,
          dataQualityFlags: flags,
        };
        (simulation.fullSolution ? full : partial).push(recommendation);
      }
    }
    const selectedPool = full.length > 0 ? full : partial;
    const recommendations = stableRank(selectedPool).slice(0, candidateCount);
    const flags = [
      ...new Set([
        ...recommendations.flatMap((item) => item.dataQualityFlags),
        ...([...reasons].includes('candidate_data_unavailable')
          ? ['candidate_data_unavailable']
          : []),
      ]),
    ].sort();
    groups.push({
      sourceMemberId: source.memberId,
      weekId: source.weekId,
      severity: overbookIds.get(source.memberId) ?? 'yellow',
      requiredReductionHours: round4(required),
      status:
        recommendations.length === 0
          ? 'no_valid_rebalance_found'
          : full.length > 0
            ? 'full_solution'
            : 'partial_relief',
      recommendations,
      noResultReasons: recommendations.length === 0 ? [...reasons].sort() : [],
      recommendationDegraded: flags.length > 0,
      dataQualityFlags: flags,
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
  return applyPortfolioReservation(groups, input.evidence.facts, greenMax);
}

export function applyPortfolioReservation(
  groups: RebalanceRecommendationGroup[],
  facts: MemberWeekFact[],
  greenMax: number,
): RebalanceRecommendationGroup[] {
  const reserved = new Map<string, number>();
  const ordered = [...groups].sort(
    (a, b) =>
      Number(b.severity === 'red') - Number(a.severity === 'red') ||
      b.requiredReductionHours - a.requiredReductionHours ||
      a.sourceMemberId.localeCompare(b.sourceMemberId) ||
      a.weekId.localeCompare(b.weekId),
  );
  for (const group of ordered) {
    const choice = group.recommendations.find((candidate) => {
      const target = facts.find(
        (fact) => fact.memberId === candidate.targetMemberId && fact.weekId === candidate.weekId,
      );
      if (!target || target.availableHours <= 0) return false;
      const key = `${target.memberId}:${target.weekId}`;
      const effectiveTargetPlanned =
        candidate.beforeAfter.targetBeforeBusyRate * target.availableHours;
      const after =
        (effectiveTargetPlanned + (reserved.get(key) ?? 0) + candidate.transferHours) /
        target.availableHours;
      if (after > greenMax) return false;
      reserved.set(key, (reserved.get(key) ?? 0) + candidate.transferHours);
      return true;
    });
    if (choice) {
      choice.portfolioSelected = true;
      choice.mutuallyExclusiveAlternative = false;
    }
  }
  return groups;
}
