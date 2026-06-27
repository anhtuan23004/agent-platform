import { describe, expect, it } from 'vitest';
import type { WorkflowApprovalRow } from '../../../../../src/modules/pmo/api/workflow-runtime';
import {
  findLatestApprovalByAction,
  mergeSessionApprovals,
} from '../../../../../src/modules/pmo/pages/pmo-page.logic';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

function approval(
  partial: Partial<WorkflowApprovalRow> & Pick<WorkflowApprovalRow, 'approvalId' | 'runId'>,
): WorkflowApprovalRow {
  return {
    stepId: 'chat-hitl',
    proposedPayload: {
      meta: { toolId: 'pmo_confirmMapping', actionId: 'column_mapping' },
      details: [{ kind: 'kvTable', rows: [{ k: 'Ingestion session', v: SESSION_A }] }],
    },
    approverUserId: 'user-1',
    surfaceCanvas: false,
    surfaceChatThreadId: 'thread-1',
    agentic: true,
    status: 'approved',
    decisionPayload: { decision: 'approve' },
    decidedAt: '2026-06-22T10:00:00.000Z',
    expiresAt: '2026-06-23T00:00:00.000Z',
    createdAt: '2026-06-22T09:00:00.000Z',
    ...partial,
  };
}

describe('mergeSessionApprovals', () => {
  it('keeps approvals from every run id tied to the same ingestion session', () => {
    const merged = mergeSessionApprovals(
      [
        approval({
          approvalId: 'a1',
          runId: 'run-profiling',
          createdAt: '2026-06-22T09:00:00.000Z',
          proposedPayload: {
            meta: { toolId: 'pmo_profileWorkbook', actionId: 'workbook_profiling' },
            details: [{ kind: 'kvTable', rows: [{ k: 'Ingestion session', v: SESSION_A }] }],
          },
        }),
        approval({
          approvalId: 'a2',
          runId: 'run-mapping',
          createdAt: '2026-06-22T10:00:00.000Z',
        }),
        approval({
          approvalId: 'b1',
          runId: 'run-other-session',
          proposedPayload: {
            meta: { toolId: 'pmo_confirmMapping', actionId: 'column_mapping' },
            details: [{ kind: 'kvTable', rows: [{ k: 'Ingestion session', v: SESSION_B }] }],
          },
        }),
      ],
      SESSION_A,
      ['run-profiling', 'run-mapping'],
    );

    expect(merged.map((row) => row.approvalId)).toEqual(['a1', 'a2']);
  });
});

describe('findLatestApprovalByAction', () => {
  it('returns the newest approval when a step was reviewed more than once', () => {
    const latest = findLatestApprovalByAction(
      [
        approval({
          approvalId: 'old',
          runId: 'run-1',
          createdAt: '2026-06-22T09:00:00.000Z',
        }),
        approval({
          approvalId: 'new',
          runId: 'run-2',
          createdAt: '2026-06-22T11:00:00.000Z',
        }),
      ],
      'column_mapping',
    );

    expect(latest?.approvalId).toBe('new');
    expect(latest?.runId).toBe('run-2');
  });
});
