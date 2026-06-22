import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowApprovalRow } from '../../../../../src/modules/pmo/api/workflow-runtime';
import { PmoPublishReviewPanel } from '../../../../../src/modules/pmo/components/pmo-publish-review-panel';
import { parsePublishReviewView } from '../../../../../src/modules/pmo/pages/pmo-page.logic';

function buildApproval(
  overrides: Partial<WorkflowApprovalRow> & {
    proposedPayload: WorkflowApprovalRow['proposedPayload'];
  },
): WorkflowApprovalRow {
  return {
    approvalId: 'approval-1',
    runId: 'run-1',
    stepId: 'pmo.ingest.reviewChanges',
    approverUserId: 'user-1',
    surfaceCanvas: true,
    surfaceChatThreadId: null,
    agentic: false,
    status: 'pending',
    decisionPayload: null,
    decidedAt: null,
    expiresAt: '2026-06-22T00:00:00.000Z',
    createdAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

const previewPayload = {
  summary:
    'Review complete for 12 proposed change(s). 3 unchanged row(s) would be skipped. No canonical PMO data will be written.',
  primary: { label: 'Complete review', argsPatch: { decision: 'approve' } },
  decline: { label: 'Reject review', argsPatch: { decision: 'reject' } },
  details: [
    {
      kind: 'kvTable',
      rows: [
        { k: 'Proposed row changes', v: '12' },
        { k: 'Rows to skip', v: '3' },
        { k: 'New rows', v: '10' },
        { k: 'Rows to overwrite', v: '2' },
        { k: 'Blocking issues', v: '0' },
      ],
    },
    {
      kind: 'kvTable',
      rows: [{ k: 'allocation', v: 'publish=12|skip_existing=3|new=10|overwrite=2' }],
    },
  ],
  meta: {
    toolId: 'pmo_confirmPublish',
    actionId: 'database_change_summary',
    willPublish: false,
  },
};

const publishPayload = {
  summary: 'Ready to publish 12 change(s). 3 unchanged row(s) will be skipped.',
  primary: { label: 'Approve publish', argsPatch: { decision: 'approve' } },
  decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
  details: [
    {
      kind: 'kvTable',
      rows: [
        { k: 'Rows to publish', v: '12' },
        { k: 'Rows to skip', v: '3' },
        { k: 'New rows', v: '10' },
        { k: 'Rows to overwrite', v: '2' },
        { k: 'Blocking issues', v: '0' },
      ],
    },
    {
      kind: 'kvTable',
      rows: [{ k: 'allocation', v: 'publish=12|skip_existing=3|new=10|overwrite=2' }],
    },
  ],
  meta: {
    toolId: 'pmo_confirmPublish',
    actionId: 'publish_after_approval',
    willPublish: true,
  },
};

describe('parsePublishReviewView', () => {
  it('marks preview-only database change summaries as non-publish', () => {
    const view = parsePublishReviewView(
      buildApproval({ proposedPayload: previewPayload, status: 'pending' }),
    );

    expect(view?.willPublish).toBe(false);
    expect(view?.primaryLabel).toBe('Complete review');
  });

  it('marks publish-after-approval cards as publish', () => {
    const view = parsePublishReviewView(
      buildApproval({ proposedPayload: publishPayload, status: 'pending' }),
    );

    expect(view?.willPublish).toBe(true);
    expect(view?.primaryLabel).toBe('Approve publish');
  });
});

describe('PmoPublishReviewPanel', () => {
  it('shows staging preview labels for preview-only completed reviews', () => {
    const approval = buildApproval({
      proposedPayload: previewPayload,
      status: 'approved',
    });
    const view = parsePublishReviewView(approval);

    render(
      <PmoPublishReviewPanel
        readOnly
        selectedPublishApproval={approval}
        publishApprovalsCount={1}
        selectedPublishView={view}
        isSubmittingPublishDecision={false}
        approvePublish={vi.fn()}
        rejectPublish={vi.fn()}
      />,
    );

    expect(screen.getByText('Staging preview')).toBeInTheDocument();
    expect(
      screen.getByText(/preview only, no canonical PMO data was written/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Publish review is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready to publish')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).not.toBeInTheDocument();
  });

  it('shows publish approval actions for pending publish reviews', () => {
    const approval = buildApproval({
      proposedPayload: publishPayload,
      status: 'pending',
    });
    const view = parsePublishReviewView(approval);

    render(
      <PmoPublishReviewPanel
        selectedPublishApproval={approval}
        publishApprovalsCount={1}
        selectedPublishView={view}
        isSubmittingPublishDecision={false}
        approvePublish={vi.fn()}
        rejectPublish={vi.fn()}
      />,
    );

    expect(screen.getByText('Publish review is required')).toBeInTheDocument();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve publish' })).toBeInTheDocument();
  });
});
