/**
 * Bridge between agentic ingestion tools and the existing workflow step
 * handlers. Each tool calls `runIngestionHandler` with the correct
 * `actionId`; this module loads the session, builds deps, resolves the
 * handler, and processes the result — reusing the same state-management
 * logic the workflow orchestrator uses.
 */
import type { AgentRequestContext, AgentToolContext } from '@seta/agent-sdk';
import { z } from 'zod';
import { type PmoPlanActionId, reviewTypeForPmoAction } from '../../planning/step-metadata.ts';
import {
  type DynamicRuntimeSessionPatch,
  loadDynamicRuntimeSession,
  updateDynamicRuntimeSession,
} from '../../workflows/ingest-data-v2/context.ts';
import {
  applyMappingOverrides,
  attachRuntimeContextToState,
  buildArtifactAccessors,
  buildStatePatch,
  buildStepRegistry,
  createIngestArtifactsCache,
  deriveReportSource,
  markStepCompleted,
  markStepRejected,
  markStepsForSuspend,
  normalizeRuntimeContextFromSessionRow,
  PMO_DOMAIN_CONFIG,
  PMO_INGESTION_ADAPTER,
  REQUIRED_FIELDS_BY_TABLE,
  readExecutionStateV2,
  readPlannerStepMeta,
  resolveCardIdentity,
  runtimeContextToSessionPatch,
  statusForAction,
} from '../../workflows/ingest-data-v2/orchestrator-internals.ts';

// ── Resume schema (shared by all ingestion tools) ───────────────────────────

export const IngestionResumeSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify', 'clarify']),
  // Mapping-specific
  approvedItemKey: z.string().optional(),
  approvedItemKeys: z.array(z.string()).optional(),
  mappingOverride: z.unknown().optional(),
  mappingOverrides: z.array(z.unknown()).optional(),
  proceedToNextStep: z.boolean().optional(),
  // Normalization-specific
  rowDecisions: z
    .array(
      z.object({
        rowId: z.string(),
        decision: z.enum(['keep_row', 'skip_row']),
      }),
    )
    .optional(),
  rowOverrides: z
    .array(
      z.object({
        rowId: z.string(),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  memberMasterAdditions: z.array(z.unknown()).optional(),
  // Report-specific
  workloadDateRange: z.object({ from: z.string(), to: z.string() }).optional(),
  forwardAllocationDateRange: z.object({ from: z.string(), to: z.string() }).optional(),
  dateRangeStrategy: z.string().optional(),
  // Generic
  note: z.string().optional(),
  plannerStepId: z.string().optional(),
  payloadPatch: z.record(z.string(), z.unknown()).optional(),
});

export type IngestionResumeData = z.infer<typeof IngestionResumeSchema>;

// ── Output types ────────────────────────────────────────────────────────────

export interface HandlerToolResult {
  status: 'completed' | 'rejected' | 'skipped' | 'clarification_needed';
  actionId: string;
  sessionId: string;
  summary: string;
  clarificationMessage?: string;
  previousClarifications?: Array<{ role: string; message: string; ts: string }>;
  outputSummary?: Record<string, unknown>;
  terminalOutput?: {
    rowsWritten?: Record<string, number>;
    rowsUpdated?: Record<string, number>;
    rowsSkipped?: Record<string, number>;
    reportRunIds?: string[];
  };
}

export const HandlerToolResultSchema = z.object({
  status: z.enum(['completed', 'rejected', 'skipped', 'clarification_needed']),
  actionId: z.string(),
  sessionId: z.string(),
  summary: z.string(),
  clarificationMessage: z.string().optional(),
  previousClarifications: z
    .array(z.object({ role: z.string(), message: z.string(), ts: z.string() }))
    .optional(),
  outputSummary: z.record(z.string(), z.unknown()).optional(),
  terminalOutput: z
    .object({
      rowsWritten: z.record(z.string(), z.number()).optional(),
      rowsUpdated: z.record(z.string(), z.number()).optional(),
      rowsSkipped: z.record(z.string(), z.number()).optional(),
      reportRunIds: z.array(z.string()).optional(),
    })
    .optional(),
});

// ── Suspend payload schema ──────────────────────────────────────────────────

export const IngestionSuspendSchema = z.object({ card: z.unknown() });

// ── Suspend/resume context type alias ────────────────────────────────────────

export type IngestionToolContext = AgentToolContext<
  z.infer<typeof IngestionSuspendSchema>,
  z.infer<typeof IngestionResumeSchema>
>;

// ── Identity extraction ─────────────────────────────────────────────────────

export function extractIdentity(ctx: IngestionToolContext): {
  tenantId: string;
  userId: string;
} {
  const rc = ctx.requestContext;
  const tenantId = (rc?.get?.('tenant_id') as string | undefined) ?? '';
  const actor = rc?.get?.('actor') as { user_id?: string } | undefined;
  return { tenantId, userId: actor?.user_id ?? '' };
}

// ── Main adapter function ───────────────────────────────────────────────────

export async function runIngestionHandler(opts: {
  actionId: PmoPlanActionId;
  sessionId: string;
  tenantId: string;
  userId: string;
  agentCtx: IngestionToolContext;
  agentNote?: string;
  clarifications?: Array<{ role: 'agent' | 'user'; message: string; ts: string }>;
}): Promise<HandlerToolResult> {
  const { actionId, sessionId, tenantId, userId, agentCtx } = opts;

  // ── Clarification: return the message to the agent without calling the handler ──
  const resumeData = agentCtx.agent?.resumeData as Record<string, unknown> | undefined;
  if (resumeData?.decision === 'clarify') {
    return {
      status: 'clarification_needed' as const,
      actionId,
      sessionId,
      summary: `User clarification: ${resumeData.clarificationMessage ?? resumeData.note ?? ''}`,
      clarificationMessage: (resumeData.clarificationMessage ?? resumeData.note ?? '') as string,
      previousClarifications: (resumeData.previousClarifications ?? []) as Array<{
        role: string;
        message: string;
        ts: string;
      }>,
    };
  }

  // ── 1. Load session ──
  const row = await loadDynamicRuntimeSession({
    ingestionSessionId: sessionId,
    tenantId,
  });
  if (!row) {
    throw new Error(`ingestion_session_not_found:${sessionId}`);
  }

  // ── 2. Build execution state ──
  const state = readExecutionStateV2(row.workflow_execution_state, row.planning_plan);

  // ── 3. Build runtime context ──
  const runtimeContext = normalizeRuntimeContextFromSessionRow({
    detectedSchema: row.detected_schema,
    confirmedMapping: row.confirmed_mapping,
    changeSummary: row.change_summary,
    workflowExecutionState: row.workflow_execution_state,
  });
  runtimeContext.domainId = runtimeContext.domainId ?? PMO_DOMAIN_CONFIG.domainId;
  runtimeContext.domainConfigVersion =
    runtimeContext.domainConfigVersion ?? PMO_DOMAIN_CONFIG.version;

  // ── 4. Build artifacts cache ──
  const artifactsCache = createIngestArtifactsCache();
  const { getWorkbookParseResult, getSchemaDetectionResult } =
    buildArtifactAccessors(artifactsCache);

  // ── 5. Build handler deps & resolve handler ──
  // Build a requestContext bridge for handlers that expect { get(key: string) }.
  // The underlying RequestContext<AgentRequestContext> restricts keys to
  // keyof AgentRequestContext, but handler deps declare { get(key: string) },
  // so we cast at the boundary.
  const requestContext: { get: (key: string) => unknown } = {
    get(key: string): unknown {
      return agentCtx.requestContext?.get?.(key as keyof AgentRequestContext);
    },
  };

  const stepRegistry = buildStepRegistry({
    domainConfig: PMO_DOMAIN_CONFIG,
    domainAdapter: PMO_INGESTION_ADAPTER,
    resolveCardIdentity,
    readPlannerStepMeta,
    applyMappingOverrides,
    requiredFieldsByTable: REQUIRED_FIELDS_BY_TABLE,
    getWorkbookParseResult,
    getSchemaDetectionResult,
  });

  const handler = stepRegistry.resolve(actionId);
  if (!handler) {
    throw new Error(`handler_not_found:${actionId}`);
  }

  // ── 6. Find active step matching actionId, or create one dynamically ──
  let activeStep =
    state.steps.find(
      (step) =>
        step.action_id === actionId &&
        (step.status === 'in_progress' ||
          step.status === 'needs_review' ||
          step.status === 'pending'),
    ) ?? state.steps.find((step) => step.action_id === actionId);

  if (!activeStep) {
    // The agent called a tool whose step doesn't exist yet. Add it
    // dynamically so the execution state tracks what the agent actually does
    // instead of relying on a hardcoded step list.
    const nextStepNo = Math.max(0, ...state.steps.map((s) => s.step_no)) + 1;
    const stepName = actionId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    activeStep = {
      step_no: nextStepNo,
      planner_step_id: `pmo.planner.step.${nextStepNo}.${actionId}`,
      action_id: actionId,
      review_type: reviewTypeForPmoAction(actionId),
      step_name: stepName,
      status: 'in_progress',
      review_status: 'pending',
    };
    state.steps.push(activeStep);
    state.current_step_no = nextStepNo;
    state.current_planner_step_id = activeStep.planner_step_id;
    state.current_step_status = 'in_progress';
  }

  // ── 7. Build handler input ──
  // resumeData already extracted above (used for the clarification early-return)

  const handlerInput = {
    ingestionSessionId: sessionId,
    fileKey: row.source_file_key ?? undefined,
    tenantId,
    userId,
    runId: `agent-tool-${actionId}-${Date.now()}`,
    planningGoal: row.planning_goal,
    reportingPeriodStart: row.reporting_period_start,
    reportingPeriodEnd: row.reporting_period_end,
    requestContext,
    resumeData,
    step: activeStep,
    planningPlan: row.planning_plan,
    reportSource: deriveReportSource(row.planning_plan),
    runtimeContext,
  };

  // ── 8. Execute handler ──
  const result = await handler.execute(handlerInput);

  // ── 9. Process result ──
  const runtimePatchForResult =
    result.kind === 'completed' || result.kind === 'suspend'
      ? result.runtimeContextPatch
      : undefined;

  const mergedRuntimeContext = {
    ...runtimeContext,
    ...(runtimePatchForResult ?? {}),
  };

  if (result.kind === 'suspend') {
    // Persist state and suspend the agent tool
    let suspendState = markStepsForSuspend(state, activeStep);
    suspendState = attachRuntimeContextToState(suspendState, mergedRuntimeContext);
    await updateDynamicRuntimeSession({
      ingestionSessionId: sessionId,
      tenantId,
      patch: buildStatePatch({
        state: suspendState,
        status: result.sessionStatus,
        extraPatch: {
          ...runtimeContextToSessionPatch(result.runtimeContextPatch),
        },
      }),
    });

    // Mastra throws at suspend() — code below is unreachable
    if (typeof agentCtx.agent?.suspend !== 'function') {
      throw new Error(`agent_suspend_unavailable:${actionId}`);
    }
    const card = {
      ...result.card,
      ...(opts.agentNote ? { agentNote: opts.agentNote } : {}),
      ...(opts.clarifications?.length ? { clarifications: opts.clarifications } : {}),
    };
    await agentCtx.agent.suspend({ card });

    // Unreachable after suspend
    return {
      status: 'completed',
      actionId,
      sessionId,
      summary: 'unreachable',
    };
  }

  if (result.kind === 'rejected') {
    let rejectedState = markStepRejected(state, activeStep);
    rejectedState = attachRuntimeContextToState(rejectedState, mergedRuntimeContext);
    await updateDynamicRuntimeSession({
      ingestionSessionId: sessionId,
      tenantId,
      patch: buildStatePatch({
        state: rejectedState,
        status: result.sessionStatus,
        extraPatch: {
          ...runtimeContextToSessionPatch(runtimePatchForResult),
          ...(result.sessionPatch as DynamicRuntimeSessionPatch | undefined),
        },
      }),
    });

    return {
      status: 'rejected',
      actionId,
      sessionId,
      summary: `Step '${activeStep.step_name}' was rejected.`,
      outputSummary: result.outputSummary,
      terminalOutput: result.terminalOutput
        ? {
            rowsWritten: result.terminalOutput.rowsWritten,
            rowsUpdated: result.terminalOutput.rowsUpdated,
            rowsSkipped: result.terminalOutput.rowsSkipped,
            reportRunIds: result.terminalOutput.reportRunIds,
          }
        : undefined,
    };
  }

  // kind === 'completed'
  const advanced = markStepCompleted(state, activeStep, result.outputSummary);
  const completedState = attachRuntimeContextToState(advanced.state, mergedRuntimeContext);

  const nextStatus = advanced.nextStep
    ? statusForAction(advanced.nextStep.action_id)
    : (result.sessionStatus ?? 'published');

  await updateDynamicRuntimeSession({
    ingestionSessionId: sessionId,
    tenantId,
    patch: buildStatePatch({
      state: completedState,
      status: nextStatus,
      extraPatch: {
        ...runtimeContextToSessionPatch(result.runtimeContextPatch),
        ...(result.sessionPatch as DynamicRuntimeSessionPatch | undefined),
      },
    }),
  });

  return {
    status: 'completed',
    actionId,
    sessionId,
    summary: `Step '${activeStep.step_name}' completed successfully.${advanced.nextStep ? ` Next: '${advanced.nextStep.step_name}'.` : ' All steps finished.'}`,
    outputSummary: result.outputSummary,
    terminalOutput: result.terminalOutput
      ? {
          rowsWritten: result.terminalOutput.rowsWritten,
          rowsUpdated: result.terminalOutput.rowsUpdated,
          rowsSkipped: result.terminalOutput.rowsSkipped,
          reportRunIds: result.terminalOutput.reportRunIds,
        }
      : undefined,
  };
}
