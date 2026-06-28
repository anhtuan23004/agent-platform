/**
 * Drawer adapter for the Workbook Profiling review step.
 * Fetches session data and renders the interactive PmoProfilingDetailsPanel.
 *
 * Unlike other drawer adapters, profiling needs session-level data
 * (documents, summary, review state) that is not available in the
 * approval payload alone. This adapter fetches the session via
 * pmoApi.listPlanningSessions() and passes the data to the panel.
 */

import { toast } from '@seta/shared-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type PmoProfilingArea, pmoApi } from '../../../../pmo/api/client';
import { workflowRuntimeApi } from '../../../../pmo/api/workflow-runtime';
import {
  PmoProfilingDetailsPanel,
  type ProfilingOverrideEntry,
} from '../../../../pmo/components/pmo-profiling-details-panel';
import {
  profilingSheetKey,
  readIngestionSessionIdFromApproval,
} from '../../../../pmo/pages/pmo-page.logic';
import { notifyApprovalResolved } from '../../../hooks/use-approval-events';
import type { WorkflowApprovalRow } from '../../api/schemas';
import { workflowsQueryKeys } from '../../state/query-keys';

const ACCEPT = '.xlsx,.xlsm';
const MAX_BYTES = 50 * 1024 * 1024;
const PROFILING_AREAS: PmoProfilingArea[] = [
  'resource_allocation',
  'timesheet',
  'overbook_idle_config',
  'member_master',
  'project_master',
  'leave',
  'calendar_weeks',
  'kpi_norms',
  'unknown',
];

export function DrawerProfiling({
  approval,
  threadId,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  threadId: string | undefined;
  onDecisionComplete: () => Promise<void> | void;
}) {
  const qc = useQueryClient();
  const sessionId = readIngestionSessionIdFromApproval(approval);
  const [isApprovingProfiling, setIsApprovingProfiling] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, ProfilingOverrideEntry>>({});

  // Fetch the session to get profiling documents, summary, review state
  const sessionQuery = useQuery({
    queryKey: ['pmo', 'planning-session', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => pmoApi.getPlanningSession(sessionId as string),
    staleTime: 30_000,
  });

  const session = sessionQuery.data ?? null;
  const executionState = session?.execution_state ?? null;
  const profilingDocuments = session?.profiling_documents?.length
    ? session.profiling_documents
    : (executionState?.documents ?? []);
  const profilingSummary = session?.profiling_summary ?? executionState?.profiling_summary;
  const profilingReviewState = session?.profiling_review ?? executionState?.profiling_review;

  const handleSelectSheetArea = useCallback(
    (documentId: string, sheetName: string, selectedArea: PmoProfilingArea) => {
      const key = profilingSheetKey(documentId, sheetName);
      setOverrides((prev) => ({
        ...prev,
        [key]: { finalArea: selectedArea, markIgnore: selectedArea === 'unknown' },
      }));
    },
    [],
  );

  const handleToggleSheetIgnore = useCallback(
    (documentId: string, sheetName: string, checked: boolean, fallbackArea: PmoProfilingArea) => {
      const key = profilingSheetKey(documentId, sheetName);
      setOverrides((prev) => ({
        ...prev,
        [key]: {
          finalArea: checked ? 'unknown' : (prev[key]?.finalArea ?? fallbackArea),
          markIgnore: checked,
        },
      }));
    },
    [],
  );

  const handleSaveProfilingReview = useCallback(async () => {
    if (!sessionId) return;
    const overridesPayload = Object.entries(overrides)
      .map(([key, value]) => {
        const [document_id, sheet_name] = key.split('::');
        if (!document_id || !sheet_name) return null;
        return {
          document_id,
          sheet_name,
          final_area: value.finalArea,
          mark_ignore: value.markIgnore,
        };
      })
      .filter(Boolean);

    try {
      await pmoApi.updateProfilingReview({
        ingestion_session_id: sessionId,
        sheet_overrides: overridesPayload as Array<{
          document_id: string;
          sheet_name: string;
          final_area: PmoProfilingArea;
          mark_ignore: boolean;
        }>,
      });
      await sessionQuery.refetch();
      toast.success('Profiling review saved');
    } catch (err) {
      toast.error('Save failed', {
        description: err instanceof Error ? err.message : 'Failed to save profiling review.',
      });
    }
  }, [overrides, sessionId, sessionQuery]);

  const handleApproveProfilingContinue = useCallback(async () => {
    if (approval?.status !== 'pending') {
      toast.error('No pending approval');
      return;
    }
    setIsApprovingProfiling(true);
    try {
      if (approval.agentic) {
        await workflowRuntimeApi.resumeChat({
          approvalId: approval.approvalId,
          decision: 'approve',
        });
      } else {
        await workflowRuntimeApi.decideApproval(approval.approvalId, { decision: 'approve' });
      }
      notifyApprovalResolved({ threadId });
      if (threadId) {
        void qc.invalidateQueries({ queryKey: workflowsQueryKeys.threadApprovals(threadId) });
      }
      void qc.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() });
      void qc.invalidateQueries({ queryKey: ['pmo'] });
      toast.success('Profiling approved');
      await onDecisionComplete();
    } catch (err) {
      toast.error('Approve failed', {
        description: err instanceof Error ? err.message : 'Failed to approve profiling.',
      });
    } finally {
      setIsApprovingProfiling(false);
    }
  }, [approval, threadId, qc, onDecisionComplete]);

  const handleAppendDocument = useCallback(
    async (file: File) => {
      if (!sessionId) return;
      try {
        await pmoApi.appendSessionDocument(sessionId, file);
        await sessionQuery.refetch();
        toast.success('Document appended');
      } catch (err) {
        toast.error('Append failed', {
          description: err instanceof Error ? err.message : 'Failed to append document.',
        });
      }
    },
    [sessionId, sessionQuery],
  );

  if (sessionQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-body-sm text-ink-subtle">
        <Loader2 className="size-4 animate-spin" />
        Loading session data...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
        Could not load session data for profiling review.
      </div>
    );
  }

  return (
    <PmoProfilingDetailsPanel
      stepStatus="needs_review"
      isCurrent
      isProfilingStepReadOnly={false}
      isApprovedReadOnly={false}
      profilingReviewState={profilingReviewState}
      profilingSummary={profilingSummary}
      profilingDocuments={profilingDocuments}
      profilingApproval={approval}
      selectedSessionOverrides={overrides}
      profilingAreas={PROFILING_AREAS}
      isAppendingDocument={false}
      isSavingProfilingReview={false}
      isApprovingProfiling={isApprovingProfiling}
      canShowProfilingActions
      dropzoneAccept={ACCEPT}
      dropzoneMaxBytes={MAX_BYTES}
      handleAppendDocument={handleAppendDocument}
      handleSaveProfilingReview={handleSaveProfilingReview}
      handleApproveProfilingContinue={handleApproveProfilingContinue}
      onSelectSheetArea={handleSelectSheetArea}
      onToggleSheetIgnore={handleToggleSheetIgnore}
    />
  );
}
