import { parsePublishReviewView } from '../../../pmo/pages/pmo-page.logic.ts';
import type { WorkflowApprovalRow } from '../api/schemas.ts';

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
  return 'w-full max-w-none overflow-y-auto sm:w-[min(96vw,1200px)]';
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

  if (toolId === 'pmo_confirmPublish') {
    const view = parsePublishReviewView(approval);
    if (!view?.canApprove) {
      return {
        allowed: false,
        hint: 'Open publish review to resolve blocking issues.',
      };
    }
  }

  return { allowed: true };
}
