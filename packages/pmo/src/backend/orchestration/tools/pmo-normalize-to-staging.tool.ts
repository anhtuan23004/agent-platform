import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoNormalizeToStagingTool() {
  return defineAgentTool({
    id: 'pmo_normalizeToStaging',
    name: 'Normalize to Staging',
    description:
      'Normalize workbook data using approved column mappings and stage it for review. ' +
      'Validates required fields, resolves member references, detects duplicates, and ' +
      'transforms raw sheet data into canonical PMO records. ' +
      'Rows with blocking issues (missing references, parse errors) are flagged for operator review. ' +
      'Use this after column mappings have been approved.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to normalize'),
      agentNote: z
        .string()
        .optional()
        .describe('Your reasoning about this step — shown to the user on the review card'),
    }),
    output: HandlerToolResultSchema,
    suspendSchema: IngestionSuspendSchema,
    resumeSchema: IngestionResumeSchema,
    rbac: 'pmo.ingestion.upload',
    executionTimeoutMs: 180_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'normalize_to_staging',
        sessionId: input.sessionId,
        tenantId,
        userId,
        agentCtx: ctx,
        agentNote: input.agentNote,
      });
    },
  });
}
