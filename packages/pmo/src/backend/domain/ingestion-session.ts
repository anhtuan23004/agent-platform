// ── Ingestion Session State Machine ──────────────────────────────────────────
// Enforces valid state transitions for ingestion sessions.

export type IngestionStatus =
  | 'uploaded'
  | 'profiling'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'normalizing'
  | 'awaiting_normalization_review'
  | 'staging_normalized'
  | 'awaiting_publish_review'
  | 'reviewed'
  | 'published'
  | 'failed'
  | 'rejected';

const VALID_TRANSITIONS: Record<IngestionStatus, IngestionStatus[]> = {
  uploaded: ['profiling'],
  profiling: ['awaiting_confirmation', 'confirmed', 'failed'],
  awaiting_confirmation: ['confirmed', 'rejected'],
  confirmed: ['normalizing'],
  normalizing: ['awaiting_normalization_review', 'staging_normalized', 'failed'],
  awaiting_normalization_review: ['staging_normalized', 'rejected', 'failed'],
  staging_normalized: ['awaiting_publish_review'],
  awaiting_publish_review: ['reviewed', 'published', 'rejected'],
  reviewed: [],
  published: [],
  failed: [],
  rejected: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: IngestionStatus,
    public readonly to: IngestionStatus,
  ) {
    super(`Invalid transition: '${from}' → '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertValidTransition(from: IngestionStatus, to: IngestionStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminalStatus(status: IngestionStatus): boolean {
  return VALID_TRANSITIONS[status]?.length === 0;
}

export function getAllowedTransitions(status: IngestionStatus): IngestionStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}
