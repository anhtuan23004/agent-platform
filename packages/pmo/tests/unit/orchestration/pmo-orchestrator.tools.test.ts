import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runUtilizationQuery: vi.fn(),
  recordEntityExposure: vi.fn(),
}));

vi.mock('../../../src/backend/orchestration/agents/utilization-query.ts', () => ({
  runUtilizationQuery: mocks.runUtilizationQuery,
}));

vi.mock('@seta/agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seta/agent-sdk')>();
  return {
    ...actual,
    recordEntityExposure: mocks.recordEntityExposure,
  };
});

import { makePmoOrchestratorTools } from '../../../src/backend/orchestration/orchestrator.tools.ts';

function makeToolCtx() {
  const requestContext = new RequestContext();
  requestContext.set('tenant_id', 'tenant-1');
  requestContext.set('actor', { type: 'user', user_id: 'user-1' });
  return { requestContext } as never;
}

describe('makePmoOrchestratorTools', () => {
  beforeEach(() => {
    mocks.runUtilizationQuery.mockReset();
    mocks.recordEntityExposure.mockReset();
    mocks.runUtilizationQuery.mockResolvedValue({
      intent: 'count_members_by_busy_rate',
      memberCount: 3,
      members: [],
    });
    mocks.recordEntityExposure.mockResolvedValue(undefined);
  });

  it('routes count_members_by_busy_rate through runUtilizationQuery', async () => {
    const generalAnswer = {
      run: vi.fn(),
    };
    const tools = makePmoOrchestratorTools({
      generalAnswer: generalAnswer as never,
      userText: 'how many members busy > 50%',
      ctx: {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
      },
    });

    const result = await tools.pmo_queryUtilization.execute?.(
      { intent: 'count_members_by_busy_rate', busyRateGt: 0.5 },
      makeToolCtx(),
    );

    expect(mocks.runUtilizationQuery).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'count_members_by_busy_rate', busyRateGt: 0.5 }),
      expect.anything(),
    );
    expect(result).toMatchObject({ memberCount: 3 });
  });

  it('returns clarification without recording entity exposure', async () => {
    mocks.runUtilizationQuery.mockResolvedValue({
      intent: 'count_members_by_busy_rate',
      needsClarification: true,
      clarificationOptions: ['Custom threshold'],
    });

    const tools = makePmoOrchestratorTools({
      generalAnswer: { run: vi.fn() } as never,
      userText: 'who is chilling',
      ctx: { tenantId: 'tenant-1', actorUserId: 'user-1' },
    });

    const result = await tools.pmo_queryUtilization.execute?.(
      { intent: 'count_members_by_busy_rate' },
      makeToolCtx(),
    );

    expect(result).toMatchObject({ needsClarification: true });
    expect(mocks.recordEntityExposure).not.toHaveBeenCalled();
  });
});
