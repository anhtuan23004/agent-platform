import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type PmoReportStatusResponse, pmoApi } from '../../../../../src/modules/pmo/api/client';
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

  it('polls a queued workflow report and shows download only after completion', async () => {
    const completed: PmoReportStatusResponse = {
      reportRunId: '44444444-4444-4444-4444-444444444444',
      status: 'completed',
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
      outputFormat: 'pdf',
      summary: { memberCount: 2, overbookCount: 1, idleCount: 1, excludedWeekCount: 0 },
      findingCounts: { red: 1, yellow: 1, idle: 1, overbook: 1, mismatch: 0 },
      artifacts: {
        html: { available: true, sizeBytes: 100, sha256: 'a'.repeat(64), downloadUrl: null },
        pdf: {
          available: true,
          sizeBytes: 200,
          sha256: 'b'.repeat(64),
          downloadUrl: '/api/pmo/v1/reports/44444444-4444-4444-4444-444444444444/download',
        },
      },
      failure: null,
      retryAllowed: false,
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:01:00.000Z',
      completedAt: '2026-06-21T00:01:00.000Z',
    };
    vi.spyOn(pmoApi, 'getReport').mockResolvedValue(completed);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <PmoReportReviewPanel
          step={{
            step_no: 6,
            planner_step_id: 'pmo.planner.step.6.generate_report',
            action_id: 'generate_report',
            review_type: 'report',
            step_name: 'Generate PMO report',
            status: 'completed',
            description: '',
            output_summary: {
              status: 'queued',
              report_run_id: completed.reportRunId,
            },
          }}
          selectedReportApproval={null}
          reportApprovalsCount={0}
          isSubmittingReportDecision={false}
          confirmReportRange={vi.fn()}
          rejectReportRange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Report ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate report' })).not.toBeInTheDocument();
  });

  it('locks report generation while the PDF job is active', async () => {
    const active: PmoReportStatusResponse = {
      reportRunId: '44444444-4444-4444-4444-444444444444',
      status: 'rendering',
      dateRange: { from: '2026-06-01', to: '2026-06-30' },
      outputFormat: 'pdf',
      summary: null,
      findingCounts: null,
      artifacts: {
        html: { available: false, sizeBytes: null, sha256: null, downloadUrl: null },
        pdf: { available: false, sizeBytes: null, sha256: null, downloadUrl: null },
      },
      failure: null,
      retryAllowed: false,
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:01:00.000Z',
      completedAt: null,
    };
    vi.spyOn(pmoApi, 'getReport').mockResolvedValue(active);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <PmoReportReviewPanel
          step={{
            step_no: 6,
            planner_step_id: 'pmo.planner.step.6.generate_report',
            action_id: 'generate_report',
            review_type: 'report',
            step_name: 'Generate PMO report',
            status: 'completed',
            description: '',
            output_summary: { status: 'queued', report_run_id: active.reportRunId },
          }}
          selectedReportApproval={null}
          reportApprovalsCount={0}
          isSubmittingReportDecision={false}
          confirmReportRange={vi.fn()}
          rejectReportRange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: /Generating PDF/i })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Download PDF/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
  });
});
