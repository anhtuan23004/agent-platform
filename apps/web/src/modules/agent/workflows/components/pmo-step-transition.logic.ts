import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { cardToolId, decidedStepTitle, isPmoIngestApproval } from './decided-approval.ts';

/** Canonical PMO ingest HITL order in the chat workflow. */
export const PMO_INGEST_TOOL_ORDER = [
  'pmo_profileWorkbook',
  'pmo_confirmMapping',
  'pmo_reviewNormalization',
  'pmo_confirmPublish',
  'pmo_confirmReportRange',
] as const;

const PMO_STEP_LABELS: Record<(typeof PMO_INGEST_TOOL_ORDER)[number], string> = {
  pmo_profileWorkbook: 'Workbook Profiling',
  pmo_confirmMapping: 'Column Mapping',
  pmo_reviewNormalization: 'Normalization Review',
  pmo_confirmPublish: 'Publish Review',
  pmo_confirmReportRange: 'Report Configuration',
};

export const PMO_STEP_TRANSITION_RECENT_MS = 30_000;

export interface PmoStepTransitionState {
  lastStepLabel: string | null;
  nextStepLabel: string | null;
}

export function nextPmoIngestStepLabel(completedToolId: string | null): string | null {
  if (!completedToolId) return null;
  const index = PMO_INGEST_TOOL_ORDER.indexOf(
    completedToolId as (typeof PMO_INGEST_TOOL_ORDER)[number],
  );
  if (index < 0 || index >= PMO_INGEST_TOOL_ORDER.length - 1) return null;
  const nextToolId = PMO_INGEST_TOOL_ORDER[index + 1];
  if (!nextToolId) return null;
  return PMO_STEP_LABELS[nextToolId] ?? null;
}

function latestPmoDecidedApproval(
  approvals: readonly WorkflowApprovalRow[],
): WorkflowApprovalRow | null {
  if (approvals.length === 0) return null;
  return (
    [...approvals].sort((left, right) => {
      const leftTime = new Date(left.decidedAt ?? left.createdAt).getTime();
      const rightTime = new Date(right.decidedAt ?? right.createdAt).getTime();
      return rightTime - leftTime;
    })[0] ?? null
  );
}

/** Show a processing card while the agent moves from one PMO HITL step to the next. */
export function resolvePmoStepTransition(params: {
  pmoDecided: readonly WorkflowApprovalRow[];
  pending: readonly WorkflowApprovalRow[];
  threadIsRunning: boolean;
  isFetchingApprovals?: boolean;
  now?: number;
}): PmoStepTransitionState | null {
  const pendingPmo = params.pending.filter((approval) => isPmoIngestApproval(approval));
  if (pendingPmo.length > 0) return null;
  if (params.pmoDecided.length === 0) return null;

  const latest = latestPmoDecidedApproval(params.pmoDecided);
  if (!latest) return null;
  if (latest.status === 'rejected') return null;

  const lastToolId = cardToolId(latest.proposedPayload);
  const lastStepLabel = decidedStepTitle(latest.proposedPayload);
  const nextStepLabel = nextPmoIngestStepLabel(lastToolId);

  const now = params.now ?? Date.now();
  const lastActivity = new Date(latest.decidedAt ?? latest.createdAt).getTime();
  const recent = now - lastActivity < PMO_STEP_TRANSITION_RECENT_MS;
  const waitingForNextApproval =
    params.isFetchingApprovals === true && now - lastActivity < PMO_STEP_TRANSITION_RECENT_MS * 2;

  if (!recent && !waitingForNextApproval && !params.threadIsRunning) {
    return null;
  }

  if (!nextStepLabel && !params.threadIsRunning) {
    return null;
  }

  return { lastStepLabel, nextStepLabel };
}
