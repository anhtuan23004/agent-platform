import { toast } from '@seta/shared-ui';
import { useCallback, useState } from 'react';
import {
  type GeneratePlanInput,
  type PmoPlanningSession,
  type PmoProfilingArea,
  type PmoProfilingSheetReviewOverride,
  type PmoSessionDocumentProfileRecord,
  pmoApi,
} from '../api/client';
import { shortId } from '../pages/pmo-page.logic';

export interface UploadedWorkbookInfo {
  ingestionSessionId: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedAtIso: string;
  fileType: string;
}

interface UsePmoSessionActionsOptions {
  reportingPeriodKey: string;
  goalDraft: string;
  targetGenerateSessionId: string | null;
  selectedSession: PmoPlanningSession | null;
  profilingDocuments: PmoSessionDocumentProfileRecord[];
  feedbackBySessionId: Record<string, string>;
  profilingOverridesBySessionId: Record<
    string,
    Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>
  >;
  loadSessions: (keepSelection?: boolean) => Promise<void>;
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsReviewPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadedInfo: React.Dispatch<React.SetStateAction<UploadedWorkbookInfo | null>>;
  refreshWorkflowRuntime: () => Promise<void>;
}

interface UsePmoSessionActionsResult {
  isUploading: boolean;
  isGenerating: boolean;
  isApproving: boolean;
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  isCancellingWorkflowBySessionId: Record<string, boolean>;
  refreshPage: () => void;
  onFile: (file: File) => Promise<void>;
  handleAnalyzeGeneratePlan: () => Promise<void>;
  handleRegeneratePlan: () => Promise<void>;
  handleApprovePlanAndStart: () => Promise<void>;
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
    goalDraft,
    targetGenerateSessionId,
    selectedSession,
    profilingDocuments,
    feedbackBySessionId,
    profilingOverridesBySessionId,
    loadSessions,
    setSelectedSessionId,
    setIsReviewPanelOpen,
    setUploadedInfo,
    refreshWorkflowRuntime,
  } = options;

  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
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
        const uploaded = await pmoApi.uploadWorkbook(file, reportingPeriodKey || undefined);
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
          description: 'Analyze & Generate Plan is now enabled.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        toast.error('Upload failed', { description: message });
      } finally {
        setIsUploading(false);
      }
    },
    [loadSessions, reportingPeriodKey, setIsReviewPanelOpen, setSelectedSessionId, setUploadedInfo],
  );

  const handleAnalyzeGeneratePlan = useCallback(async () => {
    if (!targetGenerateSessionId) {
      toast.error('Upload required', {
        description: 'Please upload a workbook or select an Uploaded run before generating a plan.',
      });
      return;
    }

    if (isGenerating) {
      return;
    }

    const goal = goalDraft.trim() || 'Generate ingestion workflow plan from uploaded workbook.';

    setIsGenerating(true);
    try {
      const payload: GeneratePlanInput = {
        ingestion_session_id: targetGenerateSessionId,
        goal,
      };

      await pmoApi.generatePlan(payload);
      await loadSessions(true);
      setSelectedSessionId(targetGenerateSessionId);

      toast.success('Plan generated', {
        description: 'Upload history status moved to Plan Review.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan generation failed.';
      toast.error('Generate failed', { description: message });
    } finally {
      setIsGenerating(false);
    }
  }, [goalDraft, isGenerating, loadSessions, setSelectedSessionId, targetGenerateSessionId]);

  const handleRegeneratePlan = useCallback(async () => {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'plan_review') {
      toast.error('Cannot regenerate', {
        description: 'Plan can be regenerated only in Plan Review state.',
      });
      return;
    }

    if (isGenerating) {
      return;
    }

    const goal =
      goalDraft.trim() || selectedSession.goal || 'Generate plan from uploaded workbook.';
    const feedback = (feedbackBySessionId[selectedSession.ingestion_session_id] ?? '').trim();

    setIsGenerating(true);
    try {
      await pmoApi.generatePlan({
        ingestion_session_id: selectedSession.ingestion_session_id,
        goal,
        previous_plan: selectedSession.plan,
        plan_feedback: feedback || undefined,
      });

      await loadSessions(true);
      toast.success('Plan regenerated', {
        description: 'Workflow stayed at Plan Review with a new plan version.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan regeneration failed.';
      toast.error('Regenerate failed', { description: message });
    } finally {
      setIsGenerating(false);
    }
  }, [feedbackBySessionId, goalDraft, isGenerating, loadSessions, selectedSession]);

  const handleApprovePlanAndStart = useCallback(async () => {
    if (!selectedSession) {
      return;
    }

    if (selectedSession.planning_state !== 'plan_review') {
      toast.error('Cannot approve', {
        description: 'Only Plan Review state can move to next workflow step.',
      });
      return;
    }

    if (isApproving) {
      return;
    }

    setIsApproving(true);
    try {
      const response = await pmoApi.approvePlan(selectedSession.ingestion_session_id);
      const sourceFileKey =
        response.profiling_documents[0]?.source_file_key ?? profilingDocuments[0]?.source_file_key;

      let startedRunId: string | null = null;
      let startWorkflowError: string | null = null;

      if (!sourceFileKey) {
        startWorkflowError = 'No source workbook key found to start workflow run.';
      } else {
        try {
          const started = await pmoApi.startIngestWorkflow({
            ingestionSessionId: selectedSession.ingestion_session_id,
            fileKey: sourceFileKey,
            reportingPeriodKey: reportingPeriodKey.trim() || undefined,
          });
          startedRunId = started.runId;
        } catch (startErr) {
          startWorkflowError =
            startErr instanceof Error ? startErr.message : 'Failed to start workflow run.';
        }
      }

      await Promise.all([loadSessions(true), refreshWorkflowRuntime()]);

      if (startWorkflowError) {
        toast.error('Plan approved but workflow did not start', {
          description: startWorkflowError,
        });
      } else {
        toast.success('Plan approved and workflow started', {
          description: `Planner run ${shortId(startedRunId ?? '')} is now the source of truth for current step execution.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan approval failed.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApproving(false);
    }
  }, [
    isApproving,
    loadSessions,
    profilingDocuments,
    refreshWorkflowRuntime,
    reportingPeriodKey,
    selectedSession,
  ]);

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

    if (isApprovingProfiling) {
      return;
    }

    setIsApprovingProfiling(true);
    try {
      await pmoApi.approveProfilingContinue(selectedSession.ingestion_session_id);
      await loadSessions(true);
      toast.success('Profiling approved', {
        description: 'Workbook Profiling gate approved. Workflow moved to the next step.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve profiling gate.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApprovingProfiling(false);
    }
  }, [isApprovingProfiling, loadSessions, selectedSession]);

  const isWorkflowCancelable = useCallback((run: PmoPlanningSession): boolean => {
    return (
      run.workflow_step_status === 'in_progress' || run.workflow_step_status === 'needs_review'
    );
  }, []);

  const handleCancelWorkflow = useCallback(
    async (run: PmoPlanningSession) => {
      if (!isWorkflowCancelable(run)) {
        toast.error('Cannot cancel workflow', {
          description: 'Cancel is available only while the workflow is running.',
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
        await pmoApi.cancelWorkflow(run.ingestion_session_id);
        await loadSessions(true);
        toast.success('Workflow cancelled', {
          description: 'The running workflow has been cancelled successfully.',
        });
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
    [isCancellingWorkflowBySessionId, isWorkflowCancelable, loadSessions],
  );

  return {
    isUploading,
    isGenerating,
    isApproving,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    isCancellingWorkflowBySessionId,
    refreshPage,
    onFile,
    handleAnalyzeGeneratePlan,
    handleRegeneratePlan,
    handleApprovePlanAndStart,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    isWorkflowCancelable,
    handleCancelWorkflow,
  };
}
