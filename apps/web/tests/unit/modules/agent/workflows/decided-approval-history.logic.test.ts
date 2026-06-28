import { describe, expect, it } from 'vitest';
import { WorkflowApprovalRow } from '../../../../../src/modules/agent/workflows/api/schemas';
import {
  partitionThreadApprovals,
  pmoHistorySummary,
} from '../../../../../src/modules/agent/workflows/components/decided-approval-history.logic';

function approval(
  overrides: Partial<WorkflowApprovalRow> & Pick<WorkflowApprovalRow, 'approvalId'>,
): WorkflowApprovalRow {
  return WorkflowApprovalRow.parse({
    runId: 'run-1',
    stepId: 'step-1',
    approverUserId: 'user-1',
    surfaceCanvas: true,
    surfaceChatThreadId: 'thread-1',
    agentic: true,
    status: 'approved',
    proposedPayload: {
      meta: { toolId: 'pmo_confirmMapping' },
      summary: 'Mapping ready.',
    },
    decisionPayload: { decision: 'approve' },
    decidedAt: '2026-06-22T10:00:00.000Z',
    expiresAt: '2026-06-23T00:00:00.000Z',
    createdAt: '2026-06-22T09:00:00.000Z',
    ...overrides,
  });
}

describe('partitionThreadApprovals', () => {
  it('groups decided PMO ingest steps separately from pending and other decided rows', () => {
    const rows = [
      approval({
        approvalId: 'a1',
        createdAt: '2026-06-22T09:00:00.000Z',
        proposedPayload: { meta: { toolId: 'pmo_profileWorkbook' } },
      }),
      approval({
        approvalId: 'a2',
        status: 'pending',
        createdAt: '2026-06-22T10:00:00.000Z',
        proposedPayload: { meta: { toolId: 'pmo_confirmMapping' } },
      }),
      approval({
        approvalId: 'a3',
        createdAt: '2026-06-22T08:00:00.000Z',
        proposedPayload: { intent: 'Assign task' },
      }),
    ];

    const partitioned = partitionThreadApprovals(rows, new Map());

    expect(partitioned.pmoDecided.map((row) => row.approvalId)).toEqual(['a1']);
    expect(partitioned.pending.map((row) => row.approvalId)).toEqual(['a2']);
    expect(partitioned.otherDecided.map((row) => row.approvalId)).toEqual(['a3']);
  });

  it('applies optimistic overrides before partitioning', () => {
    const rows = [
      approval({
        approvalId: 'a1',
        status: 'pending',
        proposedPayload: { meta: { toolId: 'pmo_confirmPublish' } },
      }),
    ];
    const overrides = new Map([
      [
        'a1',
        {
          status: 'approved' as const,
          decisionPayload: { decision: 'approve' },
          decidedAt: '2026-06-22T11:00:00.000Z',
        },
      ],
    ]);

    const partitioned = partitionThreadApprovals(rows, overrides);

    expect(partitioned.pending).toHaveLength(0);
    expect(partitioned.pmoDecided.map((row) => row.approvalId)).toEqual(['a1']);
  });
});

describe('pmoHistorySummary', () => {
  it('summarizes multiple completed steps in one line', () => {
    const summary = pmoHistorySummary([
      approval({
        approvalId: 'a1',
        proposedPayload: { meta: { toolId: 'pmo_profileWorkbook' } },
      }),
      approval({
        approvalId: 'a2',
        proposedPayload: { meta: { toolId: 'pmo_confirmPublish' } },
      }),
    ]);

    expect(summary.title).toBe('2 review steps completed');
    expect(summary.hint).toBe('Latest: Publish Review');
  });
});
