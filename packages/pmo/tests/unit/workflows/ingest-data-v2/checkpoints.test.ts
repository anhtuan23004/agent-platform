import { describe, expect, it } from 'vitest';
import {
  appendCheckpoint,
  appendProposal,
  approveProposal,
  createProposal,
  getLatestApprovedCheckpoint,
  getLatestProposal,
  requireApprovedCheckpoint,
} from '../../../../src/backend/workflows/ingest-data-v2/checkpoints.ts';

describe('review checkpoint helpers', () => {
  it('appends proposal versions without mutating previous checkpoint history', () => {
    const firstProposal = createProposal({
      state: {},
      stepId: 'column_mapping',
      proposal: { value: 'v1' },
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'modify'],
      createdBy: 'agent',
      createdAt: '2026-06-17T00:00:00.000Z',
      proposalId: 'proposal-1',
    });
    const firstState = appendProposal({}, firstProposal);
    const firstCheckpoint = approveProposal({
      proposal: firstProposal,
      approvedOutput: { value: 'approved-v1' },
      approvedBy: 'user-1',
      approvedAt: '2026-06-17T00:01:00.000Z',
      checkpointId: 'checkpoint-1',
    });
    const approvedState = appendCheckpoint(firstState, firstCheckpoint);
    const secondProposal = createProposal({
      state: approvedState,
      stepId: 'column_mapping',
      proposal: { value: 'v2' },
      status: 'needs_review',
      reviewRequired: true,
      nextAllowedActions: ['approve', 'modify'],
      createdBy: 'agent',
      createdAt: '2026-06-17T00:02:00.000Z',
      proposalId: 'proposal-2',
    });
    const secondState = appendProposal(approvedState, secondProposal);

    expect(firstProposal.version).toBe(1);
    expect(secondProposal.version).toBe(2);
    expect(getLatestProposal(secondState, 'column_mapping')?.proposal_id).toBe('proposal-2');
    expect(getLatestApprovedCheckpoint(secondState, 'column_mapping')?.checkpoint_id).toBe(
      'checkpoint-1',
    );
    expect(secondState.approved_checkpoints?.column_mapping).toHaveLength(1);
  });

  it('throws a deterministic error when an approved checkpoint is missing', () => {
    expect(() => requireApprovedCheckpoint({}, 'column_mapping')).toThrow(
      'approved_checkpoint_missing:column_mapping',
    );
  });
});
