import { describe, expect, it } from 'vitest';
import { compilePmoWorkflowSteps } from '../../../src/backend/planning/compiler.ts';

describe('PMO publish_report_intent plan coverage', () => {
  it('compiles through database_change_summary and generate_report', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'publish_report_intent',
      candidateSteps: [],
    });

    const actionIds = result.compiled_workflow.map((step) => step.action_id);
    expect(actionIds).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
      'generate_report',
    ]);
  });
});
