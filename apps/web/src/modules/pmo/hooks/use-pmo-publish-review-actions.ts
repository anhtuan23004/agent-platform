import { toast } from '@seta/shared-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

interface UsePmoPublishReviewActionsOptions {
  selectedPublishApproval: WorkflowApprovalRow | null;
  /** Page-context refresh: reload the session list after a decision. */
  loadSessions?: (keepSelection?: boolean) => Promise<void>;
  /** Page-context refresh: refetch workflow runtime after a decision. */
  refreshWorkflowRuntime?: () => Promise<unknown>;
  /** Drawer-context callback: called after a decision instead of loadSessions/refreshWorkflowRuntime. */
  onDecisionComplete?: () => Promise<void> | void;
}

interface UsePmoPublishReviewActionsResult {
  isSubmittingPublishDecision: boolean;
  approvePublish: () => void;
  rejectPublish: () => void;
}

export function usePmoPublishReviewActions(
  options: UsePmoPublishReviewActionsOptions,
): UsePmoPublishReviewActionsResult {
  const { selectedPublishApproval, loadSessions, refreshWorkflowRuntime, onDecisionComplete } =
    options;
  const submitDecision = useSubmitWorkflowRuntimeDecision();
  const qc = useQueryClient();
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
    if (onDecisionComplete) {
      await onDecisionComplete();
    } else if (loadSessions && refreshWorkflowRuntime) {
      await Promise.all([refreshWorkflowRuntime(), loadSessions(true)]);
    }
  }, [onDecisionComplete, loadSessions, refreshWorkflowRuntime]);

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
          void qc.invalidateQueries({ queryKey: ['pmo', 'demo-analytics'] });
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
  }, [qc, refreshAfterDecision, selectedPublishApproval, submitDecision]);

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
