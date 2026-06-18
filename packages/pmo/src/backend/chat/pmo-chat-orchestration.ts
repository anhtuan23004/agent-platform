import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraModelOutput } from '@mastra/core/stream';
import { RC_THREAD_ID, type SpecializedAgentRunCtx, type TrustEnvelope } from '@seta/agent-sdk';
import { pmoAnalyticsTools } from '../agent-tools/index.ts';

/**
 * The PMO Agent: a read-only Mastra agent over the PMO utilization analytics
 * tools (member×week facts, overbook/idle + mismatch detection, reporting).
 *
 * Unlike the staffing orchestrator this has no sub-agents and never suspends
 * (every tool is read-only, executes without HITL), so a bare per-turn Agent is
 * enough — no Mastra storage wrapper, no native-suspend snapshot.
 */

const INSTRUCTIONS = [
  'You are the PMO Agent — a project-management-office analyst for resource utilization.',
  'You answer questions about overbooked and idle members, logged-vs-planned effort',
  'mismatch, and utilization reports, grounded ONLY in the published PMO data.',
  '',
  'Tools (all read-only):',
  '- pmo_computeMemberWeekFacts: (re)compute the member×week utilization read-model.',
  '  Call this FIRST when the user says data was just published/ingested, or when a',
  '  detect/report tool returns nothing and stale facts are plausible. Otherwise the',
  '  detect tools read the already-persisted facts directly.',
  '- pmo_detectOverbookIdle: members overbooked (busy > threshold) or idle (busy < threshold).',
  '  Busy rate = planned ÷ available hours (part-time, holiday, approved-absence aware).',
  '- pmo_detectMismatch: members whose logged hours diverge from plan (effort consumption',
  '  outside threshold). Holiday/full-leave/approved-OT/training weeks are excluded.',
  '- pmo_generateReport: idle and overbook reports for an explicit date range',
  '  (YYYY-MM-DD from/to). Use only when the user names a date range.',
  '',
  'Rules:',
  '- NEVER invent numbers. Report only what the tools return (busyRate, effortConsumption,',
  '  ragColor, detail). When a finding has excludedWeeks, mention that those weeks were',
  '  neutralised so the user understands why an edge case was not flagged.',
  '- If a tool returns no findings, say so plainly instead of guessing.',
  '- This agent is read-only: you cannot ingest data, edit allocations, or assign people.',
  '  For staffing/assignment questions tell the user to switch to the Staffing Agent.',
  '- Refer to members by the identifiers the tools return.',
].join('\n');

export interface PmoChatRunCtx
  extends Pick<
    SpecializedAgentRunCtx,
    'tenantId' | 'actorUserId' | 'effectivePermissions' | 'threadId' | 'userMemory' | 'model'
  > {
  abortSignal?: AbortSignal;
}

/** Mirrors `@seta/shared-orchestration`'s ChatStreamRun without importing it. */
export interface PmoChatStreamRun {
  output: MastraModelOutput<unknown>;
  finalize: () => Promise<{ result: unknown; trust: TrustEnvelope }>;
}

export interface PmoChatOrchestrationRuntime {
  runStream: (
    input: { userText: string; taskId: string | null },
    ctx: PmoChatRunCtx,
  ) => Promise<PmoChatStreamRun>;
}

export interface PmoChatOrchestrationDeps {
  /** Resolves the model for a turn when the user did not pick one explicitly. */
  resolveModel: () => MastraModelConfig;
}

type DrainableStream = {
  toolCalls: Promise<Array<{ payload?: { toolName?: string; args?: unknown } }>>;
  toolResults: Promise<Array<{ payload?: { toolName?: string; result?: unknown } }>>;
  text: Promise<string | undefined>;
};

function pmoChatTools(): Record<string, unknown> {
  return Object.fromEntries(pmoAnalyticsTools.map((tool) => [(tool as { id: string }).id, tool]));
}

export function buildPmoChatOrchestrationRuntime(
  deps: PmoChatOrchestrationDeps,
): PmoChatOrchestrationRuntime {
  const runStream: PmoChatOrchestrationRuntime['runStream'] = async (input, ctx) => {
    const rc = new RequestContext();
    rc.set('actor', { type: 'user', user_id: ctx.actorUserId });
    rc.set('tenant_id', ctx.tenantId);
    // POC: PMO Agent permission is disabled — grant the read scope its tools
    // require so the agent works for any authenticated user regardless of role.
    // Remove this augmentation (pass ctx.effectivePermissions as-is) to re-enable.
    const effectivePermissions = new Set(ctx.effectivePermissions ?? []);
    effectivePermissions.add('pmo.data.read');
    rc.set('effective_permissions', effectivePermissions);
    if (ctx.threadId) rc.set(RC_THREAD_ID, ctx.threadId);

    const agent = new Agent({
      id: 'pmo.chat',
      name: 'PMO Agent',
      instructions: INSTRUCTIONS,
      model: ctx.model ?? deps.resolveModel(),
      tools: pmoChatTools() as never,
      ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
      inputProcessors: [new TokenLimiterProcessor({ limit: 100_000 })],
    });

    const runOptions: Record<string, unknown> = {
      requestContext: rc,
      maxSteps: 8,
      abortSignal: ctx.abortSignal,
      providerOptions: { openai: { reasoningSummary: 'auto' } },
      // readOnly: the chat route owns persistence (userMemory.saveMessages); we
      // only want history replay (lastMessages + semanticRecall) here.
      ...(ctx.userMemory && ctx.threadId
        ? {
            memory: {
              thread: ctx.threadId,
              resource: `${ctx.tenantId}:${ctx.actorUserId}`,
              options: { readOnly: true, workingMemory: { enabled: false } },
            },
          }
        : {}),
    };

    const output = (await agent.stream(
      input.userText,
      runOptions,
    )) as unknown as MastraModelOutput<unknown>;

    const finalize = async () => {
      const stream = output as unknown as DrainableStream;
      const [toolCalls, , text] = await Promise.all([
        stream.toolCalls.catch(() => []),
        stream.toolResults.catch(() => []),
        stream.text.catch(() => undefined),
      ]);
      const at = new Date().toISOString();
      const message = text?.trim() ?? '';
      const trust: TrustEnvelope = {
        reasoningTrace: (toolCalls ?? []).map((tc) => ({
          step: tc.payload?.toolName ?? 'pmo_tool',
          detail: `args=${JSON.stringify(tc.payload?.args ?? {})}`,
          at,
        })),
        evidenceCitations: [],
        confidenceScore: message ? 0.7 : 0.2,
      };
      return { result: { message }, trust };
    };

    return { output, finalize };
  };

  return { runStream };
}
