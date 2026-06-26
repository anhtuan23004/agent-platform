import { toast } from '@seta/shared-ui';
import { useCallback, useState } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import {
  type PmoPlanningSession,
  type PmoProfilingArea,
  type PmoProfilingSheetReviewOverride,
  type PmoSessionDocumentProfileRecord,
  pmoApi,
} from '../api/client';
import { type WorkflowApprovalRow, workflowRuntimeApi } from '../api/workflow-runtime';
import { isPmoSessionCancelable } from './pmo-session-cancel';

export interface UploadedWorkbookInfo {
  ingestionSessionId: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedAtIso: string;
  fileType: string;
}

interface UsePmoSessionActionsOptions {
  reportingPeriodKey: string;
  chatThreadId: string;
  selectedSession: PmoPlanningSession | null;
  profilingDocuments: PmoSessionDocumentProfileRecord[];
  profilingOverridesBySessionId: Record<
    string,
    Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>
  >;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsReviewPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadedInfo: React.Dispatch<React.SetStateAction<UploadedWorkbookInfo | null>>;
  refreshWorkflowRuntime: () => Promise<void>;
  runtimeRunBySessionId: Map<string, { runId: string; status: string }>;
  /** Pending agentic profiling approval — used to resume the agent on approve. */
  profilingApproval: WorkflowApprovalRow | null;
}

interface UsePmoSessionActionsResult {
  isUploading: boolean;
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  isCancellingWorkflowBySessionId: Record<string, boolean>;
  refreshPage: () => void;
  onFile: (file: File) => Promise<void>;
  handleAppendDocument: (file: File) => Promise<void>;
  handleSaveProfilingReview: () => Promise<void>;
  handleApproveProfilingContinue: () => Promise<void>;
  isWorkflowCancelable: (run: PmoPlanningSession) => boolean;
  handleCancelWorkflow: (run: PmoPlanningSession) => Promise<void>;
}

export function usePmoSessionActions(
  options: UsePmoSessionActionsOptions,
): UsePmoSessionActionsResult {
  const {
    reportingPeriodKey,
    chatThreadId,
    selectedSession,
    profilingOverridesBySessionId,
    loadSessions,
    setSelectedSessionId,
    setIsReviewPanelOpen,
    setUploadedInfo,
    refreshWorkflowRuntime,
    runtimeRunBySessionId,
    profilingApproval,
  } = options;

  const [isUploading, setIsUploading] = useState(false);
  const [isAppendingDocument, setIsAppendingDocument] = useState(false);
  const [isSavingProfilingReview, setIsSavingProfilingReview] = useState(false);
  const [isApprovingProfiling, setIsApprovingProfiling] = useState(false);
  const [isCancellingWorkflowBySessionId, setIsCancellingWorkflowBySessionId] = useState<
    Record<string, boolean>
  >({});

  const refreshPage = useCallback(() => {
    void loadSessions(true);
  }, [loadSessions]);

  const onFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const uploaded = await pmoApi.uploadWorkbook(file, {
          reportingPeriodKey: reportingPeriodKey || undefined,
          chatThreadId,
        });
        const nowIso = new Date().toISOString();
        const sessionId = uploaded.ingestion_session_id;

        setUploadedInfo({
          ingestionSessionId: sessionId,
          fileName: file.name,
          fileSizeBytes: file.size,
          uploadedAtIso: nowIso,
          fileType:
            file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        setSelectedSessionId(sessionId);
        setIsReviewPanelOpen(false);

        await loadSessions(true);

        toast.success('Workbook uploaded', {
          description: 'Session created. Select the session to view workflow cards.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        toast.error('Upload failed', { description: message });
      } finally {
        setIsUploading(false);
      }
    },
    [
      chatThreadId,
      loadSessions,
      reportingPeriodKey,
      setIsReviewPanelOpen,
      setSelectedSessionId,
      setUploadedInfo,
    ],
  );

  const handleAppendDocument = useCallback(
    async (file: File) => {
      if (!selectedSession) {
        toast.error('No session selected', {
          description: 'Please select an approved session before appending a document.',
        });
        return;
      }

      if (selectedSession.planning_state !== 'approved_plan') {
        toast.error('Cannot append document', {
          description: 'Supplemental documents are allowed only after plan approval.',
        });
        return;
      }

      if (isAppendingDocument) {
        return;
      }

      setIsAppendingDocument(true);
      try {
        const response = await pmoApi.appendSessionDocument(
          selectedSession.ingestion_session_id,
          file,
        );

        await loadSessions(true);
        toast.success('Supplemental document processed', {
          description:
            response.document.status === 'profile_failed'
              ? 'Document uploaded, but profiling failed. Check the error in Workbook Profiling card.'
              : 'Document uploaded and profiled successfully in the current workflow session.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to append document.';
        toast.error('Append failed', { description: message });
      } finally {
        setIsAppendingDocument(false);
      }
    },
    [isAppendingDocument, loadSessions, selectedSession],
  );

  const handleSaveProfilingReview = useCallback(async () => {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'approved_plan') {
      toast.error('Cannot save review', {
        description: 'Profiling review is available only after plan approval.',
      });
      return;
    }

    if (isSavingProfilingReview) {
      return;
    }

    const sessionOverrides =
      profilingOverridesBySessionId[selectedSession.ingestion_session_id] ?? {};
    const overridesPayload: PmoProfilingSheetReviewOverride[] = Object.entries(sessionOverrides)
      .map(([key, value]) => {
        const [document_id, sheet_name] = key.split('::');
        if (!document_id || !sheet_name) {
          return null;
        }

        return {
          document_id,
          sheet_name,
          final_area: value.finalArea,
          mark_ignore: value.markIgnore,
        };
      })
      .filter((item): item is PmoProfilingSheetReviewOverride => Boolean(item));

    setIsSavingProfilingReview(true);
    try {
      await pmoApi.updateProfilingReview({
        ingestion_session_id: selectedSession.ingestion_session_id,
        sheet_overrides: overridesPayload,
      });
      await loadSessions(true);
      toast.success('Profiling review saved', {
        description: 'Review edits were persisted. Gate remains in Needs Review until approval.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save profiling review.';
      toast.error('Save failed', { description: message });
    } finally {
      setIsSavingProfilingReview(false);
    }
  }, [isSavingProfilingReview, loadSessions, profilingOverridesBySessionId, selectedSession]);

  const handleApproveProfilingContinue = useCallback(async () => {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'approved_plan') {
      toast.error('Cannot continue', {
        description: 'Profiling gate is available only after plan approval.',
      });
      return;
    }

    if (profilingApproval?.status !== 'pending') {
      toast.error('No pending approval', {
        description:
          'No pending profiling approval found. Please start the workflow from the PMO Agent page first.',
      });
      return;
    }

    if (isApprovingProfiling) {
      return;
    }

    setIsApprovingProfiling(true);
    try {
      // Resume the agent via the approval row so the agentic workflow
      // continues to the next step automatically.
      if (profilingApproval.agentic) {
        await workflowRuntimeApi.resumeChat({
          approvalId: profilingApproval.approvalId,
          decision: 'approve',
        });
      } else {
        await workflowRuntimeApi.decideApproval(profilingApproval.approvalId, {
          decision: 'approve',
        });
      }

      notifyApprovalResolved();
      await Promise.all([loadSessions(true), refreshWorkflowRuntime()]);

      toast.success('Profiling approved', {
        description: 'Profiling gate approved. The agent will continue processing.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve profiling gate.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApprovingProfiling(false);
    }
  }, [
    isApprovingProfiling,
    loadSessions,
    profilingApproval,
    refreshWorkflowRuntime,
    selectedSession,
  ]);

  const isRuntimeRunCancelable = useCallback((status: string | null | undefined): boolean => {
    return status === 'pending' || status === 'running' || status === 'paused';
  }, []);

  const isWorkflowCancelable = useCallback(
    (run: PmoPlanningSession): boolean => {
      const runtimeStatus = runtimeRunBySessionId.get(run.ingestion_session_id)?.status;
      return isPmoSessionCancelable(run, runtimeStatus);
    },
    [runtimeRunBySessionId],
  );

  const handleCancelWorkflow = useCallback(
    async (run: PmoPlanningSession) => {
      if (!isWorkflowCancelable(run)) {
        toast.error('Cannot cancel workflow', {
          description: 'Session is already terminal and cannot be cancelled.',
        });
        return;
      }

      if (isCancellingWorkflowBySessionId[run.ingestion_session_id]) {
        return;
      }

      setIsCancellingWorkflowBySessionId((prev) => ({
        ...prev,
        [run.ingestion_session_id]: true,
      }));

      try {
        const runtimeRun = runtimeRunBySessionId.get(run.ingestion_session_id);
        const shouldCancelRuntime = isRuntimeRunCancelable(runtimeRun?.status);
        const shouldCancelPmo = true;

        let canceledRuntime = false;
        let canceledPmo = false;
        const failures: string[] = [];

        if (shouldCancelRuntime && runtimeRun?.runId) {
          try {
            await workflowRuntimeApi.cancelRun(runtimeRun.runId);
            canceledRuntime = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to cancel workflow run.';
            failures.push(message);
          }
        }

        if (shouldCancelPmo) {
          try {
            await pmoApi.cancelWorkflow(run.ingestion_session_id);
            canceledPmo = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update PMO session.';
            failures.push(message);
          }
        }

        if (!canceledRuntime && !canceledPmo) {
          throw new Error(failures.join(' | ') || 'Failed to cancel workflow.');
        }

        await Promise.all([loadSessions(true), refreshWorkflowRuntime()]);

        if (canceledRuntime && canceledPmo) {
          toast.success('Workflow cancelled', {
            description: 'Cancelled on both PMO session and Agent workflow run.',
          });
        } else if (canceledRuntime) {
          toast.success('Workflow run cancelled', {
            description:
              'Agent workflow run is cancelled and PMO page will reflect runtime status.',
          });
        } else {
          toast.success('PMO session cancelled', {
            description: 'PMO execution state is cancelled. Agent run may already be terminal.',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to cancel workflow.';
        toast.error('Cancel failed', { description: message });
      } finally {
        setIsCancellingWorkflowBySessionId((prev) => ({
          ...prev,
          [run.ingestion_session_id]: false,
        }));
      }
    },
    [
      isCancellingWorkflowBySessionId,
      isRuntimeRunCancelable,
      isWorkflowCancelable,
      loadSessions,
      refreshWorkflowRuntime,
      runtimeRunBySessionId,
    ],
  );

  return {
    isUploading,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    isCancellingWorkflowBySessionId,
    refreshPage,
    onFile,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    isWorkflowCancelable,
    handleCancelWorkflow,
  };
}
