import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { decidedStepTitle, isPmoIngestApproval } from './decided-approval.ts';

export type ApprovalStatusOverride = Pick<
  WorkflowApprovalRow,
  'status' | 'decisionPayload' | 'decidedAt'
>;

export function isDecidedApprovalStatus(status: WorkflowApprovalRow['status']): boolean {
  return status !== 'pending';
}

function mergeApprovalOverride(
  approval: WorkflowApprovalRow,
  override: ApprovalStatusOverride | undefined,
): WorkflowApprovalRow {
  if (!override) return approval;
  return { ...approval, ...override };
}

function sortByCreatedAt(approvals: WorkflowApprovalRow[]): WorkflowApprovalRow[] {
  return [...approvals].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function partitionThreadApprovals(
  approvals: WorkflowApprovalRow[],
  overrides: ReadonlyMap<string, ApprovalStatusOverride>,
): {
  pmoDecided: WorkflowApprovalRow[];
  pending: WorkflowApprovalRow[];
  otherDecided: WorkflowApprovalRow[];
} {
  const pmoDecided: WorkflowApprovalRow[] = [];
  const pending: WorkflowApprovalRow[] = [];
  const otherDecided: WorkflowApprovalRow[] = [];

  for (const approval of approvals) {
    const merged = mergeApprovalOverride(approval, overrides.get(approval.approvalId));
    if (!isDecidedApprovalStatus(merged.status)) {
      pending.push(merged);
      continue;
    }
    if (isPmoIngestApproval(merged)) {
      pmoDecided.push(merged);
      continue;
    }
    otherDecided.push(merged);
  }

  return {
    pmoDecided: sortByCreatedAt(pmoDecided),
    pending,
    otherDecided: sortByCreatedAt(otherDecided),
  };
}

export function pmoHistorySummary(approvals: WorkflowApprovalRow[]): {
  title: string;
  hint: string;
} {
  const count = approvals.length;
  const stepTitles = approvals
    .map((approval) => decidedStepTitle(approval.proposedPayload))
    .filter((title): title is string => Boolean(title));

  const title = `${count} review step${count === 1 ? '' : 's'} completed`;
  if (stepTitles.length === 0) {
    return { title, hint: 'Open to view each step.' };
  }

  const latest = stepTitles[stepTitles.length - 1];
  if (count === 1) {
    return { title, hint: latest ?? 'Open to view details.' };
  }

  return {
    title,
    hint: latest ? `Latest: ${latest}` : stepTitles.join(' → '),
  };
}
