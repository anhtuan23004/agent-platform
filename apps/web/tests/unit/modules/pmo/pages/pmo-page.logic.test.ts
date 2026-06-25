import { describe, expect, it } from 'vitest';
import type { PmoPlanningSession } from '../../../../../src/modules/pmo/api/client';
import { buildExecutionCards } from '../../../../../src/modules/pmo/pages/pmo-page.logic';

function makeSession(overrides: Partial<PmoPlanningSession> = {}): PmoPlanningSession {
  return {
    ingestion_session_id: '33333333-3333-3333-3333-333333333333',
    chat_thread_id: null,
    source_kind: 'workbook',
    workbook_name: 'PMO.xlsx',
    workbook_size_bytes: 123,
    workbook_size: '123 B',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaded_at: '2026-06-26T05:18:38.000Z',
    operator: '22222222-2222-2222-2222-222222222222',
    status: 'awaiting_confirmation',
    is_published: false,
    is_selectable: false,
    reporting_period_key: null,
    reporting_period_start: null,
    reporting_period_end: null,
    planning_state: 'approved_plan',
    status_label: 'Awaiting next step',
    active_gate: 'Column mapping',
    progress_text: '1 / 4 workflow steps',
    progress_pct: 25,
    goal: 'Ingest workbook',
    intent: null,
    plan: {
      title: 'PMO ingest',
      goal_summary: 'Ingest workbook',
      uploaded_file_summary: null,
      scope_assumption: {
        likely_data_areas: [],
        basis: 'test',
      },
      proposed_workflow: [
        {
          step_no: 1,
          planner_step_id: 'pmo.planner.step.1.workbook_profiling',
          action_id: 'workbook_profiling',
          review_type: 'profiling',
          step_name: 'Workbook profiling',
          description: 'Profile workbook',
          agent_responsibility: '',
          user_responsibility: '',
          requires_user_review: true,
        },
        {
          step_no: 2,
          planner_step_id: 'pmo.planner.step.2.column_mapping',
          action_id: 'column_mapping',
          review_type: 'mapping',
          step_name: 'Column mapping',
          description: 'Review mappings',
          agent_responsibility: '',
          user_responsibility: '',
          requires_user_review: true,
        },
      ],
      review_gates: [],
      state_management_plan: {
        state_to_save: [],
        resume_behavior: '',
      },
      risks_and_assumptions: [],
      not_yet_performed: [],
      approval_policy: {
        can_continue_after_plan_approval: true,
        requires_mapping_review_before_normalization: true,
        requires_db_change_review_before_publish: true,
        will_publish_without_user_approval: false,
      },
      next_action: {
        label: 'Continue',
        description: '',
      },
    },
    plan_version: 1,
    feedback_history: [],
    execution_state: {
      state_version: 2,
      started_at: '2026-06-26T05:18:38.000Z',
      updated_at: '2026-06-26T05:19:38.000Z',
      current_step_no: 2,
      current_step_status: 'needs_review',
      steps: [
        {
          step_no: 1,
          planner_step_id: 'pmo.planner.step.1.workbook_profiling',
          action_id: 'workbook_profiling',
          review_type: 'profiling',
          step_name: 'Workbook profiling',
          status: 'completed',
        },
        {
          step_no: 2,
          planner_step_id: 'pmo.planner.step.2.column_mapping',
          action_id: 'column_mapping',
          review_type: 'mapping',
          step_name: 'Column mapping',
          status: 'needs_review',
        },
      ],
      documents: [],
      profiling_summary: null,
      profiling_review: null,
      step_views: {
        column_mapping: {
          action_id: 'column_mapping',
          review_type: 'mapping',
          planner_step_id: 'pmo.planner.step.2.column_mapping',
          step_name: 'Column mapping',
          status: 'needs_review',
          review_status: 'pending',
          approval_payload: {
            intent: 'Review column mappings',
            meta: { actionId: 'column_mapping', reviewType: 'mapping' },
          },
          output_summary: {
            status: 'needs_review',
            total_items: 3,
          },
          updated_at: '2026-06-26T05:19:38.000Z',
        },
      },
    },
    profiling_documents: [],
    profiling_summary: null,
    profiling_review: null,
    workflow_current_step: '2. Column mapping',
    workflow_step_status: 'needs_review',
    workflow_started_at: '2026-06-26T05:18:38.000Z',
    workflow_updated_at: '2026-06-26T05:19:38.000Z',
    plan_generated_at: null,
    plan_approved_at: '2026-06-26T05:18:38.000Z',
    ...overrides,
  };
}

describe('buildExecutionCards', () => {
  it('attaches persisted step view state and output summary to execution cards', () => {
    const cards = buildExecutionCards(makeSession());
    const mapping = cards.find((card) => card.action_id === 'column_mapping');

    expect(mapping?.status).toBe('needs_review');
    expect(mapping?.output_summary).toEqual({
      status: 'needs_review',
      total_items: 3,
    });
    expect(mapping?.view_state?.approval_payload).toMatchObject({
      intent: 'Review column mappings',
    });
  });
});
