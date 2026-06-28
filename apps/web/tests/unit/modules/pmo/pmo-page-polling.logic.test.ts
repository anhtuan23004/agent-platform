import { describe, expect, it } from 'vitest';
import type { PmoPlanningSession } from '../../../../src/modules/pmo/api/client';
import { hasActiveIngestionSessionForPolling } from '../../../../src/modules/pmo/pages/pmo-page.logic';

function session(partial: Partial<PmoPlanningSession>): PmoPlanningSession {
  return {
    ingestion_session_id: 's1',
    chat_thread_id: null,
    source_kind: 'workbook',
    workbook_name: 'book.xlsx',
    workbook_size_bytes: 100,
    workbook_size: '100 B',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploaded_at: new Date().toISOString(),
    operator: 'user',
    status: 'uploaded',
    is_published: false,
    is_selectable: false,
    reporting_period_key: null,
    reporting_period_start: null,
    reporting_period_end: null,
    planning_state: 'uploaded',
    status_label: 'Uploaded',
    active_gate: 'Awaiting agent',
    progress_text: 'Awaiting agent',
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
    ...partial,
  };
}

describe('hasActiveIngestionSessionForPolling', () => {
  it('returns true when a session needs review', () => {
    expect(
      hasActiveIngestionSessionForPolling([session({ workflow_step_status: 'needs_review' })]),
    ).toBe(true);
  });

  it('returns false when all sessions are idle', () => {
    expect(
      hasActiveIngestionSessionForPolling([
        session({ status: 'published', workflow_step_status: 'completed' }),
      ]),
    ).toBe(false);
  });
});
