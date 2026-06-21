import { describe, expect, it } from 'vitest';
import type { Finding, MemberWeekFact, WeekRow } from '../../../src/backend/analytics/types.ts';
import {
  generateRebalanceRecommendations,
  type RebalanceEvidence,
  requiredReductionHours,
  scoreSkillCoverage,
  simulateCapacity,
} from '../../../src/backend/reporting/recommendations/index.ts';
import { loadPmoReportRuleCatalog } from '../../../src/backend/reporting/rules/load.ts';

const rules = loadPmoReportRuleCatalog()[0];
if (!rules) throw new Error('missing_test_rules');

const week: WeekRow = {
  week_id: 'W1',
  week_start: new Date('2026-06-29T00:00:00.000Z'),
  week_end: new Date('2026-07-05T00:00:00.000Z'),
  working_days: 5,
  holiday_hours_ft: 0,
};

function fact(memberId: string, planned: number, training = 0): MemberWeekFact {
  return {
    memberId,
    weekId: 'W1',
    scopeStatus: 'IN_SCOPE',
    availableHours: 40,
    plannedHours: planned,
    loggedHours: planned,
    expectedLoggedHours: planned,
    billableHours: planned,
    benchHours: 0,
    overtimeHours: 0,
    trainingHours: training,
    busyRate: planned / 40,
    utilization: planned / 40,
    billableRate: 1,
    benchRate: 0,
    overtimeRatio: 0,
    effortConsumption: 1,
    trainingCompliance: null,
    ragColor: planned >= 48 ? 'red' : planned > 44 ? 'yellow' : 'green',
    issueType: planned > 44 ? 'overbook' : 'ok',
  };
}

function finding(memberId: string, severity: 'yellow' | 'red' = 'red'): Finding {
  return {
    memberId,
    issueType: 'overbook',
    ragColor: severity,
    busyRate: severity === 'red' ? 1.2 : 1.15,
    effortConsumption: 1,
    detail: 'overbook',
    excludedWeeks: [],
    annotations: [],
    reviewRequired: true,
    suggestedActionCode: 'REBALANCE_ALLOCATION',
    suggestedActions: [
      {
        actionCode: 'REBALANCE_ALLOCATION',
        templateText:
          'Review workload allocation with project leads and consider redistributing hours to under-utilised team members.',
        primary: true,
      },
    ],
  };
}

function evidence(sourcePlanned = 48, targetPlanned = 32): RebalanceEvidence {
  return {
    facts: [fact('SRC', sourcePlanned), fact('TGT', targetPlanned)],
    weeks: [week],
    allocations: [
      {
        member_id: 'SRC',
        project_id: 'PRJ-1',
        role: 'BE',
        allocation_pct: 0.4,
        weekly_planned_hours: 16,
        start_date: week.week_start,
        end_date: week.week_end,
      },
    ],
    members: [
      { memberId: 'SRC', department: 'Engineering', roleTitle: 'Backend Engineer' },
      { memberId: 'TGT', department: 'Engineering', roleTitle: 'Backend Engineer' },
    ],
    skills: [
      {
        memberId: 'SRC',
        skillKey: 'java',
        proficiencyLevel: 3,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
      {
        memberId: 'TGT',
        skillKey: 'java',
        proficiencyLevel: 3,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
    ],
    taskHistory: [
      {
        historyId: 'SRC-TASK',
        memberId: 'SRC',
        projectId: 'PRJ-1',
        allocationRole: 'BE',
        taskTitle: 'API',
        taskSummary: null,
        skillTags: ['java'],
        completedAt: new Date('2026-06-30T00:00:00.000Z'),
        evidenceConfidence: 1,
        embedding: [1, 0],
        embeddingModelId: 'test',
        embeddingSourceHash: 'source',
        sourceVersion: 'v1',
      },
      {
        historyId: 'TGT-TASK',
        memberId: 'TGT',
        projectId: 'PRJ-1',
        allocationRole: 'BE',
        taskTitle: 'API',
        taskSummary: null,
        skillTags: ['java'],
        completedAt: new Date('2026-06-30T00:00:00.000Z'),
        evidenceConfidence: 1,
        embedding: [1, 0],
        embeddingModelId: 'test',
        embeddingSourceHash: 'target',
        sourceVersion: 'v1',
      },
    ],
  };
}

describe('rebalance recommendation formulas', () => {
  it('rounds required relief up to transfer step and simulates both sides', () => {
    expect(requiredReductionHours(50, 40, 1.1)).toBeCloseTo(6);
    expect(
      simulateCapacity({
        sourcePlanned: 50,
        sourceAvailable: 40,
        targetPlanned: 30,
        targetAvailable: 40,
        projectTransferableHours: 12,
        greenMin: 0.85,
        greenMax: 1.1,
        transferStepHours: 4,
      })[0],
    ).toMatchObject({ transferHours: 8, fullSolution: true, sourceAfterBusyRate: 1.05 });
  });

  it('uses exact/lower/adjacent/missing equal-weight skill scores', () => {
    const result = scoreSkillCoverage({
      requiredSkills: [
        { skillKey: 'java', level: 4 },
        { skillKey: 'sql', level: 2 },
        { skillKey: 'aws', level: 2 },
        { skillKey: 'go', level: 2 },
      ],
      candidateSkills: [
        {
          memberId: 'T',
          skillKey: 'java',
          proficiencyLevel: 3,
          evidenceConfidence: 1,
          sourceVersion: 'v',
        },
        {
          memberId: 'T',
          skillKey: 'sql',
          proficiencyLevel: 2,
          evidenceConfidence: 1,
          sourceVersion: 'v',
        },
        {
          memberId: 'T',
          skillKey: 'azure',
          proficiencyLevel: 2,
          evidenceConfidence: 1,
          sourceVersion: 'v',
        },
      ],
      adjacentSkills: { aws: ['azure'] },
    });
    expect(result.score).toBeCloseTo((0.7 + 1 + 0.5) / 4);
    expect(result.missingSkills).toEqual(['go']);
  });
});

describe('rebalance recommendation generation', () => {
  it('returns deterministic full solution with before/after evidence', () => {
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: evidence(),
      rules,
      effectiveAt: week.week_end,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: 'full_solution', requiredReductionHours: 4 });
    expect(result[0]?.recommendations[0]).toMatchObject({
      targetMemberId: 'TGT',
      transferHours: 4,
      portfolioSelected: true,
      rankWithinSource: 1,
      beforeAfter: { sourceAfterBusyRate: 1.1, targetAfterBusyRate: 0.9 },
    });
  });

  it('keeps partial relief only when no full solution exists', () => {
    const value = evidence(52, 32);
    value.allocations[0]!.weekly_planned_hours = 4;
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: value,
      rules,
      effectiveAt: week.week_end,
    });
    expect(result[0]).toMatchObject({ status: 'partial_relief' });
    expect(result[0]?.recommendations[0]?.beforeAfter.sourceAfterBusyRate).toBe(1.2);
  });

  it('returns explicit no-result when hard skill filter fails', () => {
    const value = evidence();
    value.skills = value.skills.filter((skill) => skill.memberId === 'SRC');
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: value,
      rules,
      effectiveAt: week.week_end,
    });
    expect(result[0]).toMatchObject({
      status: 'no_valid_rebalance_found',
      noResultReasons: ['candidate_data_unavailable'],
    });
  });

  it('degrades transparently when vectors are unavailable', () => {
    const value = evidence();
    value.taskHistory.forEach((task) => {
      task.embedding = null;
    });
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: value,
      rules,
      effectiveAt: week.week_end,
    });
    expect(result[0]?.recommendations[0]).toMatchObject({ recommendationDegraded: true });
    expect(result[0]?.dataQualityFlags).toContain('workload_embedding_missing');
  });

  it('does not generate replacement recommendations for idle findings', () => {
    expect(
      generateRebalanceRecommendations({
        findings: [{ ...finding('SRC'), issueType: 'idle' }],
        evidence: evidence(),
        rules,
        effectiveAt: week.week_end,
      }),
    ).toEqual([]);
  });

  it('reserves top-1 target capacity across competing sources', () => {
    const value = evidence(48, 40);
    value.facts.push(fact('SRC2', 48));
    value.members.push({
      memberId: 'SRC2',
      department: 'Engineering',
      roleTitle: 'Backend Engineer',
    });
    value.skills.push({
      memberId: 'SRC2',
      skillKey: 'java',
      proficiencyLevel: 3,
      evidenceConfidence: 1,
      sourceVersion: 'v1',
    });
    value.allocations.push({ ...value.allocations[0]!, member_id: 'SRC2' });
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC'), finding('SRC2')],
      evidence: value,
      rules,
      effectiveAt: week.week_end,
    });
    expect(
      result.flatMap((group) => group.recommendations).filter((item) => item.portfolioSelected),
    ).toHaveLength(1);
  });

  it('validates requested candidate count against configured 1..5 range', () => {
    expect(() =>
      generateRebalanceRecommendations({
        findings: [finding('SRC')],
        evidence: evidence(),
        rules,
        effectiveAt: week.week_end,
        candidateCount: 6,
      }),
    ).toThrow('invalid_recommendation_candidate_count:6');
  });
});
