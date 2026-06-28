import { describe, expect, it } from 'vitest';
import { attachStepViewToState } from '../../../../src/backend/workflows/ingest-data-v2/orchestrator-internals.ts';
import type {
  DynamicIngestRuntimeContext,
  PlannerExecutionStateV2,
  PlannerExecutionStepV2,
} from '../../../../src/backend/workflows/ingest-data-v2/types.ts';

const step = {
  step_no: 2,
  planner_step_id: 'pmo.planner.step.2.column_mapping',
  action_id: 'column_mapping',
  review_type: 'mapping',
  step_name: 'Column mapping',
  status: 'in_progress',
  review_status: 'pending',
} satisfies PlannerExecutionStepV2;

const state = {
  state_version: 2,
  started_at: '2026-06-26T05:18:38.000Z',
  updated_at: '2026-06-26T05:18:38.000Z',
  current_step_no: 2,
  current_planner_step_id: step.planner_step_id,
  current_step_status: 'needs_review',
  steps: [step],
  documents: [],
  profiling_summary: null,
  profiling_review: null,
} satisfies PlannerExecutionStateV2;

describe('attachStepViewToState', () => {
  it('materializes a display snapshot for suspended PMO steps', () => {
    const runtimeContext = {
      detected_schema: {
        tableMappings: [{ tableId: 'resource_allocation' }],
        validationStatus: 'needs_review',
        workbookConfidence: 0.95,
      },
      confirmed_mapping: {
        confirmedMappings: [],
        mappingReviewRows: [],
      },
    } satisfies DynamicIngestRuntimeContext;
    const approvalPayload = {
      intent: 'Review column mappings',
      meta: {
        actionId: 'column_mapping',
        reviewType: 'mapping',
      },
    };

    const next = attachStepViewToState({
      state,
      step,
      runtimeContext,
      status: 'needs_review',
      approvalPayload,
      outputSummary: { status: 'needs_review', total_items: 3 },
      reviewStatus: 'pending',
    });

    const view = next.step_views?.column_mapping;
    expect(view).toMatchObject({
      action_id: 'column_mapping',
      review_type: 'mapping',
      planner_step_id: 'pmo.planner.step.2.column_mapping',
      status: 'needs_review',
      review_status: 'pending',
      approval_payload: approvalPayload,
      output_summary: { status: 'needs_review', total_items: 3 },
    });
    expect(view?.runtime_payload).toMatchObject({
      detected_schema: runtimeContext.detected_schema,
      confirmed_mapping: runtimeContext.confirmed_mapping,
    });
  });
});
