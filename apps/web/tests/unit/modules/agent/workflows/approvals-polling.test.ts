import { describe, expect, it } from 'vitest';
import {
  type WorkflowApprovalRow,
  WorkflowApprovalRow as WorkflowApprovalRowSchema,
} from '../../../../../src/modules/agent/workflows/api/schemas.ts';
import {
  pendingApprovalsRefetchInterval,
  threadApprovalsRefetchInterval,
} from '../../../../../src/modules/agent/workflows/hooks/approvals-polling.ts';

function approval(
  partial: Partial<WorkflowApprovalRow> & Pick<WorkflowApprovalRow, 'status'>,
): WorkflowApprovalRow {
  return WorkflowApprovalRowSchema.parse({
    approvalId: 'a1',
    runId: 'r1',
    stepId: 's1',
    proposedPayload: {},
    approverUserId: 'u1',
    surfaceCanvas: false,
    surfaceChatThreadId: null,
    agentic: false,
    decisionPayload: null,
    decidedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...partial,
  });
}

describe('approvals polling', () => {
  it('polls thread approvals while any row is pending', () => {
    expect(
      threadApprovalsRefetchInterval([
        approval({ status: 'approved', decidedAt: new Date().toISOString() }),
        approval({ approvalId: 'a2', status: 'pending' }),
      ]),
    ).toBe(4_000);
  });

  it('stops thread polling after recent activity window', () => {
    const stale = new Date(Date.now() - 60_000).toISOString();
    expect(
      threadApprovalsRefetchInterval([
        approval({
          status: 'approved',
          createdAt: stale,
          decidedAt: stale,
        }),
      ]),
    ).toBe(false);
  });

  it('polls pending inbox only while open approvals exist', () => {
    expect(pendingApprovalsRefetchInterval([approval({ status: 'pending' })])).toBe(5_000);
    expect(
      pendingApprovalsRefetchInterval([
        approval({ status: 'approved', decidedAt: new Date().toISOString() }),
      ]),
    ).toBe(false);
  });
});
