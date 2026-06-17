import { toast } from '@seta/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { NormalizationReviewViewModel } from '../pages/pmo-page.logic';
import { useSubmitWorkflowRuntimeDecision } from './use-workflow-runtime';

export interface MemberMasterAdditionDraft {
  member_id: string;
  full_name: string;
  department: string;
  role_title: string;
}

interface UsePmoNormalizationReviewActionsOptions {
  selectedNormalizationApproval: WorkflowApprovalRow | null;
  selectedNormalizationView: NormalizationReviewViewModel | null;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  refreshWorkflowRuntime: () => Promise<void>;
}

interface UsePmoNormalizationReviewActionsResult {
  memberAdditionDrafts: MemberMasterAdditionDraft[];
  canApproveNormalization: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: (
    memberId: string,
    field: keyof Omit<MemberMasterAdditionDraft, 'member_id'>,
    value: string,
  ) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

export function usePmoNormalizationReviewActions(
  options: UsePmoNormalizationReviewActionsOptions,
): UsePmoNormalizationReviewActionsResult {
  const {
    selectedNormalizationApproval,
    selectedNormalizationView,
    loadSessions,
    refreshWorkflowRuntime,
  } = options;
  const submitDecision = useSubmitWorkflowRuntimeDecision();
  const [memberAdditionDrafts, setMemberAdditionDrafts] = useState<MemberMasterAdditionDraft[]>([]);

  const draftScope = `${selectedNormalizationApproval?.approvalId ?? ''}:${selectedNormalizationView?.missingMembers.map((item) => item.memberId).join('|') ?? ''}`;
  const previousDraftScope = useRef('');

  useEffect(() => {
    if (previousDraftScope.current === draftScope) return;
    previousDraftScope.current = draftScope;
    setMemberAdditionDrafts(
      selectedNormalizationView?.missingMembers.map((item) => ({
        member_id: item.memberId,
        full_name: '',
        department: '',
        role_title: '',
      })) ?? [],
    );
  }, [draftScope, selectedNormalizationView]);

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([refreshWorkflowRuntime(), loadSessions(true)]);
  }, [loadSessions, refreshWorkflowRuntime]);

  const hasMissingMembers = (selectedNormalizationView?.missingMembers.length ?? 0) > 0;
  const canApproveNormalization = useMemo(() => {
    if (!selectedNormalizationApproval || submitDecision.isPending) return false;
    if (!selectedNormalizationView?.canApprove && !hasMissingMembers) return false;
    if (!hasMissingMembers) return selectedNormalizationView?.canApprove === true;
    return memberAdditionDrafts.every(
      (draft) => draft.member_id.trim().length > 0 && draft.full_name.trim().length > 0,
    );
  }, [
    hasMissingMembers,
    memberAdditionDrafts,
    selectedNormalizationApproval,
    selectedNormalizationView,
    submitDecision.isPending,
  ]);

  const updateMemberAdditionDraft = useCallback(
    (
      memberId: string,
      field: keyof Omit<MemberMasterAdditionDraft, 'member_id'>,
      value: string,
    ) => {
      setMemberAdditionDrafts((drafts) =>
        drafts.map((draft) =>
          draft.member_id === memberId ? { ...draft, [field]: value } : draft,
        ),
      );
    },
    [],
  );

  const approveNormalization = useCallback(() => {
    if (!selectedNormalizationApproval) return;

    submitDecision.mutate(
      {
        approvalId: selectedNormalizationApproval.approvalId,
        agentic: selectedNormalizationApproval.agentic,
        decision: hasMissingMembers ? 'modify' : 'approve',
        ...(hasMissingMembers
          ? {
              payloadPatch: {
                decision: 'approve',
                memberMasterAdditions: memberAdditionDrafts.map((draft) => ({
                  member_id: draft.member_id.trim(),
                  full_name: draft.full_name.trim(),
                  ...(draft.department.trim() ? { department: draft.department.trim() } : {}),
                  ...(draft.role_title.trim() ? { role_title: draft.role_title.trim() } : {}),
                })),
              },
            }
          : {}),
      },
      {
        onSuccess: async () => {
          toast.success('Normalization approved', {
            description: hasMissingMembers
              ? 'Missing member master rows were added to this run before staging.'
              : 'Normalized data will be staged for the next workflow step.',
          });
          await refreshAfterDecision();
        },
        onError: (err) => {
          toast.error('Failed to approve normalization', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [
    hasMissingMembers,
    memberAdditionDrafts,
    refreshAfterDecision,
    selectedNormalizationApproval,
    submitDecision,
  ]);

  const rejectNormalization = useCallback(() => {
    if (!selectedNormalizationApproval) return;

    submitDecision.mutate(
      {
        approvalId: selectedNormalizationApproval.approvalId,
        agentic: selectedNormalizationApproval.agentic,
        decision: 'reject',
      },
      {
        onSuccess: async () => {
          toast.success('Normalization rejected', {
            description: 'The workflow was stopped before staging.',
          });
          await refreshAfterDecision();
        },
        onError: (err) => {
          toast.error('Failed to reject normalization', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }, [refreshAfterDecision, selectedNormalizationApproval, submitDecision]);

  return {
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision: submitDecision.isPending,
    updateMemberAdditionDraft,
    approveNormalization,
    rejectNormalization,
  };
}
