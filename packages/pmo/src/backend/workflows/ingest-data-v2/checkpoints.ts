import { randomUUID } from 'node:crypto';
import type {
  ApprovedCheckpoint,
  ReviewAction,
  ReviewableStatus,
  ReviewCheckpointState,
  ToolProposal,
} from '../../ingestion/review-contracts.ts';

function cloneProposalBuckets(
  state: ReviewCheckpointState,
): Record<string, Array<ToolProposal<unknown>>> {
  return Object.fromEntries(
    Object.entries(state.review_proposals ?? {}).map(([stepId, proposals]) => [
      stepId,
      [...proposals],
    ]),
  );
}

function cloneCheckpointBuckets(
  state: ReviewCheckpointState,
): Record<string, Array<ApprovedCheckpoint<unknown>>> {
  return Object.fromEntries(
    Object.entries(state.approved_checkpoints ?? {}).map(([stepId, checkpoints]) => [
      stepId,
      [...checkpoints],
    ]),
  );
}

function nextProposalVersion(state: ReviewCheckpointState, stepId: string): number {
  const latest = getLatestProposal(state, stepId);
  return (latest?.version ?? 0) + 1;
}

export function createProposal<T>(params: {
  state: ReviewCheckpointState;
  stepId: string;
  proposal: T;
  status: ReviewableStatus;
  reviewRequired: boolean;
  nextAllowedActions: ReviewAction[];
  createdBy: string;
  createdAt?: string;
  proposalId?: string;
  sourceArtifactIds?: string[];
  metadata?: Record<string, unknown>;
}): ToolProposal<T> {
  return {
    proposal_id: params.proposalId ?? randomUUID(),
    step_id: params.stepId,
    version: nextProposalVersion(params.state, params.stepId),
    status: params.status,
    proposal: params.proposal,
    review_required: params.reviewRequired,
    next_allowed_actions: params.nextAllowedActions,
    created_at: params.createdAt ?? new Date().toISOString(),
    created_by: params.createdBy || 'agent',
    ...(params.sourceArtifactIds ? { source_artifact_ids: params.sourceArtifactIds } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function appendProposal<T>(
  state: ReviewCheckpointState,
  proposal: ToolProposal<T>,
): ReviewCheckpointState {
  const proposals = cloneProposalBuckets(state);
  proposals[proposal.step_id] = [...(proposals[proposal.step_id] ?? []), proposal];

  return {
    ...state,
    review_proposals: proposals,
    approved_checkpoints: cloneCheckpointBuckets(state),
  };
}

export function approveProposal<T>(params: {
  proposal: ToolProposal<unknown>;
  approvedOutput: T;
  approvedBy: string;
  userOverrides?: unknown[];
  approvedAt?: string;
  checkpointId?: string;
  metadata?: Record<string, unknown>;
}): ApprovedCheckpoint<T> {
  return {
    checkpoint_id: params.checkpointId ?? randomUUID(),
    proposal_id: params.proposal.proposal_id,
    step_id: params.proposal.step_id,
    version: params.proposal.version,
    approved_at: params.approvedAt ?? new Date().toISOString(),
    approved_by: params.approvedBy || 'system',
    approved_output: params.approvedOutput,
    user_overrides: params.userOverrides ?? [],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function appendCheckpoint<T>(
  state: ReviewCheckpointState,
  checkpoint: ApprovedCheckpoint<T>,
): ReviewCheckpointState {
  const checkpoints = cloneCheckpointBuckets(state);
  checkpoints[checkpoint.step_id] = [...(checkpoints[checkpoint.step_id] ?? []), checkpoint];

  return {
    ...state,
    review_proposals: cloneProposalBuckets(state),
    approved_checkpoints: checkpoints,
  };
}

export function getLatestProposal<T>(
  state: ReviewCheckpointState | undefined,
  stepId: string,
): ToolProposal<T> | null {
  const proposals = state?.review_proposals?.[stepId] ?? [];
  return (proposals[proposals.length - 1] as ToolProposal<T> | undefined) ?? null;
}

export function getLatestApprovedCheckpoint<T>(
  state: ReviewCheckpointState | undefined,
  stepId: string,
): ApprovedCheckpoint<T> | null {
  const checkpoints = state?.approved_checkpoints?.[stepId] ?? [];
  return (checkpoints[checkpoints.length - 1] as ApprovedCheckpoint<T> | undefined) ?? null;
}

export function requireApprovedCheckpoint<T>(
  state: ReviewCheckpointState | undefined,
  stepId: string,
): ApprovedCheckpoint<T> {
  const checkpoint = getLatestApprovedCheckpoint<T>(state, stepId);
  if (!checkpoint) {
    throw new Error(`approved_checkpoint_missing:${stepId}`);
  }
  return checkpoint;
}
