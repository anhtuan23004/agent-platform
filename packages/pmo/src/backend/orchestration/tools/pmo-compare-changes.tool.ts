import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoCompareChangesTool() {
  return defineAgentTool({
    id: 'pmo_compareChanges',
    name: 'Compare Database Changes',
    description:
      'Compare staged data against the canonical PMO database and present a change summary. ' +
      'Shows new records, updated records, exact duplicates, and any blocking issues. ' +
      'The operator reviews the diff before deciding to publish or reject. ' +
      'Use this after normalization is complete to see what would change in the database.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to compare changes for'),
      agentNote: z
        .string()
        .optional()
        .describe('Your reasoning about this step — shown to the user on the review card'),
    }),
    output: HandlerToolResultSchema,
    suspendSchema: IngestionSuspendSchema,
    resumeSchema: IngestionResumeSchema,
    rbac: 'pmo.data.read',
    executionTimeoutMs: 120_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'database_change_summary',
        sessionId: input.sessionId,
        tenantId,
        userId,
        agentCtx: ctx,
        agentNote: input.agentNote,
      });
    },
  });
}
