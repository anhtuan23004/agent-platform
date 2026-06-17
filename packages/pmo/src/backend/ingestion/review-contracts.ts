export type ReviewAction = 'approve' | 'modify' | 'upload_more' | 'rerun' | 'reject';

export type ReviewableStatus = 'needs_review' | 'completed' | 'failed';

export interface ToolProposal<T> {
  proposal_id: string;
  step_id: string;
  version: number;
  status: ReviewableStatus;
  proposal: T;
  review_required: boolean;
  next_allowed_actions: ReviewAction[];
  created_at: string;
  created_by: 'system' | 'agent' | string;
  source_artifact_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ApprovedCheckpoint<T> {
  checkpoint_id: string;
  proposal_id: string;
  step_id: string;
  version: number;
  approved_at: string;
  approved_by: string;
  approved_output: T;
  user_overrides: unknown[];
  metadata?: Record<string, unknown>;
}

export interface ReviewGateState<TProposal = unknown, TApproved = unknown> {
  step_id: string;
  latest_proposal?: ToolProposal<TProposal>;
  latest_approved_checkpoint?: ApprovedCheckpoint<TApproved>;
  proposal_history: Array<ToolProposal<TProposal>>;
  checkpoint_history: Array<ApprovedCheckpoint<TApproved>>;
}

export interface ReviewCheckpointState {
  review_proposals?: Record<string, Array<ToolProposal<unknown>>>;
  approved_checkpoints?: Record<string, Array<ApprovedCheckpoint<unknown>>>;
}
