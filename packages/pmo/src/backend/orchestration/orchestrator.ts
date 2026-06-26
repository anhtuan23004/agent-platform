import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { ConsoleLogger, type LogLevel } from '@mastra/core/logger';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import type { MastraModelOutput } from '@mastra/core/stream';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { RC_THREAD_ID, type SpecializedAgentRunCtx } from '@seta/agent-sdk';
import type { ChatStreamRun } from '@seta/shared-orchestration';
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
  /**
   * Store the per-turn Mastra wraps the orchestrator agent in so its
   * native-suspend snapshot persists. Injected from the composition root;
   * shared with the engine Mastra for cross-instance resume.
   */
  mastraStorage: MastraCompositeStore;
}

/** The decision the approval card resolves to, forwarded verbatim into
 *  resumeStream. Structurally compatible with the staffing ResumeDecision. */
export type PmoResumeDecision = {
  decision: 'approve' | 'reject' | 'modify' | 'clarify';
  overrideUserIds?: string[];
  alternateIndices?: number[];
  payloadPatch?: Record<string, unknown>;
  note?: string;
  clarificationMessage?: string;
};

/** A run ctx PLUS the resume coordinates. */
export type PmoResumeCtx = Pick<
  SpecializedAgentRunCtx,
  'tenantId' | 'actorUserId' | 'effectivePermissions' | 'threadId' | 'userMemory' | 'model'
> & {
  mastraRunId: string;
  toolCallId?: string;
  abortSignal?: AbortSignal;
};

type DrainableStream = {
  toolCalls: Promise<Array<{ payload?: { toolName?: string; args?: unknown } }>>;
  toolResults: Promise<Array<{ payload?: { toolName?: string; result?: unknown } }>>;
  text: Promise<string | undefined>;
};

interface BuiltPmoOrchestrator {
  agent: Agent;
  mastra: Mastra;
  rc: RequestContext;
  message: string;
  runOptions: Record<string, unknown>;
}

function agenticInstructionsText(): string {
  return [
    'You are the PMO Agent. You help users manage project data ingestion, analysis, and reporting.',
    '',
    '## Your capabilities',
    'You have tools for data ingestion and analytics:',
    '',
    'INGESTION TOOLS (use when the user has uploaded a workbook and wants to ingest/publish):',
    '- pmo_profileWorkbook: Profile uploaded workbook documents, detect sheets/areas',
    '- pmo_proposeColumnMappings: Propose source→target column mappings for review',
    '- pmo_normalizeToStaging: Normalize raw data to staging tables, detect issues',
    '- pmo_compareChanges: Compare staging vs published data, produce change summary',
    '- pmo_publishChanges: Publish approved staging changes to canonical tables',
    '- pmo_generateReportIngest: Generate utilization/analytics reports',
    '',
    'ANALYTICS TOOLS (use for queries about published data):',
    '- pmo_queryUtilization: Primary analytics query (busy rates, flagged members, reports, methodology)',
    '- pmo_refreshUtilizationFacts: Recompute utilization read-model after publish',
    '- pmo_answerQuestion: Answer general/non-analytics questions',
    '',
    'MEMORY TOOLS:',
    '- pmo_loadContext: Load your persisted task state and recent session history at the start of each turn',
    '- pmo_updateTaskState: Save your goal, tasks, decisions, blockers, and individual task status updates',
    '',
    '## Your behavior',
    '',
    '1. AT THE START OF EVERY TURN, call pmo_loadContext to restore your state.',
    '',
    '2. When the user gives you a goal involving ingestion:',
    '   a. Decompose it into tasks (profile → map → normalize → compare → publish → report).',
    '   b. Call pmo_updateTaskState to persist your plan.',
    '   c. Execute ONE task at a time by calling the appropriate ingestion tool.',
    '   d. Pass an agentNote explaining your reasoning — this is shown to the user',
    '      on the review card. Example: "I profiled 5 sheets. Sheet DS02 has low',
    '      confidence (0.38) — please verify its mapping carefully."',
    '',
    '3. Every ingestion tool will SUSPEND for user review. After the user reviews and approves:',
    "   a. You will receive the user's feedback (approve/modify/reject).",
    '   b. OBSERVE the feedback carefully.',
    '   c. Update your task state via pmo_updateTaskState.',
    '   d. Decide the NEXT action based on the feedback.',
    '',
    '4. If the user modifies or rejects something:',
    '   - Modified: adjust your plan and continue with the modified data.',
    '   - Rejected: DO NOT retry automatically — ask the user what they want to do next.',
    '',
    '5. If you encounter unexpected situations (high duplicates, blocking issues, low confidence):',
    '   - STOP and discuss with the user before proceeding.',
    '   - Describe the issue clearly and propose options.',
    '',
    '6. Before calling a tool, check if the goal is CLEAR ENOUGH to proceed.',
    '   - If the tool has a rich review card with form controls (date pickers,',
    '     column selectors, checkboxes), CALL THE TOOL — the user will interact',
    '     with the structured UI on the PMO page. Do NOT ask for structured',
    '     inputs in chat when the card already provides proper form controls.',
    '   - If the goal is genuinely AMBIGUOUS and no card UI can resolve it,',
    '     ASK in chat first. Examples:',
    '     "Bạn muốn publish luôn hay chỉ review thay đổi trước?"',
    '     "Tôi thấy 2 files được upload. Bạn muốn ingest cả 2 hay chỉ file mới nhất?"',
    '   - If the user provides explicit values (date range, sheet names), pass',
    '     them directly to the tool so the card pre-fills with those values.',
    '',
    '7. For analytics queries (utilization, overbook/idle, reports on published data):',
    '   - Use pmo_queryUtilization with the appropriate intent.',
    '   - Follow the same rules as before for analytics.',
    '',
    '8. When a tool returns status "clarification_needed":',
    '   - The user sent a message on the review card asking for clarification.',
    "   - Read their message from the result's clarificationMessage field.",
    '   - Process their input and call the SAME tool again with:',
    '     a. Updated parameters based on their input.',
    '     b. A new agentNote responding to their message.',
    '     c. The full clarifications array (previous messages from',
    '        result.previousClarifications + their message + your response).',
    '   - The tool will create a new card with the updated conversation history.',
    '   - Example: user asks "use that date range" → you respond with',
    '     agentNote: "OK, using range 2025-01-06 to 2025-03-28" and pass the',
    '     confirmed dateRange in tool params.',
    '',
    '## Edge-case handling',
    '',
    '### High duplicate detection after normalization',
    'After calling pmo_normalizeToStaging, check the result for duplicate counts.',
    'If duplicates exceed 10% of total rows, STOP and tell the user:',
    '"Normalization found [N] duplicates out of [T] total rows ([P]%). This may indicate',
    'overlapping data or a re-upload. Would you like to proceed to compare, re-upload',
    'a corrected file, or skip these duplicates?"',
    'Do NOT proceed to pmo_compareChanges until the user responds.',
    '',
    '### Low mapping confidence',
    'After profiling, if a sheet has low confidence (< 0.5), tell the user:',
    '"Sheet [name] was profiled with low confidence ([score]). The column mappings may',
    'be unreliable. Would you like to proceed with mapping anyway, provide manual hints,',
    'or skip this sheet?"',
    'Do NOT call pmo_proposeColumnMappings for that sheet until the user decides.',
    '',
    '### Sheet rejection by user',
    'If the user rejects a sheet during profiling review, remove it from your plan.',
    'Update your task state to mark the rejected sheet tasks as "skipped".',
    'Continue with remaining sheets. If ALL sheets are rejected, ask the user',
    'whether they want to upload a different file or stop.',
    '',
    '### Publish blocked by issues',
    'If pmo_compareChanges or pre-publish checks reveal blocking issues (validation',
    'errors, constraint violations, missing required fields):',
    '1. Enumerate each blocker clearly with its affected rows/columns.',
    '2. Propose specific resolution options for each (fix data, skip affected rows,',
    '   re-normalize with different settings).',
    '3. Record blockers via pmo_updateTaskState.',
    '4. Do NOT attempt pmo_publishChanges until all blockers are resolved.',
    '',
    '### Missing member references during normalization',
    'If normalization reports unresolved member references (names that do not match',
    'known tenant members), list them and ask:',
    '"[N] member names could not be matched: [list]. Would you like to create these',
    'as new members, provide alternate names for matching, or skip rows referencing them?"',
    '',
    '## Multi-goal decomposition',
    '',
    'For compound goals like "ingest this file and then generate a report":',
    '1. Create two task groups using dotted taskId prefixes:',
    '   - Ingest group: ingest.1.profile, ingest.2.map, ingest.3.normalize, ingest.4.compare, ingest.5.publish',
    '   - Report group: report.1.generate',
    '2. Complete or resolve the first group entirely before starting the second group.',
    '3. If the first group fails or is rejected by the user, ask whether to proceed with',
    '   the second group or stop entirely. Do NOT assume.',
    '4. Update individual task statuses via pmo_updateTaskState taskStatusUpdate as you go.',
    '',
    '## Cross-session awareness',
    '',
    'pmo_loadContext returns recentSessions — the last few ingestion sessions for this tenant.',
    'Use this to provide context:',
    '- If recentSessions exist, mention relevant history: "Your last ingestion was [N] days ago',
    '  (session [status])."',
    '- If the current workbook appears to contain data similar to a recent session (same file name,',
    '  overlapping date range), mention this: "This looks like it may update data from your previous',
    '  session. The compare step will show what changed."',
    '- Do NOT block on this — it is informational context, not a gate.',
    '',
    '## Rules',
    '- NEVER publish data without explicit user approval.',
    '- NEVER skip a review step — every tool output must be reviewed by the user.',
    '- NEVER invent numbers. Ground answers ONLY in tool output.',
    '- NEVER retry a rejected step automatically — always ask the user what to do.',
    '- Analytics formulas are computed by tools, not by you.',
    '- Tenant scope comes from your session context, never from the user prompt.',
    '- When <<<PMO_SESSION_SCOPE>>> is present, use its variables (ingestionSessionId, dates) as defaults for any tool calls that require them.',
    '- For explain_methodology, paste the tool summary field verbatim.',
    '- Formulas: plain text only. Never use LaTeX.',
  ].join('\n');
}

function buildAnalyticsScopeBlock(ctx: PmoOrchestratorRunCtx): string | null {
  if (!ctx.ingestionSessionId) return null;
  const lines = ['<<<PMO_SESSION_SCOPE>>>', `ingestionSessionId: ${ctx.ingestionSessionId}`];
  if (ctx.reportingDateFrom && ctx.reportingDateTo) {
    lines.push(`reportingDateFrom: ${ctx.reportingDateFrom}`);
    lines.push(`reportingDateTo: ${ctx.reportingDateTo}`);
  }
  lines.push('<<<END_PMO_SESSION_SCOPE>>>');
  return lines.join('\n');
}

async function buildPmoOrchestrator(
  deps: PmoOrchestratorDeps,
  input: PmoOrchestratorRunInput,
  ctx: PmoOrchestratorRunCtx,
): Promise<BuiltPmoOrchestrator> {
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

  const instructions = agenticInstructionsText();

  const agent = new Agent({
    id: 'pmo.orchestrator',
    name: 'PMO Agent',
    instructions,
    model: ctx.model ?? deps.resolveModel(),
    tools: tools as never,
    ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
    inputProcessors: [new TokenLimiterProcessor({ limit: 100_000 })],
  });

  // Wrap the per-turn agent in a storage-backed Mastra so .stream() persists
  // its native-suspend snapshot — a later resumeStream reloads it from the
  // SAME store. Mirrors the staffing orchestrator pattern.
  const mastra = new Mastra({
    agents: { 'pmo.orchestrator': agent },
    storage: deps.mastraStorage,
    logger: new ConsoleLogger({
      name: 'Mastra',
      level: (process.env.MASTRA_LOG_LEVEL as LogLevel) ?? 'warn',
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'seta-pmo-orchestrator',
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  });
  const boundAgent = mastra.getAgent('pmo.orchestrator');

  const runOptions: Record<string, unknown> = {
    requestContext: rc,
    maxSteps: 16,
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

  return { agent: boundAgent, mastra, rc, message, runOptions };
}

function finalizePmoStream(output: MastraModelOutput<unknown>) {
  return async () => {
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
}

/** Streaming chat entrypoint. Returns the live Mastra output plus a finalize()
 *  that assembles the structured result + trust once the run completes. */
export function makePmoChatOrchestrationStreamer(deps: PmoOrchestratorDeps) {
  return async function startChat(
    input: PmoOrchestratorRunInput,
    ctx: PmoOrchestratorRunCtx,
  ): Promise<ChatStreamRun> {
    const built = await buildPmoOrchestrator(deps, input, ctx);
    const output = (await built.agent.stream(
      built.message,
      built.runOptions,
    )) as unknown as MastraModelOutput<unknown>;
    return { output, finalize: finalizePmoStream(output) };
  };
}

/** Resume chat entrypoint. Rebuilds the orchestrator on the shared
 *  storage-backed Mastra so the persisted native-suspend snapshot reloads by
 *  runId, calls Agent.resumeStream with the approval decision, and returns the
 *  same ChatStreamRun shape as the forward path. */
export function makePmoChatOrchestrationResumer(deps: PmoOrchestratorDeps) {
  return async function resumeChat(
    resume: PmoResumeDecision,
    ctx: PmoResumeCtx,
  ): Promise<ChatStreamRun> {
    const orchCtx: PmoOrchestratorRunCtx = {
      tenantId: ctx.tenantId,
      actorUserId: ctx.actorUserId,
      effectivePermissions: ctx.effectivePermissions,
      threadId: ctx.threadId,
      userMemory: ctx.userMemory,
      model: ctx.model,
      abortSignal: ctx.abortSignal,
    };
    const built = await buildPmoOrchestrator(deps, { userText: '', taskId: null }, orchCtx);
    const output = (await (
      built.agent as unknown as {
        resumeStream: (
          resumeData: PmoResumeDecision,
          opts: { runId: string; toolCallId?: string; requestContext: RequestContext },
        ) => Promise<unknown>;
      }
    ).resumeStream(resume, {
      runId: ctx.mastraRunId,
      ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
      requestContext: built.rc,
    })) as MastraModelOutput<unknown>;
    return { output, finalize: finalizePmoStream(output) };
  };
}

/** @deprecated Use makePmoChatOrchestrationStreamer instead. Kept for backward
 *  compatibility with pmo-chat-orchestration.ts during migration. */
export function buildPmoOrchestratorStreamRun(
  deps: PmoOrchestratorDeps,
  input: PmoOrchestratorRunInput,
  ctx: PmoOrchestratorRunCtx,
): Promise<ChatStreamRun> {
  return makePmoChatOrchestrationStreamer(deps)(input, ctx);
}
