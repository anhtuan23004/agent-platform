import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoGenerateReportTool() {
  return defineAgentTool({
    id: 'pmo_generateReport',
    name: 'Generate Report',
    description:
      'Generate PMO utilization reports (overbook, idle, forward allocation) for a date range. ' +
      'May prompt the operator to confirm or adjust the reporting date range before generation. ' +
      'Reports are computed from published canonical data or staging preview depending on the workflow plan. ' +
      'Use this as the final step after data has been published, or as a standalone reporting step.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to generate a report for'),
      agentNote: z
        .string()
        .optional()
        .describe('Your reasoning about this step — shown to the user on the review card'),
    }),
    output: HandlerToolResultSchema,
    suspendSchema: IngestionSuspendSchema,
    resumeSchema: IngestionResumeSchema,
    rbac: 'pmo.data.read',
    executionTimeoutMs: 180_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'generate_report',
        sessionId: input.sessionId,
        tenantId,
        userId,
        agentCtx: ctx,
        agentNote: input.agentNote,
      });
    },
  });
}
