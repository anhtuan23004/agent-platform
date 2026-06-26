import { toast } from '@seta/shared-ui';
import { useCallback } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

interface ReportDateRange {
  from: string;
  to: string;
}

interface ReportDateRangePayload {
  workloadDateRange?: ReportDateRange;
  forwardAllocationDateRange?: ReportDateRange;
}

interface UsePmoReportRangeActionsOptions {
  selectedReportApproval: WorkflowApprovalRow | null;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  refreshWorkflowRuntime: () => Promise<unknown>;
}

interface UsePmoReportRangeActionsResult {
  isSubmittingReportDecision: boolean;
  confirmReportRange: (
    ranges: ReportDateRangePayload,
    dateRangeStrategy?: 'sheet_derived' | 'manual_database',
  ) => void;
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
    (ranges: ReportDateRangePayload, dateRangeStrategy = 'manual_database') => {
      if (!selectedReportApproval) return;

      submitDecision.mutate(
        {
          approvalId: selectedReportApproval.approvalId,
          agentic: selectedReportApproval.agentic,
          decision: 'approve',
          payloadPatch: { ...ranges, dateRangeStrategy },
        },
        {
          onSuccess: async () => {
            notifyApprovalResolved();
            await refreshAfterDecision();
            toast.success('Report queued', {
              description: 'PDF generation is running from published PMO data.',
            });
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
          notifyApprovalResolved();
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
