import type { ApprovalCard } from '@seta/agent-sdk';
import type { z } from 'zod';
import { detectSchema, type SchemaDetectionResult } from '../../ingestion/detect-schema.ts';
import { parseWorkbook, type WorkbookParseResult } from '../../ingestion/parse-workbook.ts';
import { PMO_DOMAIN_CONFIG } from '../../ingestion/pmo-domain-config.ts';
import { PMO_INGESTION_ADAPTER } from '../../ingestion/pmo-ingestion-adapter.ts';
import {
  enrichPlannerWorkflowSteps,
  type PlannerStepLike,
  type PmoPlanActionId,
  type PmoPlannerStepMetadata,
  type PmoReviewType,
} from '../../planning/step-metadata.ts';
import type { MappingOverride } from './cards.ts';
import {
  type DynamicRuntimeSessionPatch,
  loadDynamicRuntimeSession,
  resolvePmoFileStore,
  updateDynamicRuntimeSession,
} from './context.ts';
import { createColumnMappingHandler } from './handlers/column-mapping.ts';
import type { DynamicHandlerDeps } from './handlers/common.ts';
import { createDatabaseChangeSummaryHandler } from './handlers/database-change-summary.ts';
import { createGenerateReportHandler } from './handlers/generate-report.ts';
import { createGenericReviewHandler } from './handlers/generic-review.ts';
import { createNormalizeToStagingHandler } from './handlers/normalize-to-staging.ts';
import { createPublishAfterApprovalHandler } from './handlers/publish-after-approval.ts';
import { createWorkbookProfilingHandler } from './handlers/workbook-profiling.ts';
import type { DetectOutputSchema, DynamicPlannerResume, IngestDataV2Output } from './schemas.ts';
import { buildPmoDynamicStepRegistry } from './step-registry.ts';
import type {
  DynamicIngestRuntimeContext,
  DynamicRuntimeSessionStatus,
  PlannerExecutionStateV2,
  PlannerExecutionStepV2,
  PmoDynamicHandlerInput,
} from './types.ts';

type DetectTableMapping = z.infer<typeof DetectOutputSchema>['tableMappings'][number];

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

function buildRequiredFieldsByTable(
  config: typeof PMO_DOMAIN_CONFIG,
): ReadonlyMap<string, string[]> {
  return new Map(
    config.tables.map((table) => [
      table.id,
      table.fields.filter((field) => field.required).map((field) => field.name),
    ]),
  );
}

const REQUIRED_FIELDS_BY_TABLE = buildRequiredFieldsByTable(PMO_DOMAIN_CONFIG);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asIsoOrNow(input: string | undefined): string {
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function asDateOrNull(input: string | null | undefined): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readPlannerStepsFromPlan(plan: unknown): PlannerExecutionStepV2[] {
  const defaults: PlannerExecutionStepV2[] = [
    {
      step_no: 1,
      planner_step_id: 'pmo.planner.step.1.workbook_profiling',
      action_id: 'workbook_profiling',
      review_type: 'profiling',
      step_name: 'Workbook profiling',
      status: 'in_progress',
      review_status: 'pending',
    },
    {
      step_no: 2,
      planner_step_id: 'pmo.planner.step.2.column_mapping',
      action_id: 'column_mapping',
      review_type: 'mapping',
      step_name: 'Column mapping',
      status: 'pending',
      review_status: 'pending',
    },
    {
      step_no: 3,
      planner_step_id: 'pmo.planner.step.3.normalize_to_staging',
      action_id: 'normalize_to_staging',
      review_type: 'normalization',
      step_name: 'Normalization to staging',
      status: 'pending',
      review_status: 'pending',
    },
    {
      step_no: 4,
      planner_step_id: 'pmo.planner.step.4.database_change_summary',
      action_id: 'database_change_summary',
      review_type: 'publish',
      step_name: 'Database change summary',
      status: 'pending',
      review_status: 'pending',
    },
  ];

  if (!isObject(plan) || !Array.isArray(plan.proposed_workflow)) {
    return defaults;
  }

  const enriched = enrichPlannerWorkflowSteps(
    plan.proposed_workflow
      .map((step): PlannerStepLike | null => {
        if (!isObject(step)) return null;
        const stepNo = step.step_no;
        const stepName = step.step_name;
        if (typeof stepNo !== 'number' || !Number.isFinite(stepNo)) return null;
        if (typeof stepName !== 'string' || stepName.trim().length === 0) return null;

        return {
          step_no: Math.trunc(stepNo),
          step_name: stepName.trim(),
          description: typeof step.description === 'string' ? step.description : '',
          action_id: step.action_id,
          planner_step_id: step.planner_step_id,
          review_type: step.review_type,
          requires_user_review: step.requires_user_review,
        };
      })
      .filter((step): step is PlannerStepLike => Boolean(step)),
  ).sort((a, b) => a.step_no - b.step_no);

  if (enriched.length === 0) {
    return defaults;
  }

  return enriched.map((step, index) => ({
    step_no: step.step_no,
    planner_step_id: step.planner_step_id,
    action_id: step.action_id,
    review_type: step.review_type,
    step_name: step.step_name,
    status: index === 0 ? 'in_progress' : 'pending',
    review_status: step.review_type === 'none' ? 'not_needed' : 'pending',
  }));
}

function readExecutionStateV2(raw: unknown, planningPlan: unknown): PlannerExecutionStateV2 {
  const nowIso = new Date().toISOString();
  if (!isObject(raw) || raw.state_version !== 2 || !Array.isArray(raw.steps)) {
    const steps = readPlannerStepsFromPlan(planningPlan);
    const first = steps[0] ?? {
      step_no: 1,
      planner_step_id: 'pmo.planner.step.1.workbook_profiling',
    };
    return {
      state_version: 2,
      started_at: nowIso,
      updated_at: nowIso,
      current_step_no: first.step_no,
      current_planner_step_id: first.planner_step_id,
      current_step_status: 'in_progress',
      steps,
      documents: [],
      profiling_summary: null,
      profiling_review: null,
    };
  }

  const steps = raw.steps
    .map((step): PlannerExecutionStepV2 | null => {
      if (!isObject(step)) return null;
      if (typeof step.step_no !== 'number' || !Number.isFinite(step.step_no)) return null;
      if (typeof step.planner_step_id !== 'string' || step.planner_step_id.length === 0) {
        return null;
      }
      if (typeof step.action_id !== 'string') return null;
      if (typeof step.review_type !== 'string') return null;
      if (typeof step.step_name !== 'string' || step.step_name.length === 0) return null;
      if (typeof step.status !== 'string') return null;

      const status = step.status;
      if (
        status !== 'pending' &&
        status !== 'in_progress' &&
        status !== 'completed' &&
        status !== 'needs_review' &&
        status !== 'failed' &&
        status !== 'cancelled'
      ) {
        return null;
      }

      return {
        step_no: Math.trunc(step.step_no),
        planner_step_id: step.planner_step_id,
        action_id: step.action_id as PmoPlanActionId,
        review_type: step.review_type as PmoReviewType,
        step_name: step.step_name,
        status,
        output_summary: isObject(step.output_summary)
          ? (step.output_summary as Record<string, unknown>)
          : undefined,
        review_status:
          step.review_status === 'not_needed' ||
          step.review_status === 'pending' ||
          step.review_status === 'approved' ||
          step.review_status === 'rejected' ||
          step.review_status === 'modified'
            ? step.review_status
            : undefined,
      };
    })
    .filter((step): step is PlannerExecutionStepV2 => Boolean(step))
    .sort((a, b) => a.step_no - b.step_no);

  if (steps.length === 0) {
    return readExecutionStateV2(null, planningPlan);
  }

  const currentStepNo =
    typeof raw.current_step_no === 'number' && Number.isFinite(raw.current_step_no)
      ? Math.trunc(raw.current_step_no)
      : (steps[0]?.step_no ?? 1);

  const currentPlannerStepId =
    typeof raw.current_planner_step_id === 'string' && raw.current_planner_step_id.length > 0
      ? raw.current_planner_step_id
      : (steps[0]?.planner_step_id ?? 'pmo.planner.step.1.workbook_profiling');

  const currentStepStatus =
    raw.current_step_status === 'in_progress' ||
    raw.current_step_status === 'needs_review' ||
    raw.current_step_status === 'completed' ||
    raw.current_step_status === 'failed' ||
    raw.current_step_status === 'cancelled'
      ? raw.current_step_status
      : 'in_progress';

  return {
    state_version: 2,
    started_at: asIsoOrNow(typeof raw.started_at === 'string' ? raw.started_at : undefined),
    updated_at: asIsoOrNow(typeof raw.updated_at === 'string' ? raw.updated_at : undefined),
    current_step_no: currentStepNo,
    current_planner_step_id: currentPlannerStepId,
    current_step_status: currentStepStatus,
    steps,
    documents: Array.isArray(raw.documents)
      ? (raw.documents as PlannerExecutionStateV2['documents'])
      : [],
    profiling_summary: isObject(raw.profiling_summary)
      ? (raw.profiling_summary as Record<string, unknown>)
      : null,
    profiling_review: isObject(raw.profiling_review)
      ? (raw.profiling_review as unknown as PlannerExecutionStateV2['profiling_review'])
      : null,
    report_request: isObject(raw.report_request)
      ? (raw.report_request as PlannerExecutionStateV2['report_request'])
      : undefined,
    report_result: isObject(raw.report_result)
      ? (raw.report_result as PlannerExecutionStateV2['report_result'])
      : undefined,
  };
}

function attachRuntimeContextToState(
  state: PlannerExecutionStateV2,
  runtimeContext: DynamicIngestRuntimeContext,
): PlannerExecutionStateV2 {
  return {
    ...state,
    ...(runtimeContext.report_request ? { report_request: runtimeContext.report_request } : {}),
    ...(runtimeContext.report_result ? { report_result: runtimeContext.report_result } : {}),
  };
}

function applyMappingOverrides(
  tableMappings: DetectTableMapping[],
  mappingOverrides: MappingOverride[],
): DetectTableMapping[] {
  if (mappingOverrides.length === 0) return tableMappings;

  const overridesByTable = new Map<string, MappingOverride[]>();
  for (const override of mappingOverrides) {
    const list = overridesByTable.get(override.tableId) ?? [];
    list.push(override);
    overridesByTable.set(override.tableId, list);
  }

  return tableMappings.map((table) => {
    const tableOverrides = overridesByTable.get(table.tableId) ?? [];
    if (tableOverrides.length === 0) return table;

    const overrideByField = new Map<string, MappingOverride>();
    for (const override of tableOverrides) {
      overrideByField.set(override.field, override);
    }

    const nextSourceByField = new Map<string, string>();
    for (const mapping of table.mappings) {
      const override = overrideByField.get(mapping.canonicalField);
      nextSourceByField.set(mapping.canonicalField, override?.sourceColumn ?? mapping.sourceColumn);
    }
    for (const override of tableOverrides) {
      if (!nextSourceByField.has(override.field)) {
        nextSourceByField.set(override.field, override.sourceColumn);
      }
    }

    const fieldBySourceColumn = new Map<string, string>();
    for (const [field, sourceColumn] of nextSourceByField.entries()) {
      const existingField = fieldBySourceColumn.get(sourceColumn);
      if (existingField && existingField !== field) {
        throw new Error(`mapping_override_conflict:${table.tableId}:${sourceColumn}`);
      }
      fieldBySourceColumn.set(sourceColumn, field);
    }

    const nextMappings: DetectTableMapping['mappings'] = table.mappings.map((mapping) => {
      const override = overrideByField.get(mapping.canonicalField);
      if (!override) return mapping;

      if (
        mapping.candidates?.length &&
        !mapping.candidates.some((candidate) => candidate.sourceColumn === override.sourceColumn)
      ) {
        throw new Error(
          `invalid_mapping_override_candidate:${table.tableId}:${mapping.canonicalField}:${override.sourceColumn}`,
        );
      }

      const selectedCandidate = mapping.candidates?.find(
        (candidate) => candidate.sourceColumn === override.sourceColumn,
      );
      const confidence = override.confidence ?? selectedCandidate?.confidence ?? mapping.confidence;
      const blocked = override.blocked ?? selectedCandidate?.blocked ?? false;
      const status: DetectTableMapping['mappings'][number]['status'] = blocked
        ? 'blocked'
        : 'needs_review';

      return {
        ...mapping,
        sourceColumn: override.sourceColumn,
        confidence,
        status,
      };
    });

    for (const override of tableOverrides) {
      if (nextMappings.some((mapping) => mapping.canonicalField === override.field)) continue;

      const status: DetectTableMapping['mappings'][number]['status'] = override.blocked
        ? 'blocked'
        : 'needs_review';
      nextMappings.push({
        sourceColumn: override.sourceColumn,
        canonicalField: override.field,
        confidence: override.confidence ?? 0.7,
        status,
        candidates: [
          {
            sourceColumn: override.sourceColumn,
            confidence: override.confidence ?? 0.7,
            blocked: Boolean(override.blocked),
          },
        ],
      });
    }

    const mappedFields = new Set(nextMappings.map((mapping) => mapping.canonicalField));
    const requiredFields = REQUIRED_FIELDS_BY_TABLE.get(table.tableId) ?? [];
    const requiredConfidenceSum = requiredFields.reduce((sum, field) => {
      const mapped = nextMappings.find((mapping) => mapping.canonicalField === field);
      return sum + (mapped?.confidence ?? 0);
    }, 0);
    const tableConfidence =
      requiredFields.length > 0
        ? Math.round((requiredConfidenceSum / requiredFields.length) * 100) / 100
        : table.tableConfidence;

    return {
      ...table,
      tableConfidence,
      mappings: nextMappings,
      unmappedRequired: table.unmappedRequired.filter((field) => !mappedFields.has(field)),
      ambiguous: table.ambiguous.filter((field) => !overrideByField.has(field)),
    };
  });
}

function normalizeRuntimeContextFromSessionRow(params: {
  detectedSchema: unknown;
  confirmedMapping: unknown;
  changeSummary: unknown;
  workflowExecutionState: unknown;
}): DynamicIngestRuntimeContext {
  const context: DynamicIngestRuntimeContext = {};

  if (isObject(params.detectedSchema)) {
    context.detected_schema = {
      tableMappings: Array.isArray(params.detectedSchema.tableMappings)
        ? params.detectedSchema.tableMappings
        : [],
      validationStatus:
        params.detectedSchema.validationStatus === 'confirmed' ||
        params.detectedSchema.validationStatus === 'needs_review' ||
        params.detectedSchema.validationStatus === 'blocked'
          ? params.detectedSchema.validationStatus
          : 'needs_review',
      workbookConfidence:
        typeof params.detectedSchema.workbookConfidence === 'number'
          ? params.detectedSchema.workbookConfidence
          : 0,
      ...(isObject(params.detectedSchema.review_proposals)
        ? { review_proposals: params.detectedSchema.review_proposals as never }
        : {}),
      ...(isObject(params.detectedSchema.approved_checkpoints)
        ? { approved_checkpoints: params.detectedSchema.approved_checkpoints as never }
        : {}),
    };
  }

  if (isObject(params.confirmedMapping)) {
    context.confirmed_mapping = {
      confirmedMappings: Array.isArray(params.confirmedMapping.confirmedMappings)
        ? params.confirmedMapping.confirmedMappings
        : [],
      mappingReviewRows: Array.isArray(params.confirmedMapping.mappingReviewRows)
        ? (params.confirmedMapping.mappingReviewRows as Array<{ k: string; v: string }>)
        : [],
      ...(isObject(params.confirmedMapping.review_proposals)
        ? { review_proposals: params.confirmedMapping.review_proposals as never }
        : {}),
      ...(isObject(params.confirmedMapping.approved_checkpoints)
        ? { approved_checkpoints: params.confirmedMapping.approved_checkpoints as never }
        : {}),
    };
  }

  if (isObject(params.changeSummary)) {
    context.staging_result = {
      changeSummary: Array.isArray(params.changeSummary.changeSummary)
        ? params.changeSummary.changeSummary
        : [],
      blockingIssues: Array.isArray(params.changeSummary.blockingIssues)
        ? params.changeSummary.blockingIssues
        : [],
      mappingReviewRows: Array.isArray(params.changeSummary.mappingReviewRows)
        ? (params.changeSummary.mappingReviewRows as Array<{ k: string; v: string }>)
        : [],
      hasBlockingIssues: params.changeSummary.hasBlockingIssues === true,
      hasUpdates: params.changeSummary.hasUpdates === true,
      requiresReview: params.changeSummary.requiresReview === true,
      ...(isObject(params.changeSummary.review_proposals)
        ? { review_proposals: params.changeSummary.review_proposals as never }
        : {}),
      ...(isObject(params.changeSummary.approved_checkpoints)
        ? { approved_checkpoints: params.changeSummary.approved_checkpoints as never }
        : {}),
    };
  }

  if (isObject(params.workflowExecutionState)) {
    if (isObject(params.workflowExecutionState.report_request)) {
      context.report_request = params.workflowExecutionState
        .report_request as DynamicIngestRuntimeContext['report_request'];
    }
    if (isObject(params.workflowExecutionState.report_result)) {
      context.report_result = params.workflowExecutionState
        .report_result as DynamicIngestRuntimeContext['report_result'];
    }
  }

  return context;
}

function resolveCardIdentity(requestContext: { get: (key: string) => unknown }): {
  tenantId: string;
  userId: string;
} {
  const actor = requestContext.get('actor') as { user_id?: string } | undefined;
  const tenantId = (requestContext.get('tenant_id') as string | undefined) ?? '';
  const userId = actor?.user_id ?? '';
  return { tenantId, userId };
}

function runtimeContextToSessionPatch(
  patch: Partial<DynamicIngestRuntimeContext> | undefined,
): DynamicRuntimeSessionPatch {
  if (!patch) return {};

  const sessionPatch: DynamicRuntimeSessionPatch = {};
  if (patch.detected_schema) sessionPatch.detected_schema = patch.detected_schema;
  if (patch.confirmed_mapping) sessionPatch.confirmed_mapping = patch.confirmed_mapping;
  if (patch.staging_result) sessionPatch.change_summary = patch.staging_result;
  return sessionPatch;
}

function markStepsForSuspend(
  state: PlannerExecutionStateV2,
  activeStep: PlannerExecutionStepV2,
): PlannerExecutionStateV2 {
  return {
    ...state,
    updated_at: new Date().toISOString(),
    current_step_no: activeStep.step_no,
    current_planner_step_id: activeStep.planner_step_id,
    current_step_status: 'needs_review',
    steps: state.steps.map((step) => {
      if (
        step.step_no < activeStep.step_no &&
        step.status !== 'completed' &&
        step.status !== 'failed'
      ) {
        return {
          ...step,
          status: 'completed' as const,
        };
      }

      if (step.step_no === activeStep.step_no) {
        return {
          ...step,
          status: 'needs_review' as const,
          review_status: 'pending' as const,
        };
      }

      if (step.status === 'in_progress') {
        return {
          ...step,
          status: 'pending' as const,
        };
      }

      return step;
    }),
  };
}

function markStepRejected(
  state: PlannerExecutionStateV2,
  activeStep: PlannerExecutionStepV2,
): PlannerExecutionStateV2 {
  return {
    ...state,
    updated_at: new Date().toISOString(),
    current_step_no: activeStep.step_no,
    current_planner_step_id: activeStep.planner_step_id,
    current_step_status: 'failed',
    steps: state.steps.map((step) => {
      if (step.step_no === activeStep.step_no) {
        return {
          ...step,
          status: 'failed' as const,
          review_status: 'rejected' as const,
        };
      }

      if (
        step.step_no > activeStep.step_no &&
        step.status !== 'completed' &&
        step.status !== 'failed'
      ) {
        return {
          ...step,
          status: 'cancelled' as const,
        };
      }

      return step;
    }),
  };
}

function markStepCompleted(
  state: PlannerExecutionStateV2,
  activeStep: PlannerExecutionStepV2,
  outputSummary?: Record<string, unknown>,
): {
  state: PlannerExecutionStateV2;
  nextStep: PlannerExecutionStepV2 | null;
} {
  const ordered = state.steps.slice().sort((a, b) => a.step_no - b.step_no);
  const currentIndex = ordered.findIndex((step) => step.step_no === activeStep.step_no);
  const nextStep =
    currentIndex >= 0 && currentIndex + 1 < ordered.length
      ? (ordered[currentIndex + 1] ?? null)
      : null;

  const nextState = {
    ...state,
    updated_at: new Date().toISOString(),
    current_step_no: nextStep ? nextStep.step_no : activeStep.step_no,
    current_planner_step_id: nextStep ? nextStep.planner_step_id : activeStep.planner_step_id,
    current_step_status: nextStep ? 'in_progress' : 'completed',
    steps: ordered.map((step) => {
      if (
        step.step_no < activeStep.step_no &&
        step.status !== 'completed' &&
        step.status !== 'failed'
      ) {
        return {
          ...step,
          status: 'completed' as const,
        };
      }

      if (step.step_no === activeStep.step_no) {
        return {
          ...step,
          status: 'completed' as const,
          review_status:
            step.review_type === 'none'
              ? 'not_needed'
              : step.review_status === 'modified'
                ? 'modified'
                : 'approved',
          output_summary: outputSummary ?? step.output_summary,
        };
      }

      if (nextStep && step.step_no === nextStep.step_no && step.status === 'pending') {
        return {
          ...step,
          status: 'in_progress' as const,
        };
      }

      return step;
    }),
  } satisfies PlannerExecutionStateV2;

  return {
    state: nextState,
    nextStep,
  };
}

function readCurrentStepName(state: PlannerExecutionStateV2): string | null {
  const step = state.steps.find((item) => item.step_no === state.current_step_no);
  return step ? `${step.step_no}. ${step.step_name}` : null;
}

function statusForAction(actionId: PmoPlanActionId): DynamicRuntimeSessionStatus {
  if (actionId === 'workbook_profiling') return 'profiling';
  if (actionId === 'column_mapping') return 'awaiting_confirmation';
  if (actionId === 'normalize_to_staging') return 'normalizing';
  if (actionId === 'database_change_summary') return 'awaiting_publish_review';
  if (actionId === 'publish_after_approval') return 'awaiting_publish_review';
  if (actionId === 'generate_report') return 'generating_report';
  return 'confirmed';
}

function buildStatePatch(params: {
  state: PlannerExecutionStateV2;
  status: DynamicRuntimeSessionStatus;
  extraPatch?: DynamicRuntimeSessionPatch;
}): DynamicRuntimeSessionPatch {
  return {
    status: params.status,
    workflow_execution_state: params.state,
    workflow_current_step: readCurrentStepName(params.state),
    workflow_step_status: params.state.current_step_status,
    workflow_started_at: asDateOrNull(params.state.started_at),
    workflow_updated_at: asDateOrNull(params.state.updated_at),
    finished_at:
      params.status === 'published' ||
      params.status === 'report_generated' ||
      params.status === 'failed' ||
      params.status === 'rejected' ||
      params.status === 'cancelled'
        ? asDateOrNull(new Date().toISOString())
        : null,
    ...params.extraPatch,
    ...(params.status === 'published' ? { publish_reviewed_at: new Date() } : {}),
  };
}

function asWorkflowOutputReport(report: unknown): IngestDataV2Output['report'] {
  return report as IngestDataV2Output['report'];
}

async function readPlannerStepMeta(params: {
  ingestionSessionId: string;
  tenantId: string;
  step: PlannerExecutionStepV2;
}): Promise<PmoPlannerStepMetadata | null> {
  const row = await loadDynamicRuntimeSession({
    ingestionSessionId: params.ingestionSessionId,
    tenantId: params.tenantId,
  });
  if (!row) return null;

  const plannerStep = readPlannerStepsFromPlan(row.planning_plan).find(
    (step) => step.planner_step_id === params.step.planner_step_id,
  );
  if (!plannerStep) return null;

  return {
    planner_step_id: plannerStep.planner_step_id,
    action_id: plannerStep.action_id,
    review_type: plannerStep.review_type,
  };
}

interface IngestArtifactsCache {
  workbookBuffer: Buffer | ArrayBuffer | Uint8Array | null;
  workbookParseResult: WorkbookParseResult | null;
  schemaDetectionResult: SchemaDetectionResult | null;
}

function createIngestArtifactsCache(): IngestArtifactsCache {
  return {
    workbookBuffer: null,
    workbookParseResult: null,
    schemaDetectionResult: null,
  };
}

function buildStepRegistry(deps: DynamicHandlerDeps) {
  return buildPmoDynamicStepRegistry([
    createWorkbookProfilingHandler({
      getSchemaDetectionResult: deps.getSchemaDetectionResult,
    }),
    createColumnMappingHandler({
      resolveCardIdentity: deps.resolveCardIdentity,
      readPlannerStepMeta: deps.readPlannerStepMeta,
      applyMappingOverrides: deps.applyMappingOverrides,
    }),
    createNormalizeToStagingHandler({
      domainConfig: deps.domainConfig,
      domainAdapter: deps.domainAdapter,
      resolveCardIdentity: deps.resolveCardIdentity,
      readPlannerStepMeta: deps.readPlannerStepMeta,
      requiredFieldsByTable: deps.requiredFieldsByTable,
      getWorkbookParseResult: deps.getWorkbookParseResult,
    }),
    createDatabaseChangeSummaryHandler({
      domainAdapter: deps.domainAdapter,
      resolveCardIdentity: deps.resolveCardIdentity,
      readPlannerStepMeta: deps.readPlannerStepMeta,
    }),
    createPublishAfterApprovalHandler({
      domainAdapter: deps.domainAdapter,
      resolveCardIdentity: deps.resolveCardIdentity,
      readPlannerStepMeta: deps.readPlannerStepMeta,
    }),
    createGenerateReportHandler({
      resolveCardIdentity: deps.resolveCardIdentity,
      readPlannerStepMeta: deps.readPlannerStepMeta,
      getWorkbookParseResult: deps.getWorkbookParseResult,
    }),
    createGenericReviewHandler(),
  ]);
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

  const getWorkbookBuffer = async (
    handlerInput: Pick<PmoDynamicHandlerInput, 'requestContext' | 'fileKey'>,
  ): Promise<Buffer | ArrayBuffer | Uint8Array> => {
    if (artifactsCache.workbookBuffer) {
      return artifactsCache.workbookBuffer;
    }

    if (!handlerInput.fileKey) {
      throw new Error('workbook_file_key_required');
    }

    const fileStore = resolvePmoFileStore(handlerInput.requestContext as never);
    artifactsCache.workbookBuffer = await fileStore.getBuffer(handlerInput.fileKey);
    return artifactsCache.workbookBuffer;
  };

  const getWorkbookParseResult = async (
    handlerInput: Pick<PmoDynamicHandlerInput, 'requestContext' | 'fileKey'>,
  ): Promise<WorkbookParseResult> => {
    if (artifactsCache.workbookParseResult) {
      return artifactsCache.workbookParseResult;
    }

    const buffer = await getWorkbookBuffer(handlerInput);
    artifactsCache.workbookParseResult = await parseWorkbook(buffer);
    return artifactsCache.workbookParseResult;
  };

  const getSchemaDetectionResult = async (
    handlerInput: Pick<PmoDynamicHandlerInput, 'requestContext' | 'fileKey'>,
  ): Promise<SchemaDetectionResult> => {
    if (artifactsCache.schemaDetectionResult) {
      return artifactsCache.schemaDetectionResult;
    }

    const buffer = await getWorkbookBuffer(handlerInput);
    const parsedWorkbook = await getWorkbookParseResult(handlerInput);
    artifactsCache.schemaDetectionResult = await detectSchema(buffer, {
      parsedWorkbook,
    });
    return artifactsCache.schemaDetectionResult;
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

  let resumeData = input.resumeData;
  let lastTerminalOutput:
    | {
        status: 'published' | 'rejected' | 'completed';
        rowsWritten?: Record<string, number>;
        rowsUpdated?: Record<string, number>;
        rowsSkipped?: Record<string, number>;
        reportRunId?: string | null;
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
      reportingPeriodStart: row.reporting_period_start,
      reportingPeriodEnd: row.reporting_period_end,
      requestContext: input.requestContext,
      resumeData: decisionForStep as Record<string, unknown> | undefined,
      step: activeStep,
      planningPlan: row.planning_plan,
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
          report: asWorkflowOutputReport(result.terminalOutput?.report),
        },
      };
    }

    const advanced = markStepCompleted(state, activeStep, result.outputSummary);
    state = attachRuntimeContextToState(advanced.state, runtimeContext);

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
