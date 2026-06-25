import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoProposedColumnMappingsTool() {
  return defineAgentTool({
    id: 'pmo_proposeColumnMappings',
    name: 'Propose Column Mappings',
    description:
      'Present column mapping proposals for operator review. ' +
      'After workbook profiling, this step shows detected column-to-field mappings and asks ' +
      'the operator to approve, reject, or modify each mapping item. ' +
      'Mappings with low confidence or ambiguous candidates require explicit review. ' +
      'Use this after profiling is complete and before normalization.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to map columns for'),
      agentNote: z
        .string()
        .optional()
        .describe('Your reasoning about this step — shown to the user on the review card'),
    }),
    output: HandlerToolResultSchema,
    suspendSchema: IngestionSuspendSchema,
    resumeSchema: IngestionResumeSchema,
    rbac: 'pmo.ingestion.upload',
    executionTimeoutMs: 120_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'column_mapping',
        sessionId: input.sessionId,
        tenantId,
        userId,
        agentCtx: ctx,
        agentNote: input.agentNote,
      });
    },
  });
}
