import { requireApprovedCheckpoint } from './checkpoint-store.ts';
import type { ReviewCheckpointState } from './review-contracts.ts';

export function assertApprovedDependency(
  state: ReviewCheckpointState | undefined,
  stepId: string,
): void {
  requireApprovedCheckpoint(state, stepId);
}
