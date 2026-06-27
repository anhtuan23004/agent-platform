/**
 * Drawer adapter for the Publish Review step.
 * Parses the approval payload into a PublishReviewViewModel and renders
 * the interactive PmoPublishReviewPanel inside the drawer.
 */

import { PmoPublishReviewPanel } from '../../../../pmo/components/pmo-publish-review-panel';
import { usePmoPublishReviewActions } from '../../../../pmo/hooks/use-pmo-publish-review-actions';
import { parsePublishReviewView } from '../../../../pmo/pages/pmo-page.logic';
import type { WorkflowApprovalRow } from '../../api/schemas';

export function DrawerPublish({
  approval,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  onDecisionComplete: () => Promise<void> | void;
}) {
  const view = parsePublishReviewView(approval);

  const { isSubmittingPublishDecision, approvePublish, rejectPublish } = usePmoPublishReviewActions(
    {
      selectedPublishApproval: approval,
      onDecisionComplete,
    },
  );

  if (!view) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
        Could not parse publish data from this approval.
      </div>
    );
  }

  return (
    <PmoPublishReviewPanel
      selectedPublishApproval={approval}
      publishApprovalsCount={1}
      selectedPublishView={view}
      isSubmittingPublishDecision={isSubmittingPublishDecision}
      approvePublish={approvePublish}
      rejectPublish={rejectPublish}
    />
  );
}
