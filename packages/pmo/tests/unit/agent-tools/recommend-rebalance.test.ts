import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
<<<<<<< HEAD
import type { GeneratePmoReportOutput } from '../../../src/backend/analytics/report.ts';
=======
import type { WorkloadReportOutput } from '../../../src/backend/reporting/report-output.ts';
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)

const mocks = vi.hoisted(() => ({
  generatePmoReport: vi.fn(),
  verifyPublishedSession: vi.fn(),
}));

vi.mock('../../../src/backend/analytics/report.ts', () => ({
  generatePmoReport: mocks.generatePmoReport,
}));

vi.mock('../../../src/backend/reporting/generate-report.ts', () => ({
  verifyPublishedSession: mocks.verifyPublishedSession,
}));

const { pmoRecommendRebalanceTool } = await import(
  '../../../src/backend/agent-tools/recommend-rebalance.ts'
);

<<<<<<< HEAD
function report(): GeneratePmoReportOutput {
  return {
    dateRange: { from: '2026-06-29', to: '2026-07-05' },
=======
function report(): WorkloadReportOutput {
  return {
    reportFamily: 'workload',
    dateRange: { from: '2026-06-29', to: '2026-07-12' },
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    sourceVersion: {
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-07-05T12:00:00.000Z',
    },
<<<<<<< HEAD
    summary: { memberCount: 3, overbookCount: 2, idleCount: 0, excludedWeekCount: 0 },
=======
    summary: { memberCount: 3, overbookCount: 2, idleCount: 0, excludedWeekCount: 1 },
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    members: [
      { memberId: 'EMP-001', fullName: 'Source One', department: 'Delivery', roleTitle: 'BE' },
      { memberId: 'EMP-002', fullName: 'Target Two', department: 'Delivery', roleTitle: 'BE' },
      { memberId: 'EMP-003', fullName: 'Source Three', department: 'Data', roleTitle: 'DE' },
    ],
<<<<<<< HEAD
    findings: [
      {
        memberId: 'EMP-001',
        issueType: 'overbook',
        ragColor: 'red',
        busyRate: 1.2,
        effortConsumption: 1,
        detail: 'overbook',
        excludedWeeks: [],
        issueWeeks: [
          {
            weekId: 'W1',
            weekStart: '2026-06-29',
            weekEnd: '2026-07-05',
            issueType: 'overbook',
            ragColor: 'red',
            availableHours: 40,
            plannedHours: 48,
            loggedHours: 40,
            busyRate: 1.2,
            effortConsumption: 1,
          },
        ],
        annotations: [],
        reviewRequired: true,
        suggestedActionCode: 'REBALANCE_ALLOCATION',
        suggestedActions: [],
        metricEvidence: {
          N01: 1.2,
          N02: 1,
          N03: 1,
          N04: 0,
          N05: 0,
          N06: 1,
          N12: null,
        },
      },
      {
        memberId: 'EMP-003',
        issueType: 'overbook',
        ragColor: 'yellow',
        busyRate: 1.12,
        effortConsumption: 1,
        detail: 'overbook',
        excludedWeeks: [],
        issueWeeks: [
          {
            weekId: 'W2',
            weekStart: '2026-07-06',
            weekEnd: '2026-07-12',
            issueType: 'overbook',
            ragColor: 'yellow',
            availableHours: 40,
            plannedHours: 45,
            loggedHours: 40,
            busyRate: 1.12,
            effortConsumption: 1,
          },
        ],
        annotations: [],
        reviewRequired: true,
        suggestedActionCode: 'REBALANCE_ALLOCATION',
        suggestedActions: [],
        metricEvidence: {
          N01: 1.12,
          N02: 1,
          N03: 1,
          N04: 0,
          N05: 0,
          N06: 1,
          N12: null,
        },
      },
    ],
=======
    findings: [finding('EMP-001'), finding('EMP-003', [{ weekId: 'W1', reason: 'approved_ot' }])],
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    recommendations: [
      group('EMP-001:PRJ-1:BE:2026-06-29:2026-07-05', 'EMP-001', 'EMP-002'),
      group('EMP-003:PRJ-1:BE:2026-07-06:2026-07-12', 'EMP-003', 'EMP-002'),
    ],
  };
}

<<<<<<< HEAD
=======
function finding(
  memberId: string,
  excludedWeeks: WorkloadReportOutput['findings'][number]['excludedWeeks'] = [],
): WorkloadReportOutput['findings'][number] {
  return {
    memberId,
    issueType: 'overbook',
    ragColor: 'red',
    busyRate: 1.2,
    effortConsumption: 1,
    detail: 'overbook',
    excludedWeeks,
    annotations: [],
    reviewRequired: true,
    suggestedActionCode: 'REBALANCE_ALLOCATION',
    suggestedActions: [],
    metricEvidence: {
      N01: 1.2,
      N02: 1,
      N03: 1,
      N04: 0,
      N05: 0,
      N06: 1,
      N12: null,
    },
  };
}

>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
function group(
  opportunityId: string,
  sourceMemberId: string,
  targetMemberId: string,
<<<<<<< HEAD
): GeneratePmoReportOutput['recommendations'][number] {
=======
): WorkloadReportOutput['recommendations'][number] {
  const [, , , from = '', to = ''] = opportunityId.split(':');
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
  return {
    opportunityId,
    sourceMemberId,
    projectId: 'PRJ-1',
    roleNeeded: 'BE',
    severity: 'red',
<<<<<<< HEAD
    evidenceWindow: { from: '2026-06-29', to: '2026-07-05' },
    planningPeriod: { from: '2026-06-29', to: '2026-07-05' },
=======
    evidenceWindow: { from, to },
    planningPeriod: { from, to },
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    currentRaBusyRate: 1.2,
    targetRaBusyRate: 0.95,
    requiredReductionPct: 0.2,
    requiredReductionHoursPerWeek: 8,
    status: 'full_solution',
    requiresRaConfirmation: false,
    noResultReasons: [],
    recommendationDegraded: false,
    dataQualityFlags: [],
    evidenceVersions: {
      sourceVersions: ['v1'],
      embeddingModelIds: [],
      embeddingSourceHashes: [],
    },
    recommendations: [
      {
        type: 'rebalance',
        sourceMemberId,
        targetMemberId,
        opportunityId,
        projectId: 'PRJ-1',
        roleNeeded: 'BE',
<<<<<<< HEAD
        effectiveFrom: '2026-06-29',
        effectiveTo: '2026-07-05',
=======
        effectiveFrom: from,
        effectiveTo: to,
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
        transferPct: 0.2,
        transferHoursPerWeek: 8,
        score: 0.91,
        confidence: 'high',
        rankWithinOpportunity: 1,
        portfolioSelected: true,
        mutuallyExclusiveAlternative: false,
        beforeAfter: {
          sourceBeforeBusyRate: 1.2,
          sourceAfterBusyRate: 1,
          targetBeforeBusyRate: 0.7,
          targetAfterBusyRate: 0.9,
        },
        scoreBreakdown: {
          skillMatch: 1,
          historyMatch: 0.8,
          roleContextMatch: 0.7,
          capacityFit: 0.9,
          riskAdjustment: 0,
        },
        evidence: {
          matchedSkills: ['java'],
          missingSkills: [],
          similarPastTasks: ['API endpoint implementation'],
          sourceRiskFlags: [],
          candidateRiskFlags: [],
          rationale: 'both_members_green',
        },
        recommendationDegraded: false,
        dataQualityFlags: [],
      },
    ],
  };
}

async function execute(input: Record<string, unknown>) {
  const requestContext = new RequestContext();
  requestContext.set('tenant_id', 'tenant-1');
  requestContext.set('actor', { type: 'user', user_id: 'user-1' });
  const callTool = pmoRecommendRebalanceTool.execute as NonNullable<
    typeof pmoRecommendRebalanceTool.execute
  >;
  return callTool(input, {
    requestContext,
  } as never) as Promise<{
    findings: Array<{ memberId: string }>;
    recommendations: Array<{ sourceMemberId: string; opportunityId: string }>;
    members: Array<{ memberId: string }>;
  }>;
}

describe('pmo_recommendRebalance tool', () => {
  beforeEach(() => {
    mocks.generatePmoReport.mockReset();
    mocks.verifyPublishedSession.mockReset();
    mocks.verifyPublishedSession.mockResolvedValue(undefined);
  });

  it('calls report analytics directly and filters by source member', async () => {
    mocks.generatePmoReport.mockResolvedValueOnce(report());

    const result = await execute({
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      sourceMemberId: 'EMP-001',
      recommendationCandidateCount: 3,
    });

    expect(mocks.generatePmoReport).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      reportTypes: ['overbook_members'],
      recommendationCandidateCount: 3,
    });
    expect(result.recommendations.map((item) => item.sourceMemberId)).toEqual(['EMP-001']);
    expect(result.findings.map((item) => item.memberId)).toEqual(['EMP-001']);
    expect(result.members.map((item) => item.memberId).sort()).toEqual(['EMP-001', 'EMP-002']);
  });

  it('filters by opportunity id without creating a report run', async () => {
    mocks.generatePmoReport.mockResolvedValueOnce(report());

    const result = await execute({
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      opportunityId: 'EMP-003:PRJ-1:BE:2026-07-06:2026-07-12',
    });

    expect(result.recommendations).toMatchObject([
      { sourceMemberId: 'EMP-003', opportunityId: 'EMP-003:PRJ-1:BE:2026-07-06:2026-07-12' },
    ]);
    expect(mocks.generatePmoReport).toHaveBeenCalledTimes(1);
  });

<<<<<<< HEAD
  it('filters by week id using calendar week evidence', async () => {
=======
  it('filters by week id using the report date range and opportunity dates', async () => {
>>>>>>> 853f2503 (fix(pmo): narrow workload rebalance report helpers)
    mocks.generatePmoReport.mockResolvedValueOnce(report());

    const result = await execute({
      dateRange: { from: '2026-06-29', to: '2026-07-12' },
      weekId: 'W1',
    });

    expect(result.recommendations).toMatchObject([
      { sourceMemberId: 'EMP-001', opportunityId: 'EMP-001:PRJ-1:BE:2026-06-29:2026-07-05' },
    ]);
    expect(result.findings.map((item) => item.memberId)).toEqual(['EMP-001']);
  });

  it('scopes to a published ingestion session when ingestionSessionId is provided', async () => {
    mocks.generatePmoReport.mockResolvedValueOnce(report());

    await execute({
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
    });

    expect(mocks.verifyPublishedSession).toHaveBeenCalledWith(
      'tenant-1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(mocks.generatePmoReport).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      reportTypes: ['overbook_members'],
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
      reportSource: 'published_batch',
    });
  });
});
