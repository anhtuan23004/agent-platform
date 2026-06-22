import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraModelOutput } from '@mastra/core/stream';
import { RC_THREAD_ID, type SpecializedAgentRunCtx, type TrustEnvelope } from '@seta/agent-sdk';
import { makePmoGeneralAnswerAgent } from './agents/general-answer.ts';
import { makePmoOrchestratorTools } from './orchestrator.tools.ts';
import { type MastraToolSignals, trustFromPmoMastraResult } from './trust.ts';

export interface PmoOrchestratorRunInput {
  userText: string;
  taskId: string | null;
}

export interface PmoOrchestratorRunCtx
  extends Pick<
    SpecializedAgentRunCtx,
    'tenantId' | 'actorUserId' | 'effectivePermissions' | 'threadId' | 'userMemory' | 'model'
  > {
  abortSignal?: AbortSignal;
  ingestionSessionId?: string;
  reportingDateFrom?: string;
  reportingDateTo?: string;
}

export interface PmoOrchestratorDeps {
  resolveModel: () => MastraModelConfig;
}

type DrainableStream = {
  toolCalls: Promise<Array<{ payload?: { toolName?: string; args?: unknown } }>>;
  toolResults: Promise<Array<{ payload?: { toolName?: string; result?: unknown } }>>;
  text: Promise<string | undefined>;
};

function instructionsText(): string {
  return [
    'You are the PMO Agent — utilization analytics over published PMO data only.',
    '',
    'PRIMARY TOOL — pmo_queryUtilization with an explicit intent:',
    '- count_members_by_busy_rate: "how many busy > X%" — pass busyRateGt (1.0 = 100%, 0.5 = 50%).',
    '  Use reporting dates from <<<PMO_ANALYTICS_SCOPE>>> when present; do not ask for dates again.',
    '- list_flagged_members: SOP overbook/idle/mismatch only (not arbitrary "chilling").',
    '- member_detail: follow-up "why" for a member — pass memberId; use last discussed member when user says "why" without a name.',
    '- report_summary: full idle+overbook report for a date range.',
    '- rebalance_candidates: who can take workload / transfer allocation.',
    '- explain_methodology: formulas and thresholds — paste tool `summary` verbatim.',
    '',
    'If pmo_queryUtilization returns needsClarification, present clarificationOptions and STOP.',
    'Never map slang (chilling, not busy) to thresholds without user picking an option.',
    '',
    'pmo_answerQuestion — roles, org chart, staffing, ingest/publish redirects, general chat.',
    'Do NOT use analytics tools for those.',
    '',
    'pmo_refreshUtilizationFacts — only after publish or when query tools return empty and stale facts are plausible.',
    '',
    'Rules:',
    '- NEVER invent numbers. Ground answers ONLY in tool output.',
    '- When <<<PMO_ANALYTICS_SCOPE>>> has ingestionSessionId, pass it to pmo_queryUtilization.',
    '- Ingest/upload/mapping/publish → tell user to use /pmo.',
    '- Staffing/assignment → tell user to use Staffing Agent.',
    '',
    'FINAL ANSWER — after tools complete, write one concise answer with exact counts and member IDs from tool results.',
    'For explain_methodology, paste the tool `summary` field verbatim — do not reformat.',
    'Formulas: plain text only (e.g. busyRate = plannedHours / availableHours). Never use LaTeX, \\frac, or math delimiters.',
  ].join('\n');
}

function buildAnalyticsScopeBlock(ctx: PmoOrchestratorRunCtx): string | null {
  if (!ctx.ingestionSessionId) return null;
  const lines = ['<<<PMO_ANALYTICS_SCOPE>>>', `ingestionSessionId: ${ctx.ingestionSessionId}`];
  if (ctx.reportingDateFrom && ctx.reportingDateTo) {
    lines.push(`reportingDateFrom: ${ctx.reportingDateFrom}`);
    lines.push(`reportingDateTo: ${ctx.reportingDateTo}`);
  }
  lines.push('<<<END_PMO_ANALYTICS_SCOPE>>>');
  return lines.join('\n');
}

export function buildPmoOrchestratorStreamRun(
  deps: PmoOrchestratorDeps,
  input: PmoOrchestratorRunInput,
  ctx: PmoOrchestratorRunCtx,
): Promise<{
  output: MastraModelOutput<unknown>;
  finalize: () => Promise<{ result: { message: string }; trust: TrustEnvelope }>;
}> {
  return (async () => {
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
    if (ctx.reportingDateFrom) {
      rc.set('pmo.analytics.reporting_date_from', ctx.reportingDateFrom);
    }
    if (ctx.reportingDateTo) {
      rc.set('pmo.analytics.reporting_date_to', ctx.reportingDateTo);
    }

    const generalAnswer = makePmoGeneralAnswerAgent({ resolveModel: deps.resolveModel });
    const tools = makePmoOrchestratorTools({
      generalAnswer,
      userText: input.userText,
      ctx,
    });

    const scopeBlock = buildAnalyticsScopeBlock(ctx);
    const message = scopeBlock ? `${scopeBlock}\n\n${input.userText}` : input.userText;

    const agent = new Agent({
      id: 'pmo.orchestrator',
      name: 'PMO Agent',
      instructions: instructionsText(),
      model: ctx.model ?? deps.resolveModel(),
      tools: tools as never,
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
      message,
      runOptions,
    )) as unknown as MastraModelOutput<unknown>;

    const finalize = async () => {
      const stream = output as unknown as DrainableStream;
      const [toolCalls, , text] = await Promise.all([
        stream.toolCalls.catch(() => []),
        stream.toolResults.catch(() => []),
        stream.text.catch(() => undefined),
      ]);
      const signals: MastraToolSignals = {
        toolCalls: (toolCalls ?? []).map((tc) => ({
          payload: {
            toolName: tc.payload?.toolName ?? 'pmo_tool',
            args: tc.payload?.args,
          },
        })),
        toolResults: [],
        text,
      };
      const trust = trustFromPmoMastraResult(signals);
      return {
        result: { message: text?.trim() ?? '' },
        trust,
      };
    };

    return { output, finalize };
  })();
}
