import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratePmoReportOutput } from '../../../src/backend/analytics/report.ts';

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

function report(): GeneratePmoReportOutput {
  return {
    dateRange: { from: '2026-06-29', to: '2026-07-05' },
    sourceVersion: {
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-07-05T12:00:00.000Z',
    },
    summary: { memberCount: 3, overbookCount: 2, idleCount: 0, excludedWeekCount: 0 },
    members: [
      { memberId: 'EMP-001', fullName: 'Source One', department: 'Delivery', roleTitle: 'BE' },
      { memberId: 'EMP-002', fullName: 'Target Two', department: 'Delivery', roleTitle: 'BE' },
      { memberId: 'EMP-003', fullName: 'Source Three', department: 'Data', roleTitle: 'DE' },
    ],
    projectionFreshness: {
      skillsCount: 2,
      taskHistoryCount: 2,
      lastSyncedAt: '2026-07-05T00:00:00.000Z',
      degraded: false,
    },
    dataQuality: { recommendationDegraded: false, flags: [] },
    findings: [
      {
        memberId: 'EMP-001',
        issueType: 'overbook',
        ragColor: 'red',
        busyRate: 1.2,
        effortConsumption: 1,
        detail: 'overbook',
        excludedWeeks: [],
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
    recommendations: [group('EMP-001', 'W1', 'EMP-002'), group('EMP-003', 'W2', 'EMP-002')],
  };
}

function group(
  sourceMemberId: string,
  weekId: string,
  targetMemberId: string,
): GeneratePmoReportOutput['recommendations'][number] {
  return {
    sourceMemberId,
    weekId,
    severity: 'red',
    requiredReductionHours: 8,
    status: 'full_solution',
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
        weekId,
        projectId: 'PRJ-1',
        transferHours: 8,
        score: 0.91,
        confidence: 'high',
        rankWithinSource: 1,
        portfolioSelected: true,
        mutuallyExclusiveAlternative: false,
        beforeAfter: {
          sourceBeforeBusyRate: 1.2,
          sourceAfterBusyRate: 1,
          targetBeforeBusyRate: 0.7,
          targetAfterBusyRate: 0.9,
        },
        scoreBreakdown: {
          skillCoverage: 1,
          taskHistorySimilarity: 0.8,
          capacityFit: 0.9,
          projectContext: 0.7,
        },
        evidence: {
          matchedSkills: ['java'],
          missingSkills: [],
          similarPastTasks: ['API endpoint implementation'],
          capacityReason: 'both_members_green',
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
    recommendations: Array<{ sourceMemberId: string; weekId: string }>;
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

  it('filters by week id without creating a report run', async () => {
    mocks.generatePmoReport.mockResolvedValueOnce(report());

    const result = await execute({
      dateRange: { from: '2026-06-29', to: '2026-07-05' },
      weekId: 'W2',
    });

    expect(result.recommendations).toMatchObject([{ sourceMemberId: 'EMP-003', weekId: 'W2' }]);
    expect(mocks.generatePmoReport).toHaveBeenCalledTimes(1);
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
