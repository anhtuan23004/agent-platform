/**
 * Drawer adapter for the Normalization Review step.
 * Parses the approval payload into a NormalizationReviewViewModel and renders
 * the interactive PmoNormalizationReviewPanel inside the drawer.
 */

import { PmoNormalizationReviewPanel } from '../../../../pmo/components/pmo-normalization-review-panel';
import { usePmoNormalizationReviewActions } from '../../../../pmo/hooks/use-pmo-normalization-review-actions';
import { parseNormalizationReviewView } from '../../../../pmo/pages/pmo-page.logic';
import type { WorkflowApprovalRow } from '../../api/schemas';

export function DrawerNormalization({
  approval,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  onDecisionComplete: () => Promise<void> | void;
}) {
  const baseView = parseNormalizationReviewView(approval);

  const {
    normalizationReviewView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  } = usePmoNormalizationReviewActions({
    selectedNormalizationApproval: approval,
    selectedNormalizationView: baseView,
    onDecisionComplete,
  });

  if (!baseView) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
        Could not parse normalization data from this approval.
      </div>
    );
  }

  return (
    <PmoNormalizationReviewPanel
      selectedNormalizationApproval={approval}
      normalizationApprovalsCount={1}
      selectedNormalizationView={normalizationReviewView}
      memberAdditionDrafts={memberAdditionDrafts}
      canApproveNormalization={canApproveNormalization}
      isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
      updateMemberAdditionDraft={updateMemberAdditionDraft}
      updateNormalizationRowDecision={updateNormalizationRowDecision}
      updateNormalizationRowValue={updateNormalizationRowValue}
      resetNormalizationRowOverrides={resetNormalizationRowOverrides}
      approveNormalization={approveNormalization}
      rejectNormalization={rejectNormalization}
    />
  );
}
