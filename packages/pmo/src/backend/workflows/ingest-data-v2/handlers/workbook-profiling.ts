import { appendProposal, createProposal } from '@seta/ingestion';
import { buildProfilingReviewCard } from '../cards.ts';
import type { PmoDynamicStepHandler } from '../types.ts';
import type { DynamicHandlerDeps, ProfilingResult } from './common.ts';

export function createWorkbookProfilingHandler(
  deps: Pick<
    DynamicHandlerDeps,
    'getSchemaDetectionResult' | 'resolveCardIdentity' | 'readPlannerStepMeta'
  >,
): PmoDynamicStepHandler {
  return {
    actionId: 'workbook_profiling',
    execute: async (input) => {
      const result = await deps.getSchemaDetectionResult(input);
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
      const detectedSchemaPayload = {
        tableMappings: result.tables,
        validationStatus: result.validation.status,
        workbookConfidence: result.validation.workbookConfidence,
        review_proposals: proposalState.review_proposals,
        approved_checkpoints: proposalState.approved_checkpoints,
      };

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
