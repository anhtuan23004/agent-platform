import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PmoPlanningSession } from '../../../../../src/modules/pmo/api/client';
import { PmoSessionHistoryPanel } from '../../../../../src/modules/pmo/components/pmo-session-history-panel';

function session(id: string): PmoPlanningSession {
  return {
    ingestion_session_id: id,
    source_kind: 'workbook',
    workbook_name: `${id}.xlsx`,
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
  };
}

describe('PmoSessionHistoryPanel', () => {
  it('shows generating state only on active session row', () => {
    render(
      <PmoSessionHistoryPanel
        sessions={[session('run-1'), session('run-2')]}
        selectedSessionId={null}
        isLoadingSessions={false}
        isCancellingWorkflowBySessionId={{}}
        generatingSessionId="run-2"
        isWorkflowCancelable={() => true}
        isSessionGeneratable={() => true}
        onSelectSession={vi.fn()}
        onViewSession={vi.fn()}
        onGeneratePlan={vi.fn()}
        onCancelWorkflow={vi.fn()}
      />,
    );

    const idleRowButton = screen.getByRole('button', { name: 'Generate' });
    expect(idleRowButton).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Generating...' })).toHaveLength(1);
  });
});
