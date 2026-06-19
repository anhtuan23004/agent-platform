import type { RequestContext } from '@mastra/core/request-context';
import { RC_THREAD_ID } from '@seta/agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { startIngestWorkflow } from '../../../src/backend/workflows/start-ingest.ts';

describe('startIngestWorkflow', () => {
  it('passes thread_id on requestContext for chat gate surfacing', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const createRun = vi.fn().mockResolvedValue({ runId: 'run-1', start });
    const mastra = {
      getWorkflow: vi.fn().mockReturnValue({ createRun }),
    };

    const threadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const runId = await startIngestWorkflow({
      ingestionSessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fileKey: 'tenant/pmo/file.xlsx',
      tenantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      mastra,
      threadId,
      reportingPeriodStart: '2026-06-29',
      reportingPeriodEnd: '2026-08-09',
    });

    expect(runId).toBe('run-1');
    expect(start).toHaveBeenCalledTimes(1);
    const startArg = start.mock.calls[0]![0] as {
      inputData: Record<string, unknown>;
      requestContext: RequestContext;
    };
    expect(startArg.inputData.reportingPeriodStart).toBe('2026-06-29');
    expect(startArg.requestContext.get('thread_id')).toBe(threadId);
    expect(startArg.requestContext.get(RC_THREAD_ID)).toBe(threadId);
    expect(startArg.requestContext.get('parent_thread_id')).toBe(threadId);
    expect(startArg.requestContext.get('started_via')).toBe('chat');
  });
});
