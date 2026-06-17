import { describe, expect, it } from 'vitest';
import { loadPmoPlannerCatalog } from '../../../src/backend/planning/catalog.ts';
import { compilePmoWorkflowSteps } from '../../../src/backend/planning/compiler.ts';

describe('PMO planner workflow compiler', () => {
  it('compiles Review this file intent to workbook profiling only', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'review_only',
      candidateSteps: [
        {
          step_no: 1,
          planner_step_id: 'model.step.1',
          action_id: 'workbook_profiling',
          review_type: 'profiling',
          step_name: 'Workbook profiling',
          description: 'Review workbook structure.',
          requires_user_review: false,
        },
      ],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual(['workbook_profiling']);
    expect(result.compiled_workflow).toHaveLength(1);
  });

  it('trims publish and invented summary steps from review-only model output', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'review_only',
      candidateSteps: [
        {
          step_no: 1,
          step_name: 'Workbook profiling',
          action_id: 'workbook_profiling',
          review_type: 'profiling',
          description: 'Review workbook structure.',
          requires_user_review: false,
        },
        {
          step_no: 2,
          step_name: 'Document check summary',
          description: 'Invented summary step.',
          requires_user_review: false,
        },
        {
          step_no: 3,
          step_name: 'Optional publish after approval',
          action_id: 'publish_after_approval',
          review_type: 'publish',
          description: 'Should not be present for review-only intent.',
          requires_user_review: true,
        },
      ],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual(['workbook_profiling']);
    expect(result.diagnostics).toContain(
      'dropped_step_without_catalog_action:Document check summary',
    );
    expect(result.diagnostics).toContain('dropped_step_outside_intent:publish_after_approval');
  });

  it('compiles Review and map this file intent to profiling and mapping only', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'mapping_readiness',
      candidateSteps: [],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual([
      'workbook_profiling',
      'column_mapping',
    ]);
  });

  it('compiles DB preview intent through database change summary and excludes publish', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'stage_preview',
      candidateSteps: [
        {
          step_no: 1,
          step_name: 'Workbook profiling',
          action_id: 'workbook_profiling',
          review_type: 'profiling',
          description: 'Profile workbook.',
          requires_user_review: false,
        },
        {
          step_no: 2,
          step_name: 'Column mapping',
          action_id: 'column_mapping',
          review_type: 'mapping',
          description: 'Map workbook columns.',
          requires_user_review: true,
        },
        {
          step_no: 3,
          step_name: 'Normalize to staging',
          action_id: 'normalize_to_staging',
          review_type: 'normalization',
          description: 'Normalize staged rows.',
          requires_user_review: false,
        },
        {
          step_no: 4,
          step_name: 'Database change summary',
          action_id: 'database_change_summary',
          review_type: 'publish',
          description: 'Preview DB changes.',
          requires_user_review: true,
        },
        {
          step_no: 5,
          step_name: 'Publish after approval',
          action_id: 'publish_after_approval',
          review_type: 'publish',
          description: 'Should be excluded.',
          requires_user_review: true,
        },
      ],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
    ]);
    expect(result.diagnostics).toContain('dropped_step_outside_intent:publish_after_approval');
  });

  it('compiles publish intent to the full configured chain', () => {
    const result = compilePmoWorkflowSteps({
      intentMode: 'publish_intent',
      candidateSteps: [],
    });

    expect(result.compiled_workflow.map((step) => step.action_id)).toEqual([
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
      'publish_after_approval',
    ]);
  });

  it('loads planner intent and step definitions from JSON catalog', () => {
    const catalog = loadPmoPlannerCatalog();
    expect(catalog.default_intent_mode).toBe('review_only');
    expect(catalog.low_confidence_requires_confirmation).toBe(true);
    expect(catalog.steps.map((step) => step.action_id)).toContain('workbook_profiling');
    expect(catalog.examples.map((example) => example.intent_mode)).toContain('review_only');
  });
});
