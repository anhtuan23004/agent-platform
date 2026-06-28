import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  extractIdentity,
  HandlerToolResultSchema,
  IngestionResumeSchema,
  IngestionSuspendSchema,
  runIngestionHandler,
} from './handler-adapter.ts';

export function makePmoPublishChangesTool() {
  return defineAgentTool({
    id: 'pmo_publishChanges',
    name: 'Publish Changes',
    description:
      'Publish approved staging changes into the canonical PMO tables. ' +
      'Upserts new and updated records, skips duplicates, and triggers downstream ' +
      'member-week fact recomputation. This is a write operation that modifies production data. ' +
      'Use this after the database change summary has been reviewed and approved by the operator.',
    input: z.object({
      sessionId: z.string().uuid().describe('The ingestion session ID to publish changes for'),
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
    rbac: 'pmo.data.publish',
    executionTimeoutMs: 180_000,
    execute: async (input, ctx) => {
      const { tenantId, userId } = extractIdentity(ctx);
      return runIngestionHandler({
        actionId: 'publish_after_approval',
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
