import { toast } from '@seta/shared-ui';
import { useCallback, useMemo, useState } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

interface UsePmoPublishReviewActionsOptions {
  selectedPublishApproval: WorkflowApprovalRow | null;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  refreshWorkflowRuntime: () => Promise<unknown>;
}

interface UsePmoPublishReviewActionsResult {
  isSubmittingPublishDecision: boolean;
  approvePublish: () => void;
  rejectPublish: () => void;
}

export function usePmoPublishReviewActions(
  options: UsePmoPublishReviewActionsOptions,
): UsePmoPublishReviewActionsResult {
  const { selectedPublishApproval, loadSessions, refreshWorkflowRuntime } = options;
  const submitDecision = useSubmitWorkflowRuntimeDecision();
  const [lockedApprovalIds, setLockedApprovalIds] = useState<Set<string>>(() => new Set());
  const selectedApprovalId = selectedPublishApproval?.approvalId ?? null;
  const selectedApprovalLocked = selectedApprovalId
    ? lockedApprovalIds.has(selectedApprovalId)
    : false;
  const selectedApprovalPending = selectedPublishApproval?.status === 'pending';
  const isSubmittingPublishDecision = useMemo(
    () => submitDecision.isPending || selectedApprovalLocked || !selectedApprovalPending,
    [selectedApprovalLocked, selectedApprovalPending, submitDecision.isPending],
  );

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([refreshWorkflowRuntime(), loadSessions(true)]);
  }, [loadSessions, refreshWorkflowRuntime]);

  const approvePublish = useCallback(() => {
    if (selectedPublishApproval?.status !== 'pending') return;
    setLockedApprovalIds((current) => new Set(current).add(selectedPublishApproval.approvalId));

    submitDecision.mutate(
      {
        approvalId: selectedPublishApproval.approvalId,
        agentic: selectedPublishApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: async () => {
          notifyApprovalResolved();
          toast.success('Publish approved', {
            description: 'The workflow will continue from the PMO publish decision.',
          });
          await refreshAfterDecision();
        },
        onError: (err) => {
          setLockedApprovalIds((current) => {
            const next = new Set(current);
            next.delete(selectedPublishApproval.approvalId);
            return next;
          });
          toast.error('Failed to approve publish', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [refreshAfterDecision, selectedPublishApproval, submitDecision]);

  const rejectPublish = useCallback(() => {
    if (selectedPublishApproval?.status !== 'pending') return;
    setLockedApprovalIds((current) => new Set(current).add(selectedPublishApproval.approvalId));

    submitDecision.mutate(
      {
        approvalId: selectedPublishApproval.approvalId,
        agentic: selectedPublishApproval.agentic,
        decision: 'reject',
      },
      {
        onSuccess: async () => {
          notifyApprovalResolved();
          toast.success('Publish rejected', {
            description: 'The workflow was stopped by the PMO publish decision.',
          });
          await refreshAfterDecision();
        },
        onError: (err) => {
          setLockedApprovalIds((current) => {
            const next = new Set(current);
            next.delete(selectedPublishApproval.approvalId);
            return next;
          });
          toast.error('Failed to reject publish', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [refreshAfterDecision, selectedPublishApproval, submitDecision]);

  return {
    isSubmittingPublishDecision,
    approvePublish,
    rejectPublish,
  };
}
