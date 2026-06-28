import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoProfileWorkbookTool() {
  return defineAgentTool({
    id: 'pmo_profileWorkbook',
    name: 'Profile Workbook',
    description:
      'Profile an uploaded workbook for a PMO ingestion session. ' +
      'Detects sheets, column headers, and maps them to the canonical PMO schema. ' +
      'Use this as the first step after a workbook has been uploaded and an ingestion session created. ' +
      'The result includes detected table mappings, validation status, and workbook confidence.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to profile'),
      agentNote: z
        .string()
        .optional()
        .describe('Your reasoning about this step — shown to the user on the review card'),
      clarifications: z
        .array(z.object({ role: z.enum(['agent', 'user']), message: z.string(), ts: z.string() }))
        .optional()
        .default([])
        .describe('Conversation history from previous clarification rounds on this card'),
    }),
    output: HandlerToolResultSchema,
    suspendSchema: IngestionSuspendSchema,
    resumeSchema: IngestionResumeSchema,
    rbac: 'pmo.ingestion.upload',
    executionTimeoutMs: 120_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'workbook_profiling',
        sessionId: input.sessionId,
        tenantId,
        userId,
        agentCtx: ctx,
        agentNote: input.agentNote,
        clarifications: input.clarifications,
      });
    },
  });
}
