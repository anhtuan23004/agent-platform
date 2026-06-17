import type { PmoDynamicStepHandler } from '../types.ts';
import type { DynamicHandlerDeps } from './common.ts';

export function createWorkbookProfilingHandler(
  deps: Pick<DynamicHandlerDeps, 'getSchemaDetectionResult'>,
): PmoDynamicStepHandler {
  return {
    actionId: 'workbook_profiling',
    execute: async (input) => {
      const result = await deps.getSchemaDetectionResult(input);

      return {
        kind: 'completed',
        sessionStatus: 'awaiting_confirmation',
        runtimeContextPatch: {
          detected_schema: {
            tableMappings: result.tables,
            validationStatus: result.validation.status,
            workbookConfidence: result.validation.workbookConfidence,
          },
        },
        sessionPatch: {
          detected_schema: {
            tableMappings: result.tables,
            validationStatus: result.validation.status,
            workbookConfidence: result.validation.workbookConfidence,
          },
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
