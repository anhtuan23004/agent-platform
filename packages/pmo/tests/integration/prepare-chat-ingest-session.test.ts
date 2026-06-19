import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { prepareChatIngestSession } from '../../src/backend/ingestion/prepare-chat-ingest-session.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('prepareChatIngestSession', () => {
  it('seeds an approved publish-then-report plan with generate_report step', async () => {
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
           VALUES ($1, $2, 'uploaded', $3, 'book.xlsx', 1024,
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $4, $5)`,
          [sessionId, tenantId, `pmo/${sessionId}/book.xlsx`, userId, threadId],
        );

        const result = await prepareChatIngestSession({
          ingestionSessionId: sessionId,
          tenantId,
          chatThreadId: threadId,
          generateReport: true,
          dateFrom: '2026-06-29',
          dateTo: '2026-08-09',
        });

        expect(result.fileKey).toContain('book.xlsx');
        expect(result.planningGoal).toContain('2026-06-29');
        expect(result.planningGoal).toContain('2026-08-09');

        const row = await pool.query<{
          status: string;
          planning_plan: { compiled_workflow?: Array<{ action_id: string }> };
          reporting_period_start: Date | null;
          reporting_period_end: Date | null;
        }>(
          `SELECT status, planning_plan, reporting_period_start, reporting_period_end
             FROM pmo.ingestion_sessions WHERE id = $1`,
          [sessionId],
        );

        expect(row.rows[0]?.status).toBe('approved_plan');
        const actions =
          row.rows[0]?.planning_plan.compiled_workflow?.map((step) => step.action_id) ?? [];
        expect(actions).toContain('database_change_summary');
        expect(actions).toContain('generate_report');
        expect(row.rows[0]?.reporting_period_start).not.toBeNull();
        expect(row.rows[0]?.reporting_period_end).not.toBeNull();
      } finally {
        await closePools();
      }
    });
  });

  it('rejects sessions not bound to the chat thread', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const uploadThreadId = crypto.randomUUID();
        const otherThreadId = crypto.randomUUID();

        await pool.query(
          `INSERT INTO pmo.ingestion_sessions
             (id, tenant_id, status, source_file_key, source_file_name, source_file_size_bytes,
              mime_type, created_by, chat_thread_id)
           VALUES ($1, $2, 'uploaded', $3, 'book.xlsx', 1024,
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $4, $5)`,
          [sessionId, tenantId, `pmo/${sessionId}/book.xlsx`, userId, uploadThreadId],
        );

        await expect(
          prepareChatIngestSession({
            ingestionSessionId: sessionId,
            tenantId,
            chatThreadId: otherThreadId,
          }),
        ).rejects.toThrow('ingestion_session_not_in_chat_thread');
      } finally {
        await closePools();
      }
    });
  });
});
