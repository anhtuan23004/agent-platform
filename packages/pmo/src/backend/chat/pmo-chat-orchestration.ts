import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraModelOutput } from '@mastra/core/stream';
import type { AgentTool } from '@seta/agent-sdk';
import { RC_THREAD_ID, type SpecializedAgentRunCtx, type TrustEnvelope } from '@seta/agent-sdk';
import { pmoAnalyticsTools } from '../agent-tools/index.ts';

/** PMO Agent: Mastra analyst over published PMO utilization data. */

const INSTRUCTIONS = [
  'You are the PMO Agent — a project-management-office analyst for resource utilization.',
  'You answer questions about overbooked and idle members, logged-vs-planned effort',
  'mismatch, and utilization reports, grounded ONLY in the published PMO data.',
  '',
  'Tools:',
  '- pmo_computeMemberWeekFacts: (re)compute the member×week utilization read-model.',
  '  Call this FIRST when the user says data was just published/ingested, or when a',
  '  detect/report tool returns nothing and stale facts are plausible. Otherwise the',
  '  detect tools read the already-persisted facts directly.',
  '- pmo_detectOverbookIdle: members overbooked (busy > threshold) or idle (busy < threshold).',
  '  Accepts optional dateRange, memberId, ingestionSessionId selected from published source.',
  '  Busy rate = planned ÷ available hours (part-time, holiday, approved-absence aware).',
  '- pmo_detectMismatch: members whose logged hours diverge from plan (effort consumption',
  '  outside threshold). Holiday/full-leave/approved-OT/training weeks are excluded.',
  '  Accepts optional dateRange, memberId, ingestionSessionId selected from published source.',
  '- pmo_explainFormula: explain formulas, thresholds, exclusions, and rule versions.',
  '- pmo_generateReport: idle and overbook reports for an explicit date range',
  '  (YYYY-MM-DD from/to). Use only when the user names a date range on already-published data.',
  '  Pass selected ingestionSessionId when present.',
  '- pmo_recommendRebalance: deterministic rebalance candidates for overbooked members.',
  '  Use when the user asks who can take workload, suggest allocation transfer,',
  '  or rebalance work. Requires explicit date range (YYYY-MM-DD). Optional',
  '  sourceMemberId, weekId (calendar week such as W3), or opportunityId. Read-only:',
  '  no PDF and no report_run. weekId only narrows which overbook evidence week',
  '  triggered the suggestion; transfer actions still apply from the planning period.',
  '  Prefer this over pmo_generateReport for rebalance-only questions.',
  '  When chat context includes selected published ingestionSessionId, ALWAYS pass it.',
  '',
  'Rules:',
  '- Chat scope is analytics only over published PMO data. Do NOT ingest, upload, map,',
  '  approve, or publish workbooks in chat. If user asks for ingest/publish, tell them',
  '  to use /pmo.',
  '- NEVER invent numbers. Report only what the tools return (busyRate, effortConsumption,',
  '  ragColor, detail). When a finding has excludedWeeks, mention that those weeks were',
  '  neutralised so the user understands why an edge case was not flagged.',
  '- When <<<PMO_ANALYTICS_SCOPE>>> is present, pass ingestionSessionId to detect,',
  '  report, and rebalance tools; do not fall back to tenant-wide data.',
  '- If a tool returns no findings, say so plainly instead of guessing.',
  '- For staffing/assignment questions tell the user to switch to the Staffing Agent.',
  '- Refer to members by the identifiers the tools return.',
].join('\n');

export interface PmoChatRunCtx
  extends Pick<
    SpecializedAgentRunCtx,
    'tenantId' | 'actorUserId' | 'effectivePermissions' | 'threadId' | 'userMemory' | 'model'
  > {
  abortSignal?: AbortSignal;
  /** Published PMO ingestion session selected as analytics source. */
  ingestionSessionId?: string;
  reportingDateFrom?: string;
  reportingDateTo?: string;
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
  /** Static extra tools (e.g. tests). */
  extraTools?: AgentTool[];
  /** Per-turn resolver for tools needing the live Mastra instance (apps/server). */
  resolveExtraTools?: () => AgentTool[];
}

type DrainableStream = {
  toolCalls: Promise<Array<{ payload?: { toolName?: string; args?: unknown } }>>;
  toolResults: Promise<Array<{ payload?: { toolName?: string; result?: unknown } }>>;
  text: Promise<string | undefined>;
};

function buildAnalyticsScopeBlock(ctx: PmoChatRunCtx): string | null {
  if (!ctx.ingestionSessionId) return null;
  const lines = ['<<<PMO_ANALYTICS_SCOPE>>>', `ingestionSessionId: ${ctx.ingestionSessionId}`];
  if (ctx.reportingDateFrom && ctx.reportingDateTo) {
    lines.push(`reportingDateFrom: ${ctx.reportingDateFrom}`);
    lines.push(`reportingDateTo: ${ctx.reportingDateTo}`);
  }
  lines.push('<<<END_PMO_ANALYTICS_SCOPE>>>');
  return lines.join('\n');
}

function pmoChatTools(extraTools: AgentTool[] = []): Record<string, unknown> {
  const all = [...pmoAnalyticsTools, ...extraTools];
  return Object.fromEntries(all.map((tool) => [(tool as { id: string }).id, tool]));
}

export function buildPmoChatOrchestrationRuntime(
  deps: PmoChatOrchestrationDeps,
): PmoChatOrchestrationRuntime {
  const runStream: PmoChatOrchestrationRuntime['runStream'] = async (input, ctx) => {
    const rc = new RequestContext();
    rc.set('actor', { type: 'user', user_id: ctx.actorUserId });
    rc.set('tenant_id', ctx.tenantId);
    const effectivePermissions = new Set(ctx.effectivePermissions ?? []);
    effectivePermissions.add('pmo.data.read');
    rc.set('effective_permissions', effectivePermissions);
    if (ctx.threadId) rc.set(RC_THREAD_ID, ctx.threadId);
    if (ctx.ingestionSessionId) {
      rc.set('pmo.analytics.ingestion_session_id', ctx.ingestionSessionId);
    }

    const scopeBlock = buildAnalyticsScopeBlock(ctx);
    const agentInput = scopeBlock ? `${scopeBlock}\n\n${input.userText}` : input.userText;

    const agent = new Agent({
      id: 'pmo.chat',
      name: 'PMO Agent',
      instructions: INSTRUCTIONS,
      model: ctx.model ?? deps.resolveModel(),
      tools: pmoChatTools([
        ...(deps.extraTools ?? []),
        ...(deps.resolveExtraTools?.() ?? []),
      ]) as never,
      ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
      inputProcessors: [new TokenLimiterProcessor({ limit: 100_000 })],
    });

    const runOptions: Record<string, unknown> = {
      requestContext: rc,
      maxSteps: 8,
      abortSignal: ctx.abortSignal,
      providerOptions: { openai: { reasoningSummary: 'auto' } },
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
      agentInput,
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
