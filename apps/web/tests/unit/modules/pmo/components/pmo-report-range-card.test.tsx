import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowApprovalRow } from '../../../../../src/modules/pmo/api/workflow-runtime';
import { PmoReportReviewPanel } from '../../../../../src/modules/pmo/components/pmo-execution-step-card';

const approval: WorkflowApprovalRow = {
  approvalId: 'approval-1',
  runId: 'run-1',
  stepId: 'pmo.ingest.confirmReportRange',
  proposedPayload: {
    primary: {
      argsPatch: {
        dateRange: { from: '2026-06-01', to: '2026-06-30' },
        databaseDateBounds: { min: '2026-01-01', max: '2026-12-31' },
        rangeSource: 'sheet_or_database',
      },
    },
  },
  approverUserId: 'user-1',
  surfaceCanvas: true,
  surfaceChatThreadId: null,
  agentic: false,
  status: 'pending',
  decisionPayload: null,
  decidedAt: null,
  expiresAt: '2026-06-22T00:00:00.000Z',
  createdAt: '2026-06-21T00:00:00.000Z',
};

describe('PmoReportReviewPanel', () => {
  it('keeps date-range confirmation visible when suspended step has output summary', () => {
    render(
      <PmoReportReviewPanel
        step={{
          step_no: 6,
          planner_step_id: 'pmo.planner.step.6.generate_report',
          action_id: 'generate_report',
          review_type: 'report',
          step_name: 'Generate PMO report',
          status: 'in_progress',
          description: '',
          output_summary: {
            status: 'needs_range_confirmation',
            suggested_from: '2026-06-01',
            suggested_to: '2026-06-30',
          },
        }}
        selectedReportApproval={approval}
        reportApprovalsCount={1}
        isSubmittingReportDecision={false}
        confirmReportRange={vi.fn()}
        rejectReportRange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('From')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-06-30');
    expect(screen.getByRole('button', { name: 'Use sheet range' })).toBeInTheDocument();
  });
});
