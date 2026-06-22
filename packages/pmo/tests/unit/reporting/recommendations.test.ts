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

function member(memberId: string, roleTitle = 'Backend Engineer', level = 'L3') {
  return {
    memberId,
    department: 'Engineering',
    roleTitle,
    level,
    lineManagerId: null,
    employmentStatus: 'Active',
    employmentType: 'FT',
    stdHoursWeek: 40,
    joinDate: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function task(
  memberId: string,
  historyId: string,
  projectId = 'PRJ-1',
  embedding: number[] | null = [1, 0],
) {
  return {
    historyId,
    memberId,
    projectId,
    allocationRole: 'BE',
    taskTitle: 'API',
    taskSummary: null,
    skillTags: ['java'],
    completedAt: new Date('2026-06-30T00:00:00.000Z'),
    evidenceConfidence: 1,
    embedding,
    embeddingModelId: embedding ? 'test' : null,
    embeddingSourceHash: embedding ? historyId : null,
    sourceVersion: 'v1',
  };
}

function evidence(): RebalanceEvidence {
  return {
    window: {
      evidenceFrom: new Date('2026-06-29T00:00:00.000Z'),
      evidenceTo: new Date('2026-08-07T00:00:00.000Z'),
      planningStart: new Date('2026-08-10T00:00:00.000Z'),
      planningEnd: null,
    },
    facts: [
      fact('SRC', 48),
      fact('TGT1', 24),
      fact('TGT2', 26),
      fact('TGT3', 28),
      fact('TGT4', 42),
    ],
    weeks: [week],
    allocations: [
      {
        member_id: 'SRC',
        project_id: 'PRJ-1',
        role: 'BE',
        allocation_pct: 1.2,
        weekly_planned_hours: 48,
        start_date: new Date('2026-06-29T00:00:00.000Z'),
        end_date: new Date('2026-08-29T00:00:00.000Z'),
      },
      {
        member_id: 'TGT1',
        project_id: 'PRJ-A',
        role: 'BE',
        allocation_pct: 0.6,
        weekly_planned_hours: 24,
        start_date: new Date('2026-08-10T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      },
      {
        member_id: 'TGT2',
        project_id: 'PRJ-B',
        role: 'BE',
        allocation_pct: 0.65,
        weekly_planned_hours: 26,
        start_date: new Date('2026-08-10T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      },
      {
        member_id: 'TGT3',
        project_id: 'PRJ-C',
        role: 'Backend Developer',
        allocation_pct: 0.7,
        weekly_planned_hours: 28,
        start_date: new Date('2026-08-10T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      },
      {
        member_id: 'TGT4',
        project_id: 'PRJ-D',
        role: 'BE',
        allocation_pct: 1.05,
        weekly_planned_hours: 42,
        start_date: new Date('2026-08-10T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      },
    ],
    members: [
      member('SRC', 'Backend Lead', 'L5'),
      member('TGT1'),
      member('TGT2'),
      member('TGT3', 'Backend Developer'),
      member('TGT4'),
    ],
    projects: [
      {
        projectId: 'PRJ-1',
        projectName: 'Project One',
        accountId: 'ACC-1',
        projectType: 'Software',
        projectDomain: 'Software',
        status: 'Active',
        pmId: 'PM-1',
        startDate: week.week_start,
        endDate: new Date('2026-12-31T00:00:00.000Z'),
      },
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
        memberId: 'TGT1',
        skillKey: 'java',
        proficiencyLevel: 3,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
      {
        memberId: 'TGT2',
        skillKey: 'java',
        proficiencyLevel: 2,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
      {
        memberId: 'TGT3',
        skillKey: 'java',
        proficiencyLevel: 2,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
      {
        memberId: 'TGT4',
        skillKey: 'java',
        proficiencyLevel: 3,
        evidenceConfidence: 1,
        sourceVersion: 'v1',
      },
    ],
    taskHistory: [
      task('SRC', 'SRC-TASK'),
      task('TGT1', 'TGT1-TASK'),
      task('TGT2', 'TGT2-TASK'),
      task('TGT3', 'TGT3-TASK'),
      task('TGT4', 'TGT4-TASK'),
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
  it('returns deterministic opportunity-based top-3 recommendations', () => {
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: evidence(),
      rules,
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceMemberId: 'SRC',
      opportunityId: expect.any(String),
      projectId: 'PRJ-1',
      planningPeriod: { from: '2026-08-10', to: '2026-08-29' },
      status: 'full_solution',
    });
    expect(result[0]?.recommendations).toHaveLength(3);
    expect(result[0]?.recommendations[0]).toMatchObject({
      targetMemberId: 'TGT1',
      effectiveFrom: '2026-08-10',
      effectiveTo: '2026-08-29',
      rankWithinOpportunity: 1,
      portfolioSelected: true,
    });
    expect(result[0]?.recommendations.map((item) => item.targetMemberId)).toEqual([
      'TGT1',
      'TGT2',
      'TGT3',
    ]);
  });

  it('returns explicit no-result when hard skill filter fails', () => {
    const value = evidence();
    value.skills = value.skills.filter((skill) => skill.memberId === 'SRC');
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: value,
      rules,
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(result[0]?.status).toBe('no_valid_rebalance_found');
    expect(result[0]?.noResultReasons.length).toBeGreaterThan(0);
  });

  it('degrades transparently when vectors are unavailable', () => {
    const value = evidence();
    value.taskHistory.forEach((entry) => {
      entry.embedding = null;
      entry.embeddingModelId = null;
      entry.embeddingSourceHash = null;
    });
    const result = generateRebalanceRecommendations({
      findings: [finding('SRC')],
      evidence: value,
      rules,
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(result[0]?.recommendations[0]).toMatchObject({ recommendationDegraded: true });
    expect(result[0]?.dataQualityFlags).toContain('workload_embedding_missing');
  });

  it('does not generate replacement recommendations for non-red or idle findings', () => {
    expect(
      generateRebalanceRecommendations({
        findings: [{ ...finding('SRC'), issueType: 'idle' }],
        evidence: evidence(),
        rules,
        effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).toEqual([]);
    expect(
      generateRebalanceRecommendations({
        findings: [finding('SRC', 'yellow')],
        evidence: evidence(),
        rules,
        effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).toEqual([]);
  });

  it('reserves top candidate capacity across competing opportunities', () => {
    const value = evidence();
    value.facts.push(fact('SRC2', 48));
    value.members.push(member('SRC2', 'Backend Lead', 'L5'));
    value.skills.push({
      memberId: 'SRC2',
      skillKey: 'java',
      proficiencyLevel: 3,
      evidenceConfidence: 1,
      sourceVersion: 'v1',
    });
    value.allocations.push({
      member_id: 'SRC2',
      project_id: 'PRJ-2',
      role: 'BE',
      allocation_pct: 1.2,
      weekly_planned_hours: 48,
      start_date: new Date('2026-06-29T00:00:00.000Z'),
      end_date: new Date('2026-08-29T00:00:00.000Z'),
    });
    value.projects.push({
      projectId: 'PRJ-2',
      projectName: 'Project Two',
      accountId: 'ACC-1',
      projectType: 'Software',
      projectDomain: 'Software',
      status: 'Active',
      pmId: 'PM-1',
      startDate: week.week_start,
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    });
    value.taskHistory.push(task('SRC2', 'SRC2-TASK', 'PRJ-2'));

    const result = generateRebalanceRecommendations({
      findings: [finding('SRC'), finding('SRC2')],
      evidence: value,
      rules,
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(
      result.flatMap((group) => group.recommendations).filter((item) => item.portfolioSelected),
    ).toHaveLength(2);
    expect(
      result
        .flatMap((group) => group.recommendations)
        .filter((item) => item.portfolioSelected && item.targetMemberId === 'TGT1'),
    ).toHaveLength(2);
    expect(result).toHaveLength(2);
  });

  it('validates requested candidate count against configured 1..5 range', () => {
    expect(() =>
      generateRebalanceRecommendations({
        findings: [finding('SRC')],
        evidence: evidence(),
        rules,
        effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
        candidateCount: 6,
      }),
    ).toThrow('invalid_recommendation_candidate_count:6');
  });
});
