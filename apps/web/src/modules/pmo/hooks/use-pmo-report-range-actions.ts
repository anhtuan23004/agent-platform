import { toast } from '@seta/shared-ui';
import { useCallback } from 'react';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

interface ReportDateRange {
  from: string;
  to: string;
}

interface UsePmoReportRangeActionsOptions {
  selectedReportApproval: WorkflowApprovalRow | null;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  refreshWorkflowRuntime: () => Promise<void>;
}

interface UsePmoReportRangeActionsResult {
  isSubmittingReportDecision: boolean;
  confirmReportRange: (dateRange: ReportDateRange) => void;
  rejectReportRange: () => void;
}

export function usePmoReportRangeActions(
  options: UsePmoReportRangeActionsOptions,
): UsePmoReportRangeActionsResult {
  const { selectedReportApproval, loadSessions, refreshWorkflowRuntime } = options;
  const submitDecision = useSubmitWorkflowRuntimeDecision();

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([refreshWorkflowRuntime(), loadSessions(true)]);
  }, [loadSessions, refreshWorkflowRuntime]);

  const confirmReportRange = useCallback(
    (dateRange: ReportDateRange) => {
      if (!selectedReportApproval) return;

      submitDecision.mutate(
        {
          approvalId: selectedReportApproval.approvalId,
          agentic: selectedReportApproval.agentic,
          decision: 'approve',
          payloadPatch: { dateRange },
        },
        {
          onSuccess: async () => {
            toast.success('Report range confirmed', {
              description: 'The workflow will generate the PMO report from published data.',
            });
            await refreshAfterDecision();
          },
          onError: (err) => {
            toast.error('Failed to confirm report range', {
              description: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );
    },
    [refreshAfterDecision, selectedReportApproval, submitDecision],
  );

  const rejectReportRange = useCallback(() => {
    if (!selectedReportApproval) return;

    submitDecision.mutate(
      {
        approvalId: selectedReportApproval.approvalId,
        agentic: selectedReportApproval.agentic,
        decision: 'reject',
      },
      {
        onSuccess: async () => {
          toast.success('Report skipped', {
            description: 'Published PMO data was kept; only report generation was skipped.',
          });
          await refreshAfterDecision();
        },
        onError: (err) => {
          toast.error('Failed to skip report', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [refreshAfterDecision, selectedReportApproval, submitDecision]);

  return {
    isSubmittingReportDecision: submitDecision.isPending,
    confirmReportRange,
    rejectReportRange,
  };
}
