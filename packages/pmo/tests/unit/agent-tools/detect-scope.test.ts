import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadFactsAndContext: vi.fn(),
  verifyPublishedSession: vi.fn(),
}));

vi.mock('../../../src/backend/analytics/findings-context.ts', () => ({
  loadFactsAndContext: mocks.loadFactsAndContext,
}));

vi.mock('../../../src/backend/reporting/generate-report.ts', () => ({
  verifyPublishedSession: mocks.verifyPublishedSession,
}));

import { pmoDetectMismatchTool } from '../../../src/backend/agent-tools/detect-mismatch.ts';
import { pmoDetectOverbookIdleTool } from '../../../src/backend/agent-tools/detect-overbook-idle.ts';

function makeCtx(scopeSessionId?: string) {
  const requestContext = new RequestContext();
  requestContext.set('tenant_id', 'tenant-1');
  requestContext.set('actor', { type: 'user', user_id: 'user-1' });
  if (scopeSessionId) {
    requestContext.set('pmo.analytics.ingestion_session_id', scopeSessionId);
  }
  return { requestContext } as never;
}

describe('PMO detect tools analytics scope', () => {
  beforeEach(() => {
    mocks.loadFactsAndContext.mockReset();
    mocks.loadFactsAndContext.mockResolvedValue({
      facts: [],
      ctx: { leaves: [], weeksById: new Map(), thresholds: {} },
    });
    mocks.verifyPublishedSession.mockReset();
    mocks.verifyPublishedSession.mockResolvedValue(undefined);
  });

  it('defaults overbook/idle detection to selected chat analytics scope', async () => {
    await pmoDetectOverbookIdleTool.execute?.({}, makeCtx('11111111-1111-4111-8111-111111111111'));

    expect(mocks.verifyPublishedSession).toHaveBeenCalledWith(
      'tenant-1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(mocks.loadFactsAndContext).toHaveBeenCalledWith('tenant-1', {
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('defaults mismatch detection to selected chat analytics scope', async () => {
    await pmoDetectMismatchTool.execute?.({}, makeCtx('22222222-2222-4222-8222-222222222222'));

    expect(mocks.verifyPublishedSession).toHaveBeenCalledWith(
      'tenant-1',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(mocks.loadFactsAndContext).toHaveBeenCalledWith('tenant-1', {
      ingestionSessionId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('lets explicit tool input override chat analytics scope', async () => {
    await pmoDetectOverbookIdleTool.execute?.(
      { ingestionSessionId: '33333333-3333-4333-8333-333333333333' },
      makeCtx('11111111-1111-4111-8111-111111111111'),
    );

    expect(mocks.loadFactsAndContext).toHaveBeenCalledWith('tenant-1', {
      ingestionSessionId: '33333333-3333-4333-8333-333333333333',
    });
  });
});
