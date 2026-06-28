import { toast } from '@seta/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type {
  MappingAlternateOption,
  MappingProgressItem,
  MappingViewModel,
} from '../pages/pmo-page.logic';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

interface UsePmoMappingReviewActionsOptions {
  selectedSessionId: string | null;
  selectedMappingApproval: WorkflowApprovalRow | null;
  selectedMappingView: MappingViewModel | null;
  /** Page-context refresh: reload the session list after a decision. */
  loadSessions?: (keepSelection?: boolean) => Promise<void>;
  /** Page-context refresh: refetch pending approvals after a decision. */
  refreshMappingApprovals?: () => Promise<unknown>;
  /** Drawer-context callback: called after the mapping step fully completes. */
  onDecisionComplete?: () => Promise<void> | void;
  /** Drawer-context refresh after a single mapping item decision (keep drawer open). */
  onPartialDecisionRefresh?: () => Promise<void> | void;
}

interface UsePmoMappingReviewActionsResult {
  editingMappingKey: string | null;
  selectedMappingAlternate: number | null;
  editingMappingItem: MappingProgressItem | null;
  editingMappingAlternates: MappingAlternateOption[];
  selectedAlternateOption: MappingAlternateOption | null;
  canProceedToNextStep: boolean;
  isSubmittingDecision: boolean;
  approveCurrentMappingItem: () => void;
  openMappingModify: (itemKey: string) => void;
  applyMappingModify: () => void;
  proceedToNextWorkflowStep: () => void;
  selectMappingAlternate: (alternateIndex: number) => void;
  cancelMappingModify: () => void;
}

export function usePmoMappingReviewActions(
  options: UsePmoMappingReviewActionsOptions,
): UsePmoMappingReviewActionsResult {
  const {
    selectedSessionId,
    selectedMappingApproval,
    selectedMappingView,
    loadSessions,
    refreshMappingApprovals,
    onDecisionComplete,
    onPartialDecisionRefresh,
  } = options;

  const submitDecision = useSubmitWorkflowRuntimeDecision();
  const [editingMappingKey, setEditingMappingKey] = useState<string | null>(null);
  const [selectedMappingAlternate, setSelectedMappingAlternate] = useState<number | null>(null);

  const editingMappingItem = useMemo(
    () => selectedMappingView?.items.find((item) => item.key === editingMappingKey) ?? null,
    [selectedMappingView, editingMappingKey],
  );

  const editingMappingAlternates = useMemo(() => {
    if (!selectedMappingView || !editingMappingKey) {
      return [] as MappingAlternateOption[];
    }
    return selectedMappingView.alternatesByItemKey.get(editingMappingKey) ?? [];
  }, [selectedMappingView, editingMappingKey]);

  const selectedAlternateOption = useMemo(
    () =>
      editingMappingAlternates.find(
        (option) => option.alternateIndex === selectedMappingAlternate,
      ) ?? null,
    [editingMappingAlternates, selectedMappingAlternate],
  );

  const mappingEditorScope = `${selectedSessionId ?? ''}:${selectedMappingApproval?.approvalId ?? ''}`;
  const previousMappingEditorScope = useRef(mappingEditorScope);

  useEffect(() => {
    if (previousMappingEditorScope.current === mappingEditorScope) {
      return;
    }

    previousMappingEditorScope.current = mappingEditorScope;
    setEditingMappingKey(null);
    setSelectedMappingAlternate(null);
  }, [mappingEditorScope]);

  const canProceedToNextStep =
    Boolean(selectedMappingApproval) &&
    selectedMappingView?.awaitingNextStep === true &&
    !submitDecision.isPending;

  const refreshAfterPartialDecision = useCallback(async () => {
    if (onPartialDecisionRefresh) {
      await onPartialDecisionRefresh();
    } else if (loadSessions && refreshMappingApprovals) {
      await Promise.all([refreshMappingApprovals(), loadSessions(true)]);
    }
  }, [onPartialDecisionRefresh, loadSessions, refreshMappingApprovals]);

  const refreshAfterFinalDecision = useCallback(async () => {
    if (onDecisionComplete) {
      await onDecisionComplete();
    } else if (loadSessions && refreshMappingApprovals) {
      await Promise.all([refreshMappingApprovals(), loadSessions(true)]);
    }
  }, [onDecisionComplete, loadSessions, refreshMappingApprovals]);

  const approveCurrentMappingItem = useCallback(() => {
    if (!selectedMappingApproval) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: async () => {
          toast.success('Mapping item approved', {
            description: 'The next mapping item is now ready for review.',
          });
          await refreshAfterPartialDecision();
        },
        onError: (err) => {
          toast.error('Failed to approve mapping item', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [refreshAfterPartialDecision, selectedMappingApproval, submitDecision]);

  const openMappingModify = useCallback(
    (itemKey: string) => {
      if (!selectedMappingView) return;

      const alternatesForItem = selectedMappingView.alternatesByItemKey.get(itemKey) ?? [];
      if (alternatesForItem.length === 0) return;

      setEditingMappingKey(itemKey);
      setSelectedMappingAlternate(alternatesForItem[0]?.alternateIndex ?? null);
    },
    [selectedMappingView],
  );

  const applyMappingModify = useCallback(() => {
    if (!selectedMappingApproval) return;
    if (selectedMappingAlternate === null) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'modify',
        alternateIndices: [selectedMappingAlternate],
      },
      {
        onSuccess: async () => {
          toast.success('Mapping updated', {
            description: 'The selected source column has been applied for this review item.',
          });
          setEditingMappingKey(null);
          setSelectedMappingAlternate(null);
          await refreshAfterPartialDecision();
        },
        onError: (err) => {
          toast.error('Failed to update mapping', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [
    refreshAfterPartialDecision,
    selectedMappingAlternate,
    selectedMappingApproval,
    submitDecision,
  ]);

  const proceedToNextWorkflowStep = useCallback(() => {
    if (!selectedMappingApproval) return;
    if (selectedMappingView?.awaitingNextStep !== true) return;

    submitDecision.mutate(
      {
        approvalId: selectedMappingApproval.approvalId,
        agentic: selectedMappingApproval.agentic,
        decision: 'approve',
      },
      {
        onSuccess: async () => {
          if (!onDecisionComplete) {
            notifyApprovalResolved();
          }
          toast.success('Moved to next step', {
            description: 'Workflow moved to the next step in final plan.',
          });
          await refreshAfterFinalDecision();
        },
        onError: (err) => {
          toast.error('Failed to proceed to next step', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [
    refreshAfterFinalDecision,
    onDecisionComplete,
    selectedMappingApproval,
    selectedMappingView,
    submitDecision,
  ]);

  const selectMappingAlternate = useCallback((alternateIndex: number) => {
    setSelectedMappingAlternate(alternateIndex);
  }, []);

  const cancelMappingModify = useCallback(() => {
    setEditingMappingKey(null);
    setSelectedMappingAlternate(null);
  }, []);

  return {
    editingMappingKey,
    selectedMappingAlternate,
    editingMappingItem,
    editingMappingAlternates,
    selectedAlternateOption,
    canProceedToNextStep,
    isSubmittingDecision: submitDecision.isPending,
    approveCurrentMappingItem,
    openMappingModify,
    applyMappingModify,
    proceedToNextWorkflowStep,
    selectMappingAlternate,
    cancelMappingModify,
  };
}
