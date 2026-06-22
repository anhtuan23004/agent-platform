import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { RequestContext } from '@mastra/core/request-context';
import type { AgentResult, SpecializedAgentRunCtx, SpecializedAgentSpec } from '@seta/agent-sdk';
import type { z } from 'zod';
import { GeneralAnswerInputSchema, GeneralAnswerOutputSchema } from '../schemas.ts';

type In = z.infer<typeof GeneralAnswerInputSchema>;
type Out = z.infer<typeof GeneralAnswerOutputSchema>;

export interface PmoGeneralAnswerDeps {
  resolveModel: () => MastraModelConfig;
  runAgent?: (args: { input: In; requestContext: RequestContext }) => Promise<{ text: string }>;
}

const INSTRUCTIONS = [
  'You answer the user question directly and concisely about PMO or general topics.',
  'For member roles, org chart, or staffing assignment questions, tell the user to switch to the Staffing Agent.',
  'For workbook ingest, mapping, publish, or upload, direct users to /pmo — PMO chat is analytics-only on published data.',
  'Never invent utilization numbers; if the question needs PMO data, say the PMO query tools should be used instead.',
].join(' ');

export function makePmoGeneralAnswerAgent(
  deps: PmoGeneralAnswerDeps,
): SpecializedAgentSpec<In, Out> {
  return {
    id: 'pmo.generalAnswer',
    description: 'Answers general or out-of-domain PMO chat questions in prose.',
    inputSchema: GeneralAnswerInputSchema,
    outputSchema: GeneralAnswerOutputSchema,
    run: async (input, ctx): Promise<AgentResult<Out>> => {
      const rc = new RequestContext();
      rc.set('actor', { type: 'user', user_id: ctx.actorUserId });
      rc.set('tenant_id', ctx.tenantId);
      rc.set('effective_permissions', ctx.effectivePermissions ?? new Set<string>());

      const out = deps.runAgent
        ? await deps.runAgent({ input, requestContext: rc })
        : await (async () => {
            const agent = new Agent({
              id: 'pmo.generalAnswer',
              name: 'PMO General Answer',
              instructions: INSTRUCTIONS,
              model: ctx.model ?? deps.resolveModel(),
              ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
            });
            const r = await agent.generate(input.query, {
              requestContext: rc,
              abortSignal: ctx.abortSignal,
              ...(ctx.userMemory && ctx.threadId
                ? {
                    memory: {
                      thread: ctx.threadId,
                      resource: `${ctx.tenantId}:${ctx.actorUserId}`,
                      options: { readOnly: true, workingMemory: { enabled: false } },
                    },
                  }
                : {}),
            });
            return { text: r.text };
          })();

      const answer = out.text?.trim() ?? '';
      return {
        result: { answer },
        trust: {
          reasoningTrace: [],
          evidenceCitations: [],
          confidenceScore: answer ? 0.6 : 0.2,
        },
      };
    },
  };
}
