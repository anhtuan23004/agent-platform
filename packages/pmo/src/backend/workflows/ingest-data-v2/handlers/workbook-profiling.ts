import { appendCheckpoint, appendProposal, approveProposal, createProposal } from '@seta/ingestion';
import type { PmoDynamicStepHandler } from '../types.ts';
import type { DynamicHandlerDeps, ProfilingResult } from './common.ts';

export function createWorkbookProfilingHandler(
  deps: Pick<DynamicHandlerDeps, 'getSchemaDetectionResult'>,
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
        status: 'completed',
        reviewRequired: false,
        nextAllowedActions: ['approve', 'rerun', 'upload_more'],
        createdBy: 'agent',
        metadata: {
          validation_status: result.validation.status,
          workbook_confidence: result.validation.workbookConfidence,
        },
      });
      const checkpoint = approveProposal({
        proposal,
        approvedOutput: profilingResult,
        approvedBy: input.userId || 'system',
        metadata: {
          auto_approved: true,
        },
      });
      const checkpointState = appendCheckpoint(
        appendProposal(input.runtimeContext.detected_schema ?? {}, proposal),
        checkpoint,
      );
      const detectedSchemaPayload = {
        tableMappings: result.tables,
        validationStatus: result.validation.status,
        workbookConfidence: result.validation.workbookConfidence,
        review_proposals: checkpointState.review_proposals,
        approved_checkpoints: checkpointState.approved_checkpoints,
      };

      return {
        kind: 'completed',
        sessionStatus: 'awaiting_confirmation',
        runtimeContextPatch: {
          detected_schema: detectedSchemaPayload,
        },
        sessionPatch: {
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
