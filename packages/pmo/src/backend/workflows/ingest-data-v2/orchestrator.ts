import type { ApprovalCard } from '@seta/agent-sdk';
import type { DynamicRuntimeSessionPatch } from './context.ts';
import { loadDynamicRuntimeSession, updateDynamicRuntimeSession } from './context.ts';
import {
  applyMappingOverrides,
  attachRuntimeContextToState,
  attachStepViewToState,
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
} from './orchestrator-internals.ts';
import type { DynamicPlannerResume, IngestDataV2Output } from './schemas.ts';

interface DynamicOrchestratorInput {
  ingestionSessionId: string;
  fileKey?: string;
  tenantId: string;
  userId: string;
  runId: string;
  requestContext: { get: (key: string) => unknown };
  resumeData: DynamicPlannerResume | undefined;
}

type DynamicOrchestratorResult =
  | {
      kind: 'suspend';
      card: ApprovalCard;
    }
  | {
      kind: 'completed';
      output: IngestDataV2Output;
    };

function asWorkflowOutputReport(report: unknown): IngestDataV2Output['report'] {
  return report as IngestDataV2Output['report'];
}

export async function runDynamicIngestOrchestrator(
  input: DynamicOrchestratorInput,
): Promise<DynamicOrchestratorResult> {
  const row = await loadDynamicRuntimeSession({
    ingestionSessionId: input.ingestionSessionId,
    tenantId: input.tenantId,
  });
  if (!row) throw new Error('ingestion_session_not_found');

  let state = readExecutionStateV2(row.workflow_execution_state, row.planning_plan);
  let runtimeContext = normalizeRuntimeContextFromSessionRow({
    detectedSchema: row.detected_schema,
    confirmedMapping: row.confirmed_mapping,
    changeSummary: row.change_summary,
    workflowExecutionState: row.workflow_execution_state,
  });

  // Attach domain identification for reproducibility and future multi-domain support
  runtimeContext.domainId = runtimeContext.domainId ?? PMO_DOMAIN_CONFIG.domainId;
  runtimeContext.domainConfigVersion =
    runtimeContext.domainConfigVersion ?? PMO_DOMAIN_CONFIG.version;

  const artifactsCache = createIngestArtifactsCache();
  const { getWorkbookParseResult, getSchemaDetectionResult } =
    buildArtifactAccessors(artifactsCache);

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

  let resumeData = input.resumeData;
  let lastTerminalOutput:
    | {
        status: 'published' | 'rejected' | 'completed';
        rowsWritten?: Record<string, number>;
        rowsUpdated?: Record<string, number>;
        rowsSkipped?: Record<string, number>;
        reportRunId?: string | null;
        reportRunIds?: string[];
        report?: unknown;
      }
    | undefined;

  for (let loop = 0; loop < 16; loop++) {
    const activeStep =
      state.steps.find((step) => step.planner_step_id === state.current_planner_step_id) ??
      state.steps.find((step) => step.step_no === state.current_step_no);

    if (!activeStep) {
      return {
        kind: 'completed',
        output: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'completed',
          rowsWritten: {},
          rowsUpdated: {},
          rowsSkipped: {},
        },
      };
    }

    const handler =
      stepRegistry.resolve(activeStep.action_id) ?? stepRegistry.resolve('generic_review');
    if (!handler) {
      throw new Error(`handler_not_found:${activeStep.action_id}`);
    }

    const decisionForStep =
      resumeData &&
      (typeof resumeData.plannerStepId !== 'string' ||
        resumeData.plannerStepId === activeStep.planner_step_id)
        ? resumeData
        : undefined;

    const result = await handler.execute({
      ingestionSessionId: input.ingestionSessionId,
      fileKey: row.source_file_key ?? undefined,
      tenantId: input.tenantId,
      userId: input.userId,
      runId: input.runId,
      planningGoal: row.planning_goal,
      fileName: row.source_file_name ?? undefined,
      fileSizeBytes: row.source_file_size_bytes,
      mimeType: row.mime_type,
      uploadedAt: row.created_at.toISOString(),
      reportingPeriodStart: row.reporting_period_start,
      reportingPeriodEnd: row.reporting_period_end,
      requestContext: input.requestContext,
      resumeData: decisionForStep as Record<string, unknown> | undefined,
      step: activeStep,
      planningPlan: row.planning_plan,
      reportSource: deriveReportSource(row.planning_plan),
      runtimeContext,
    });

    const runtimePatchForResult =
      result.kind === 'completed' || result.kind === 'suspend'
        ? result.runtimeContextPatch
        : undefined;

    runtimeContext = {
      ...runtimeContext,
      ...(runtimePatchForResult ?? {}),
    };

    if (result.kind === 'suspend') {
      state = markStepsForSuspend(state, activeStep);
      state = attachRuntimeContextToState(state, runtimeContext);
      state = attachStepViewToState({
        state,
        step: activeStep,
        runtimeContext,
        status: 'needs_review',
        approvalPayload: result.card,
        outputSummary: result.outputSummary,
        reviewStatus: 'pending',
      });
      await updateDynamicRuntimeSession({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        patch: buildStatePatch({
          state,
          status: result.sessionStatus,
          extraPatch: {
            ...runtimeContextToSessionPatch(result.runtimeContextPatch),
          },
        }),
      });

      return {
        kind: 'suspend',
        card: result.card,
      };
    }

    if (result.kind === 'rejected') {
      state = markStepRejected(state, activeStep);
      state = attachRuntimeContextToState(state, runtimeContext);
      state = attachStepViewToState({
        state,
        step: activeStep,
        runtimeContext,
        status: 'failed',
        outputSummary: result.outputSummary,
        reviewStatus: 'rejected',
      });
      await updateDynamicRuntimeSession({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        patch: buildStatePatch({
          state,
          status: result.sessionStatus,
          extraPatch: {
            ...runtimeContextToSessionPatch(runtimePatchForResult),
            ...(result.sessionPatch as DynamicRuntimeSessionPatch | undefined),
          },
        }),
      });

      return {
        kind: 'completed',
        output: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'rejected',
          rowsWritten: result.terminalOutput?.rowsWritten ?? {},
          rowsUpdated: result.terminalOutput?.rowsUpdated ?? {},
          rowsSkipped: result.terminalOutput?.rowsSkipped ?? {},
          reportRunId: result.terminalOutput?.reportRunId ?? null,
          reportRunIds: result.terminalOutput?.reportRunIds ?? [],
          report: asWorkflowOutputReport(result.terminalOutput?.report),
        },
      };
    }

    const advanced = markStepCompleted(state, activeStep, result.outputSummary);
    state = attachRuntimeContextToState(advanced.state, runtimeContext);
    state = attachStepViewToState({
      state,
      step: activeStep,
      runtimeContext,
      status: 'completed',
      outputSummary: result.outputSummary,
      reviewStatus: activeStep.review_type === 'none' ? 'not_needed' : 'approved',
    });

    const nextStatus = advanced.nextStep
      ? statusForAction(advanced.nextStep.action_id)
      : (result.sessionStatus ?? 'published');

    await updateDynamicRuntimeSession({
      ingestionSessionId: input.ingestionSessionId,
      tenantId: input.tenantId,
      patch: buildStatePatch({
        state,
        status: nextStatus,
        extraPatch: {
          ...runtimeContextToSessionPatch(result.runtimeContextPatch),
          ...(result.sessionPatch as DynamicRuntimeSessionPatch | undefined),
        },
      }),
    });

    if (result.terminalOutput) {
      lastTerminalOutput = result.terminalOutput;
    }

    if (!advanced.nextStep) {
      return {
        kind: 'completed',
        output: {
          ingestionSessionId: input.ingestionSessionId,
          status: result.terminalOutput?.status ?? lastTerminalOutput?.status ?? 'completed',
          rowsWritten: result.terminalOutput?.rowsWritten ?? lastTerminalOutput?.rowsWritten ?? {},
          rowsUpdated: result.terminalOutput?.rowsUpdated ?? lastTerminalOutput?.rowsUpdated ?? {},
          rowsSkipped: result.terminalOutput?.rowsSkipped ?? lastTerminalOutput?.rowsSkipped ?? {},
          reportRunId:
            result.terminalOutput?.reportRunId ?? lastTerminalOutput?.reportRunId ?? null,
          reportRunIds:
            result.terminalOutput?.reportRunIds ?? lastTerminalOutput?.reportRunIds ?? [],
          report: asWorkflowOutputReport(
            result.terminalOutput?.report ?? lastTerminalOutput?.report,
          ),
        },
      };
    }

    resumeData = undefined;
  }

  throw new Error('dynamic_orchestrator_loop_guard_exceeded');
}
