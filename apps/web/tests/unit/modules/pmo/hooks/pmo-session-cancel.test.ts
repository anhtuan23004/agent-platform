import { describe, expect, it } from 'vitest';
import type { PmoPlanningSession } from '../../../../../src/modules/pmo/api/client';
import { isPmoSessionCancelable } from '../../../../../src/modules/pmo/hooks/pmo-session-cancel';

function session(overrides: Partial<PmoPlanningSession> = {}): PmoPlanningSession {
  return {
    ingestion_session_id: 'run-1',
    source_kind: 'workbook',
    workbook_name: 'workbook.xlsx',
    workbook_size_bytes: 1,
    workbook_size: '1 B',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaded_at: '2026-06-19T00:00:00.000Z',
    operator: 'user-1',
    status: 'uploaded',
    is_published: false,
    is_selectable: false,
    reporting_period_key: null,
    reporting_period_start: null,
    reporting_period_end: null,
    planning_state: 'uploaded',
    status_label: 'Uploaded',
    active_gate: 'Generate plan',
    progress_text: '0 / 3',
    progress_pct: 0,
    goal: '',
    intent: null,
    plan: null,
    plan_version: 0,
    feedback_history: [],
    execution_state: null,
    profiling_documents: [],
    profiling_summary: null,
    profiling_review: null,
    workflow_current_step: null,
    workflow_step_status: null,
    workflow_started_at: null,
    workflow_updated_at: null,
    plan_generated_at: null,
    plan_approved_at: null,
    ...overrides,
  };
}

describe('isPmoSessionCancelable', () => {
  it.each([
    'uploaded',
    'intent_review',
    'generating_plan',
    'plan_review',
    'approved_plan',
  ] as const)('allows cancel during %s before runtime starts', (planningState) => {
    expect(isPmoSessionCancelable(session({ planning_state: planningState }), null)).toBe(true);
  });

  it('blocks cancel after completion', () => {
    expect(
      isPmoSessionCancelable(
        session({ workflow_step_status: 'completed', status: 'published' }),
        'success',
      ),
    ).toBe(false);
  });
});
