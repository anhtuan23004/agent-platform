import { toast } from '@seta/shared-ui';
import { useCallback, useMemo, useState } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import {
  groupNormalizationRows,
  type NormalizationReviewRow,
  type NormalizationReviewViewModel,
} from '../pages/pmo-page.logic';
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
  normalizationReviewView: NormalizationReviewViewModel | null;
  memberAdditionDrafts: MemberMasterAdditionDraft[];
  canApproveNormalization: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: (
    memberId: string,
    field: keyof Omit<MemberMasterAdditionDraft, 'member_id'>,
    value: string,
  ) => void;
  updateNormalizationRowDecision: (
    rowId: string,
    decision: Extract<NormalizationReviewRow['decision'], 'keep_row' | 'skip_row'>,
  ) => void;
  updateNormalizationRowValue: (rowId: string, columnKey: string, value: string) => void;
  resetNormalizationRowOverrides: (rowId: string) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

function unresolvedDuplicateGroupCount(rows: NormalizationReviewRow[]): number {
  const duplicateRows = rows.filter(
    (row) => row.issueType === 'duplicate_in_upload' && row.duplicateGroupKey,
  );
  const rowsByGroup = new Map<string, NormalizationReviewRow[]>();
  for (const row of duplicateRows) {
    rowsByGroup.set(row.duplicateGroupKey ?? row.groupId, [
      ...(rowsByGroup.get(row.duplicateGroupKey ?? row.groupId) ?? []),
      row,
    ]);
  }

  let unresolved = 0;
  for (const groupRows of rowsByGroup.values()) {
    const keptCount = groupRows.filter((row) => row.decision === 'keep_row').length;
    const skippedCount = groupRows.filter((row) => row.decision === 'skip_row').length;
    if (groupRows.length < 2 || keptCount !== 1 || skippedCount !== groupRows.length - 1) {
      unresolved++;
    }
  }

  return unresolved;
}

function buildMemberAdditionDrafts(
  view: NormalizationReviewViewModel | null,
): MemberMasterAdditionDraft[] {
  return (
    view?.missingMembers.map((item) => ({
      member_id: item.memberId,
      full_name: '',
      department: '',
      role_title: '',
    })) ?? []
  );
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

  const draftScope = `${selectedNormalizationApproval?.approvalId ?? ''}:${selectedNormalizationView?.missingMembers.map((item) => item.memberId).join('|') ?? ''}`;
  const reviewScope = selectedNormalizationApproval?.approvalId ?? '';

  const [memberAdditionEdits, setMemberAdditionEdits] = useState<
    Record<
      string,
      Partial<Pick<MemberMasterAdditionDraft, 'full_name' | 'department' | 'role_title'>>
    >
  >({});
  const [rowDecisions, setRowDecisions] = useState<Record<string, 'keep_row' | 'skip_row'>>({});
  const [rowOverrides, setRowOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [syncedDraftScope, setSyncedDraftScope] = useState(draftScope);
  const [syncedReviewScope, setSyncedReviewScope] = useState(reviewScope);

  if (draftScope !== syncedDraftScope) {
    setSyncedDraftScope(draftScope);
    setMemberAdditionEdits({});
  }

  if (reviewScope !== syncedReviewScope) {
    setSyncedReviewScope(reviewScope);
    setRowDecisions({});
    setRowOverrides({});
  }

  const defaultMemberAdditionDrafts = useMemo(
    () => buildMemberAdditionDrafts(selectedNormalizationView),
    [selectedNormalizationView],
  );
  const memberAdditionDrafts = useMemo(
    () =>
      defaultMemberAdditionDrafts.map((draft) => ({
        ...draft,
        ...(memberAdditionEdits[draft.member_id] ?? {}),
      })),
    [defaultMemberAdditionDrafts, memberAdditionEdits],
  );

  const refreshAfterDecision = useCallback(async () => {
    await Promise.all([refreshWorkflowRuntime(), loadSessions(true)]);
  }, [loadSessions, refreshWorkflowRuntime]);

  const hasMissingMembers = (selectedNormalizationView?.missingMembers.length ?? 0) > 0;
  const normalizationReviewView = useMemo(() => {
    if (!selectedNormalizationView) return null;

    const reviewRows = selectedNormalizationView.reviewRows.map((row) => {
      const nextDecision = rowDecisions[row.id];
      const nextValues = rowOverrides[row.id];
      return {
        ...row,
        ...(nextDecision ? { decision: nextDecision } : {}),
        values: nextValues ? { ...row.values, ...nextValues } : row.values,
      };
    });

    return {
      ...selectedNormalizationView,
      reviewRows,
      tableGroups: groupNormalizationRows(reviewRows),
    };
  }, [rowDecisions, rowOverrides, selectedNormalizationView]);

  const rowDecisionPayload = useMemo(
    () =>
      Object.entries(rowDecisions).map(([rowId, decision]) => ({
        rowId,
        decision,
      })),
    [rowDecisions],
  );
  const rowOverridePayload = useMemo(
    () =>
      Object.entries(rowOverrides)
        .filter(([, values]) => Object.keys(values).length > 0)
        .map(([rowId, values]) => ({
          rowId,
          values,
        })),
    [rowOverrides],
  );
  const hasRowReviewChanges = rowDecisionPayload.length > 0 || rowOverridePayload.length > 0;
  const unresolvedDuplicates = normalizationReviewView
    ? unresolvedDuplicateGroupCount(normalizationReviewView.reviewRows)
    : 0;
  const rowReviewCanSubmit =
    hasRowReviewChanges && (unresolvedDuplicates === 0 || rowOverridePayload.length > 0);

  const canApproveNormalization = useMemo(() => {
    if (!selectedNormalizationApproval || submitDecision.isPending) return false;
    if (!selectedNormalizationView?.canApprove && !hasMissingMembers && !rowReviewCanSubmit) {
      return false;
    }
    if (!hasMissingMembers)
      return selectedNormalizationView?.canApprove === true || rowReviewCanSubmit;
    const memberDraftsComplete = memberAdditionDrafts.every(
      (draft) => draft.member_id.trim().length > 0 && draft.full_name.trim().length > 0,
    );
    return memberDraftsComplete && (unresolvedDuplicates === 0 || rowOverridePayload.length > 0);
  }, [
    hasMissingMembers,
    memberAdditionDrafts,
    rowReviewCanSubmit,
    rowOverridePayload.length,
    selectedNormalizationApproval,
    selectedNormalizationView,
    submitDecision.isPending,
    unresolvedDuplicates,
  ]);

  const updateMemberAdditionDraft = useCallback(
    (
      memberId: string,
      field: keyof Omit<MemberMasterAdditionDraft, 'member_id'>,
      value: string,
    ) => {
      setMemberAdditionEdits((edits) => ({
        ...edits,
        [memberId]: {
          ...(edits[memberId] ?? {}),
          [field]: value,
        },
      }));
    },
    [],
  );

  const updateNormalizationRowDecision = useCallback(
    (rowId: string, decision: 'keep_row' | 'skip_row') => {
      setRowDecisions((current) => ({
        ...current,
        [rowId]: decision,
      }));
    },
    [],
  );

  const updateNormalizationRowValue = useCallback(
    (rowId: string, columnKey: string, value: string) => {
      setRowOverrides((current) => ({
        ...current,
        [rowId]: {
          ...(current[rowId] ?? {}),
          [columnKey]: value,
        },
      }));
    },
    [],
  );

  const resetNormalizationRowOverrides = useCallback((rowId: string) => {
    setRowOverrides((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }, []);

  const approveNormalization = useCallback(() => {
    if (!selectedNormalizationApproval) return;

    const payloadPatch: Record<string, unknown> = {
      decision: 'approve',
    };
    if (hasMissingMembers) {
      payloadPatch.memberMasterAdditions = memberAdditionDrafts.map((draft) => ({
        member_id: draft.member_id.trim(),
        full_name: draft.full_name.trim(),
        ...(draft.department.trim() ? { department: draft.department.trim() } : {}),
        ...(draft.role_title.trim() ? { role_title: draft.role_title.trim() } : {}),
      }));
    }
    if (rowDecisionPayload.length > 0) payloadPatch.rowDecisions = rowDecisionPayload;
    if (rowOverridePayload.length > 0) payloadPatch.rowOverrides = rowOverridePayload;
    const shouldModify = hasMissingMembers || hasRowReviewChanges;

    submitDecision.mutate(
      {
        approvalId: selectedNormalizationApproval.approvalId,
        agentic: selectedNormalizationApproval.agentic,
        decision: shouldModify ? 'modify' : 'approve',
        ...(shouldModify ? { payloadPatch } : {}),
      },
      {
        onSuccess: async () => {
          notifyApprovalResolved();
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
    hasRowReviewChanges,
    memberAdditionDrafts,
    refreshAfterDecision,
    rowDecisionPayload,
    rowOverridePayload,
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
          notifyApprovalResolved();
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
    normalizationReviewView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision: submitDecision.isPending,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  };
}
