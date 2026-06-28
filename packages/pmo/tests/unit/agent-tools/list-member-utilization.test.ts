import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMemberUtilization: vi.fn(),
  verifyPublishedSession: vi.fn(),
  recordEntityExposure: vi.fn(),
}));

vi.mock('../../../src/backend/analytics/list-member-utilization.ts', () => ({
  listMemberUtilization: mocks.listMemberUtilization,
}));

vi.mock('../../../src/backend/reporting/generate-report.ts', () => ({
  verifyPublishedSession: mocks.verifyPublishedSession,
}));

vi.mock('@seta/agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seta/agent-sdk')>();
  return {
    ...actual,
    recordEntityExposure: mocks.recordEntityExposure,
  };
});

import { pmoListMemberUtilizationTool } from '../../../src/backend/agent-tools/list-member-utilization.ts';

function makeCtx(scope?: { sessionId?: string; from?: string; to?: string }) {
  const requestContext = new RequestContext();
  requestContext.set('tenant_id', 'tenant-1');
  requestContext.set('actor', { type: 'user', user_id: 'user-1' });
  if (scope?.sessionId) {
    requestContext.set('pmo.analytics.ingestion_session_id', scope.sessionId);
  }
  if (scope?.from && scope?.to) {
    requestContext.set('pmo.analytics.reporting_date_from', scope.from);
    requestContext.set('pmo.analytics.reporting_date_to', scope.to);
  }
  return { requestContext } as never;
}

describe('pmo_listMemberUtilization', () => {
  beforeEach(() => {
    mocks.listMemberUtilization.mockReset();
    mocks.verifyPublishedSession.mockReset();
    mocks.recordEntityExposure.mockReset();
    mocks.listMemberUtilization.mockResolvedValue({
      members: [
        {
          memberId: 'EMP-001',
          fullName: 'Nguyen Van A',
          department: 'Delivery',
          roleTitle: 'Backend Engineer',
          busyRate: 1.15,
          effortConsumption: 1,
          issueType: 'overbook',
          ragColor: 'yellow',
          excludedWeekCount: 0,
          detail: 'Busy 115% — overbooked, rebalance',
          explanation: {
            summary:
              'Busy 115% — overbooked, rebalance Deterministic evidence shows busy rate 115% and effort consumption 100%.',
            riskTradeoffs: [
              'High allocation can increase delivery risk if actual workload stays elevated.',
              'Transfer decisions should still respect role fit and future project demand.',
            ],
          },
        },
      ],
      summary: { totalMembers: 10, matchedMembers: 1 },
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
    });
    mocks.verifyPublishedSession.mockResolvedValue(undefined);
    mocks.recordEntityExposure.mockResolvedValue(undefined);
  });

  it('filters by busyRateGt using scope date range', async () => {
    await pmoListMemberUtilizationTool.execute?.(
      { busyRateGt: 0.5 },
      makeCtx({
        sessionId: '11111111-1111-4111-8111-111111111111',
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    );

    expect(mocks.listMemberUtilization).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        ingestionSessionId: '11111111-1111-4111-8111-111111111111',
        busyRateGt: 0.5,
        dateRange: {
          from: new Date('2026-06-01T00:00:00.000Z'),
          to: new Date('2026-06-30T00:00:00.000Z'),
        },
      }),
    );
    expect(mocks.recordEntityExposure).toHaveBeenCalled();
  });
});
