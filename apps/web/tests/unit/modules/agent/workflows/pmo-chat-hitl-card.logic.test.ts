import { describe, expect, it } from 'vitest';
import { WorkflowApprovalRow } from '../../../../../src/modules/agent/workflows/api/schemas';
import {
  canQuickApprovePmoHitlCard,
  pmoReviewDetailsLabel,
} from '../../../../../src/modules/agent/workflows/components/pmo-chat-hitl-card.logic';

function approval(proposedPayload: WorkflowApprovalRow['proposedPayload']): WorkflowApprovalRow {
  return WorkflowApprovalRow.parse({
    approvalId: 'approval-1',
    runId: 'run-1',
    stepId: 'pmo.ingest.reviewChanges',
    approverUserId: 'user-1',
    surfaceCanvas: true,
    surfaceChatThreadId: null,
    agentic: false,
    status: 'pending',
    proposedPayload,
    decisionPayload: null,
    decidedAt: null,
    expiresAt: '2026-06-22T00:00:00.000Z',
    createdAt: '2026-06-21T00:00:00.000Z',
  });
}

describe('pmoReviewDetailsLabel', () => {
  it('uses Review & edit for drawer-required steps', () => {
    expect(pmoReviewDetailsLabel('pmo_confirmMapping')).toBe('Review & edit');
    expect(pmoReviewDetailsLabel('pmo_confirmPublish')).toBe('Review details');
  });
});

describe('canQuickApprovePmoHitlCard', () => {
  it('blocks quick approve for mapping, normalization, profiling, and report steps', () => {
    for (const toolId of [
      'pmo_confirmMapping',
      'pmo_reviewNormalization',
      'pmo_profileWorkbook',
      'pmo_confirmReportRange',
    ]) {
      const result = canQuickApprovePmoHitlCard({
        toolId,
        approval: approval({
          primary: { label: 'Approve', argsPatch: { decision: 'approve' } },
        }),
      });
      expect(result.allowed).toBe(false);
      expect(result.hint).toBeTruthy();
    }
  });

  it('allows quick approve for publish when payload approves and view is clean', () => {
    const result = canQuickApprovePmoHitlCard({
      toolId: 'pmo_confirmPublish',
      approval: approval({
        summary: 'Ready to publish 12 change(s).',
        primary: { label: 'Approve publish', argsPatch: { decision: 'approve' } },
        decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
        details: [
          {
            kind: 'kvTable',
            rows: [
              { k: 'Rows to publish', v: '12' },
              { k: 'Blocking issues', v: '0' },
            ],
          },
        ],
        meta: { toolId: 'pmo_confirmPublish', actionId: 'publish_after_approval' },
      }),
    });

    expect(result.allowed).toBe(true);
  });

  it('blocks quick approve when primary action is reject-only', () => {
    const result = canQuickApprovePmoHitlCard({
      toolId: 'pmo_confirmPublish',
      approval: approval({
        primary: { label: 'Reject blocked publish', argsPatch: { decision: 'reject' } },
        decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
        details: [],
        meta: { toolId: 'pmo_confirmPublish' },
      }),
    });

    expect(result.allowed).toBe(false);
  });

  it('blocks quick approve when validation status is blocked', () => {
    const result = canQuickApprovePmoHitlCard({
      toolId: 'pmo_confirmPublish',
      validationStatus: 'blocked',
      approval: approval({
        primary: { label: 'Approve publish', argsPatch: { decision: 'approve' } },
        details: [],
      }),
    });

    expect(result.allowed).toBe(false);
  });
});
