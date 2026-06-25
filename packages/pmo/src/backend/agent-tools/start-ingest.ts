import { defineAgentTool, RC_THREAD_ID } from '@seta/agent-sdk';
import { z } from 'zod';
import { prepareChatIngestSession } from '../ingestion/prepare-chat-ingest-session.ts';
import { startIngestWorkflow } from '../workflows/start-ingest.ts';
import { tenantIdFromContext } from './context.ts';

const inputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  generateReport: z.boolean().optional(),
});

const outputSchema = z.object({
  runId: z.string().nullable(),
  ingestionSessionId: z.string().uuid(),
  message: z.string(),
});

export interface PmoStartIngestToolDeps {
  mastra: { getWorkflow(id: string): unknown };
}

export function makePmoStartIngestTool(deps: PmoStartIngestToolDeps) {
  return defineAgentTool({
    id: 'pmo_startIngest',
    name: 'Start PMO Ingest',
    description: [
      'Start the PMO data-ingest workflow for an uploaded workbook session.',
      'Call only when the CURRENT turn context includes <<<PMO_INGEST_SESSION>>> with',
      'ingestionSessionId (workbook uploaded in this chat thread). The workflow auto-runs',
      'to the first review gate; approval cards appear in this chat thread. After publish,',
      'utilization facts are computed automatically. Pass dateFrom/dateTo (YYYY-MM-DD) when',
      'the user names a report date range. Set generateReport true when the user wants',
      'idle/overbook reports after publish.',
    ].join('\n'),
    input: inputSchema,
    output: outputSchema,
    rbac: 'pmo.ingestion.upload',
    execute: async (input, ctx) => {
      const tenantId = tenantIdFromContext(ctx);
      const actor = ctx.requestContext?.get('actor') as { user_id?: string } | undefined;
      const userId = actor?.user_id;
      if (!userId) throw new Error('missing_actor_context');

      const threadId = ctx.requestContext?.get(RC_THREAD_ID) as string | undefined;
      if (!threadId) throw new Error('missing_chat_thread_context');

      const isAgentic = process.env.PMO_AGENTIC_INGESTION === 'true';

      const prepared = await prepareChatIngestSession({
        ingestionSessionId: input.ingestionSessionId,
        tenantId,
        chatThreadId: threadId,
        generateReport: input.generateReport ?? true,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      });

      if (isAgentic) {
        // Seed agent task state so pmo_loadContext can pick it up on the next turn.
        const { upsertAgentTaskState } = await import('../orchestration/agent-memory.ts');
        const goalParts = [`Ingest workbook for session ${input.ingestionSessionId}`];
        if (input.generateReport) goalParts.push(', then generate report');
        if (input.dateFrom && input.dateTo) {
          goalParts.push(` for period ${input.dateFrom} to ${input.dateTo}`);
        }
        await upsertAgentTaskState({
          tenantId,
          threadId,
          sessionId: input.ingestionSessionId,
          originalGoal: goalParts.join(''),
          decomposedTasks: [],
          currentTaskIndex: 0,
          decisions: [],
          blockers: [],
        });

        return {
          runId: null,
          ingestionSessionId: input.ingestionSessionId,
          message:
            'Session prepared for agentic ingestion. Begin by calling pmo_profileWorkbook with this session ID.',
        };
      }

      // Legacy path: start the workflow
      const runId = await startIngestWorkflow({
        ingestionSessionId: input.ingestionSessionId,
        fileKey: prepared.fileKey,
        tenantId,
        userId,
        mastra: deps.mastra,
        threadId,
        reportingPeriodStart: input.dateFrom,
        reportingPeriodEnd: input.dateTo,
      });

      return {
        runId,
        ingestionSessionId: input.ingestionSessionId,
        message: runId
          ? 'Ingest workflow started. Review gates will appear as approval cards in this chat.'
          : 'Could not start ingest workflow — PMO ingest workflow is not registered.',
      };
    },
  });
}
