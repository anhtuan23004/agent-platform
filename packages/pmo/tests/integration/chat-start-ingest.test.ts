import { RC_THREAD_ID } from '@seta/agent-sdk';
import { makeToolContext } from '@seta/agent-sdk/testing';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it, vi } from 'vitest';
import { makePmoStartIngestTool } from '../../src/backend/agent-tools/start-ingest.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('pmo_startIngest tool', () => {
  it('prepares session and starts workflow with chat thread context', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const threadId = crypto.randomUUID();

        await pool.query(
          `INSERT INTO pmo.ingestion_sessions
             (id, tenant_id, status, source_file_key, source_file_name, source_file_size_bytes,
              mime_type, created_by, chat_thread_id)
           VALUES ($1, $2, 'uploaded', $3, 'book.xlsx', 2048,
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $4, $5)`,
          [sessionId, tenantId, `pmo/${sessionId}/book.xlsx`, userId, threadId],
        );

        const start = vi.fn().mockResolvedValue(undefined);
        const createRun = vi.fn().mockResolvedValue({ runId: 'wf-run-1', start });
        const tool = makePmoStartIngestTool({
          mastra: { getWorkflow: () => ({ createRun }) },
        });

        const ctx = makeToolContext({ user_id: userId, tenant_id: tenantId });
        ctx.requestContext?.set(RC_THREAD_ID, threadId);

        const result = (await tool.execute!(
          {
            ingestionSessionId: sessionId,
            dateFrom: '2026-06-29',
            dateTo: '2026-08-09',
            generateReport: true,
          },
          ctx,
        )) as { runId: string | null; ingestionSessionId: string; message: string };

        expect(result).toMatchObject({
          runId: 'wf-run-1',
          ingestionSessionId: sessionId,
        });
        expect(start).toHaveBeenCalledTimes(1);
        expect(start.mock.calls[0]![0].requestContext.get('thread_id')).toBe(threadId);

        const session = await pool.query<{ status: string }>(
          `SELECT status FROM pmo.ingestion_sessions WHERE id = $1`,
          [sessionId],
        );
        expect(session.rows[0]?.status).toBe('approved_plan');
      } finally {
        await closePools();
      }
    });
  });
});
