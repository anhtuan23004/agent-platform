import { describe, expect, it } from 'vitest';
import { WorkflowApprovalRow } from '../../../../../src/modules/agent/workflows/api/schemas';
import {
  nextPmoIngestStepLabel,
  resolvePmoStepTransition,
} from '../../../../../src/modules/agent/workflows/components/pmo-step-transition.logic';

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
      meta: { toolId: 'pmo_profileWorkbook' },
      summary: 'Profiling complete.',
    },
    decisionPayload: { decision: 'approve' },
    decidedAt: '2026-06-22T10:00:00.000Z',
    expiresAt: '2026-06-23T00:00:00.000Z',
    createdAt: '2026-06-22T09:00:00.000Z',
    ...overrides,
  });
}

describe('nextPmoIngestStepLabel', () => {
  it('returns the next step label in ingest order', () => {
    expect(nextPmoIngestStepLabel('pmo_profileWorkbook')).toBe('Column Mapping');
    expect(nextPmoIngestStepLabel('pmo_confirmMapping')).toBe('Normalization Review');
  });

  it('returns null after the final step', () => {
    expect(nextPmoIngestStepLabel('pmo_confirmReportRange')).toBeNull();
  });
});

describe('resolvePmoStepTransition', () => {
  const now = new Date('2026-06-22T10:00:05.000Z').getTime();

  it('shows a transition card after a PMO step completes and before the next pending card', () => {
    const state = resolvePmoStepTransition({
      pmoDecided: [approval({ approvalId: 'a1' })],
      pending: [],
      threadIsRunning: true,
      now,
    });

    expect(state).toEqual({
      lastStepLabel: 'Workbook Profiling',
      nextStepLabel: 'Column Mapping',
    });
  });

  it('hides the transition card when a pending PMO approval already exists', () => {
    const state = resolvePmoStepTransition({
      pmoDecided: [approval({ approvalId: 'a1' })],
      pending: [
        approval({
          approvalId: 'a2',
          status: 'pending',
          proposedPayload: { meta: { toolId: 'pmo_confirmMapping' } },
        }),
      ],
      threadIsRunning: true,
      now,
    });

    expect(state).toBeNull();
  });

  it('hides stale transitions once recent activity and agent run have ended', () => {
    const state = resolvePmoStepTransition({
      pmoDecided: [
        approval({
          approvalId: 'a1',
          decidedAt: '2026-06-22T09:00:00.000Z',
        }),
      ],
      pending: [],
      threadIsRunning: false,
      now,
    });

    expect(state).toBeNull();
  });
});
