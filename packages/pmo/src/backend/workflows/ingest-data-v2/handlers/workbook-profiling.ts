import {
  appendCheckpoint,
  appendProposal,
  approveProposal,
  createProposal,
  getLatestProposal,
  type ReviewCheckpointState,
} from '@seta/ingestion';
import type { SchemaDetectionResult } from '../../../ingestion/detect-schema.ts';
import type {
  ProfilingArea,
  SessionDocumentProfileRecord,
} from '../../../profiling/workbook-profiling.ts';
import { buildProfilingReviewCard } from '../cards.ts';
import type { DynamicIngestRuntimeContext, PmoDynamicStepHandler } from '../types.ts';
import type { DynamicHandlerDeps, ProfilingResult } from './common.ts';

const PROFILING_AREAS = new Set<string>([
  'resource_allocation',
  'timesheet',
  'overbook_idle_config',
  'member_master',
  'project_master',
  'leave',
  'calendar_weeks',
  'kpi_norms',
  'unknown',
]);

function isProfilingArea(value: string): value is ProfilingArea {
  return PROFILING_AREAS.has(value);
}

function profilingAreaFromTableId(tableId: string): ProfilingArea {
  return isProfilingArea(tableId) ? tableId : 'unknown';
}

type ProfilingState = NonNullable<DynamicIngestRuntimeContext['profiling']>;

function buildDetectedSchemaPayload(params: {
  profilingResult: ProfilingResult;
  proposalState: ReviewCheckpointState;
}): NonNullable<DynamicIngestRuntimeContext['detected_schema']> {
  return {
    tableMappings: params.profilingResult.tableMappings,
    validationStatus: params.profilingResult.validationStatus,
    workbookConfidence: params.profilingResult.workbookConfidence,
    review_proposals: params.proposalState.review_proposals,
    approved_checkpoints: params.proposalState.approved_checkpoints,
  };
}

export function buildProfilingStateFromDetection(params: {
  input: Parameters<PmoDynamicStepHandler['execute']>[0];
  result: SchemaDetectionResult;
  nowIso: string;
}): ProfilingState {
  const detectedAreas = [
    ...new Set(params.result.tables.map((table) => profilingAreaFromTableId(table.tableId))),
  ];

  const document: SessionDocumentProfileRecord = {
    document_id: params.input.ingestionSessionId,
    source_file_key: params.input.fileKey ?? '',
    file_name: params.input.fileName ?? params.input.fileKey?.split('/').at(-1) ?? 'Workbook',
    file_size_bytes: params.input.fileSizeBytes ?? null,
    mime_type:
      params.input.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaded_at: params.input.uploadedAt ?? params.nowIso,
    status: 'profiled',
  };

  return {
    documents: [document],
    summary: {
      generated_at: params.nowIso,
      document_count: 1,
      profiled_document_count: 1,
      total_sheet_count: params.result.workbookMeta.sheetCount,
      total_row_count: params.result.workbookMeta.totalRows,
      detected_data_areas: detectedAreas,
      missing_recommended_data_areas: [],
      missing_recommended_data_areas_details: [],
      likely_ignorable_sheets: params.result.workbookMeta.excludedSheets,
      suggested_next_step:
        'Workbook profiling complete. Confirm sheet roles, then continue to validation.',
    },
    review: {
      status: 'needs_review',
      sheet_overrides: [],
      waived_missing_areas: [],
      last_updated_at: params.nowIso,
    },
  };
}

export function createWorkbookProfilingHandler(
  deps: Pick<
    DynamicHandlerDeps,
    'getSchemaDetectionResult' | 'resolveCardIdentity' | 'readPlannerStepMeta'
  >,
): PmoDynamicStepHandler {
  return {
    actionId: 'workbook_profiling',
    execute: async (input) => {
      if (input.resumeData?.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          outputSummary: { status: 'rejected' },
          terminalOutput: {
            ingestionSessionId: input.ingestionSessionId,
            status: 'rejected',
            rowsWritten: {},
            rowsUpdated: {},
            rowsSkipped: {},
          },
        };
      }

      if (input.resumeData) {
        const detected = input.runtimeContext.detected_schema;
        const proposal = detected
          ? getLatestProposal<ProfilingResult>(detected, 'workbook_profiling')
          : null;
        if (!detected || !proposal) {
          throw new Error('profiling_proposal_missing');
        }

        const nowIso = new Date().toISOString();
        const approvedCheckpoint = approveProposal<ProfilingResult>({
          proposal,
          approvedOutput: proposal.proposal,
          approvedBy: input.userId || 'system',
        });
        const approvedState = appendCheckpoint(detected, approvedCheckpoint);
        const profiling = input.runtimeContext.profiling
          ? {
              ...input.runtimeContext.profiling,
              review: {
                ...input.runtimeContext.profiling.review,
                status: 'approved' as const,
                last_updated_at: nowIso,
                approved_at: nowIso,
                approved_by: input.userId,
              },
            }
          : undefined;

        return {
          kind: 'completed',
          sessionStatus: 'confirmed',
          runtimeContextPatch: {
            detected_schema: buildDetectedSchemaPayload({
              profilingResult: proposal.proposal,
              proposalState: approvedState,
            }),
            ...(profiling ? { profiling } : {}),
          },
          outputSummary: {
            table_count: proposal.proposal.tableMappings.length,
            validation_status: proposal.proposal.validationStatus,
            workbook_confidence: proposal.proposal.workbookConfidence,
            checkpoint_version: approvedCheckpoint.version,
          },
        };
      }

      const result = await deps.getSchemaDetectionResult(input);
      const nowIso = new Date().toISOString();
      const profilingResult: ProfilingResult = {
        tableMappings: result.tables,
        validationStatus: result.validation.status,
        workbookConfidence: result.validation.workbookConfidence,
      };
      const proposal = createProposal({
        state: input.runtimeContext.detected_schema ?? {},
        stepId: 'workbook_profiling',
        proposal: profilingResult,
        status: 'needs_review',
        reviewRequired: true,
        nextAllowedActions: ['approve', 'reject', 'rerun', 'upload_more'],
        createdBy: 'agent',
        metadata: {
          validation_status: result.validation.status,
          workbook_confidence: result.validation.workbookConfidence,
        },
      });
      const proposalState = appendProposal(input.runtimeContext.detected_schema ?? {}, proposal);
      const detectedSchemaPayload = buildDetectedSchemaPayload({
        profilingResult,
        proposalState,
      });
      const profilingState = buildProfilingStateFromDetection({
        input,
        result,
        nowIso,
      });

      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      return {
        kind: 'suspend',
        card: buildProfilingReviewCard({
          ingestionSessionId: input.ingestionSessionId,
          workbookConfidence: result.validation.workbookConfidence,
          validationStatus: result.validation.status,
          tableMappings: result.tables,
          identity: deps.resolveCardIdentity(input.requestContext),
          toolCallId: `workflow:${input.runId}:pmo_profileWorkbook`,
          plannerStep,
        }),
        sessionStatus: 'awaiting_confirmation',
        runtimeContextPatch: {
          detected_schema: detectedSchemaPayload,
          profiling: profilingState,
        },
        outputSummary: {
          table_count: result.tables.length,
          validation_status: result.validation.status,
          workbook_confidence: result.validation.workbookConfidence,
        },
      };
    },
  };
}
