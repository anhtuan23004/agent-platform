import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { cardToolId } from './decided-approval.ts';

/** Steps that require the review drawer for inspect/edit before approval. */
export const PMO_DRAWER_REQUIRED_TOOL_IDS = new Set([
  'pmo_profileWorkbook',
  'pmo_confirmMapping',
  'pmo_reviewNormalization',
  'pmo_confirmReportRange',
]);

function payloadPrimaryApproves(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const primary = (payload as { primary?: unknown }).primary;
  if (!primary || typeof primary !== 'object') return false;
  const argsPatch = (primary as { argsPatch?: unknown }).argsPatch;
  if (!argsPatch || typeof argsPatch !== 'object') return false;
  return (argsPatch as { decision?: unknown }).decision === 'approve';
}

export function pmoReviewDrawerClassName(): string {
  return 'flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:w-[min(94vw,1440px)]';
}

export function pmoReviewDrawerOverlayClassName(): string {
  return 'bg-semantic-overlay/75 backdrop-blur-sm';
}

/** Keeps the review drawer on the same step while agentic mapping emits a new pending approval per item. */
export function resolveLiveDrawerApproval(
  approvals: WorkflowApprovalRow[],
  anchor: { approvalId: string; stepType: string },
): WorkflowApprovalRow | null {
  const toolId =
    anchor.stepType ||
    cardToolId(approvals.find((a) => a.approvalId === anchor.approvalId)?.proposedPayload) ||
    null;

  if (toolId) {
    const pendingSameStep = approvals
      .filter((a) => a.status === 'pending' && cardToolId(a.proposedPayload) === toolId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (pendingSameStep.length > 0) {
      return pendingSameStep[0] ?? null;
    }
  }

  return approvals.find((a) => a.approvalId === anchor.approvalId) ?? null;
}

export function pmoReviewDetailsLabel(toolId: string): string {
  return PMO_DRAWER_REQUIRED_TOOL_IDS.has(toolId) ? 'Review & edit' : 'Review details';
}

export function canQuickApprovePmoHitlCard(params: {
  toolId: string;
  approval: WorkflowApprovalRow;
  validationStatus?: string;
}): { allowed: boolean; hint?: string } {
  const { toolId, approval, validationStatus } = params;

  if (PMO_DRAWER_REQUIRED_TOOL_IDS.has(toolId)) {
    return {
      allowed: false,
      hint: 'Open review to inspect and edit before approving.',
    };
  }

  if (validationStatus === 'blocked') {
    return {
      allowed: false,
      hint: 'Validation is blocked. Open review to resolve issues first.',
    };
  }

  if (!payloadPrimaryApproves(approval.proposedPayload)) {
    return {
      allowed: false,
      hint: 'Approval is blocked until issues are resolved in review.',
    };
  }

  return { allowed: true };
}
