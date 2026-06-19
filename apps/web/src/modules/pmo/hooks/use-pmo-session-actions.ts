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
import { workflowRuntimeApi } from '../api/workflow-runtime';
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
  runtimeRunBySessionId: Map<string, { runId: string; status: string }>;
}

interface UsePmoSessionActionsResult {
  isUploading: boolean;
  isGenerating: boolean;
  isApproving: boolean;
  isConfirmingIntent: boolean;
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  isCancellingWorkflowBySessionId: Record<string, boolean>;
  refreshPage: () => void;
  onFile: (file: File) => Promise<void>;
  handleAnalyzeGeneratePlan: () => Promise<void>;
  handleGeneratePlanForSession: (session: PmoPlanningSession) => Promise<void>;
  handleRegeneratePlan: () => Promise<void>;
  handleApprovePlanAndStart: () => Promise<void>;
  handleConfirmPlanIntent: (selection?: {
    dateRangeStrategy?: 'sheet_derived' | 'manual_database';
    dateRange?: { from: string; to: string };
  }) => Promise<void>;
  handleAppendDocument: (file: File) => Promise<void>;
  handleSaveProfilingReview: () => Promise<void>;
  handleApproveProfilingContinue: () => Promise<void>;
  isWorkflowCancelable: (run: PmoPlanningSession) => boolean;
  isSessionGeneratable: (run: PmoPlanningSession) => boolean;
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
    runtimeRunBySessionId,
  } = options;

  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isConfirmingIntent, setIsConfirmingIntent] = useState(false);
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
    if (!targetGenerateSessionId && !goalDraft.trim()) {
      toast.error('Goal required', {
        description: 'Describe the database report you want, or upload a workbook first.',
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
        ...(targetGenerateSessionId ? { ingestion_session_id: targetGenerateSessionId } : {}),
        goal,
      };

      const generated = await pmoApi.generatePlan(payload);
      await loadSessions(true);
      setSelectedSessionId(generated.ingestion_session_id);

      toast.success(
        generated.planning_state === 'intent_review' ? 'Intent ready' : 'Plan generated',
        {
          description:
            generated.planning_state === 'intent_review'
              ? 'Confirm report date range before plan generation.'
              : 'Upload history status moved to Plan Review.',
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan generation failed.';
      toast.error('Generate failed', { description: message });
    } finally {
      setIsGenerating(false);
    }
  }, [goalDraft, isGenerating, loadSessions, setSelectedSessionId, targetGenerateSessionId]);

  const handleGeneratePlanForSession = useCallback(
    async (session: PmoPlanningSession) => {
      if (session.planning_state !== 'uploaded') {
        toast.error('Cannot generate plan', {
          description: 'Plan generation is available only for uploaded sessions.',
        });
        return;
      }

      if (session.workflow_step_status === 'cancelled') {
        toast.error('Cannot generate plan', {
          description: 'This upload session has been cancelled.',
        });
        return;
      }

      if (isGenerating) {
        return;
      }

      const goal = goalDraft.trim() || session.goal || 'Generate plan from uploaded workbook.';

      setIsGenerating(true);
      try {
        await pmoApi.generatePlan({
          ingestion_session_id: session.ingestion_session_id,
          goal,
        });
        setSelectedSessionId(session.ingestion_session_id);
        setIsReviewPanelOpen(true);
        await loadSessions(true);

        toast.success('Plan generated', {
          description: 'Upload history status moved to Plan Review.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Plan generation failed.';
        toast.error('Generate failed', { description: message });
      } finally {
        setIsGenerating(false);
      }
    },
    [goalDraft, isGenerating, loadSessions, setIsReviewPanelOpen, setSelectedSessionId],
  );

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
      await pmoApi.approvePlan(selectedSession.ingestion_session_id);
      const isDatabaseReport =
        selectedSession.plan?.intent_analysis?.intent_mode === 'generate_report_intent';
      if (isDatabaseReport && !runtimeRunBySessionId.has(selectedSession.ingestion_session_id)) {
        await pmoApi.startIngestWorkflow({
          ingestionSessionId: selectedSession.ingestion_session_id,
        });
      }
      await Promise.all([loadSessions(true), refreshWorkflowRuntime()]);

      toast.success('Plan approved', {
        description: isDatabaseReport
          ? 'The database report workflow has started.'
          : 'Workbook Profiling is ready for PMO review before the runtime workflow starts.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan approval failed.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApproving(false);
    }
  }, [isApproving, loadSessions, refreshWorkflowRuntime, runtimeRunBySessionId, selectedSession]);

  const handleConfirmPlanIntent = useCallback(
    async (selection?: {
      dateRangeStrategy?: 'sheet_derived' | 'manual_database';
      dateRange?: { from: string; to: string };
    }) => {
      if (!selectedSession) {
        return;
      }

      if (selectedSession.planning_state !== 'intent_review') {
        toast.error('Cannot confirm intent', {
          description: 'Intent can be confirmed only while intent review is active.',
        });
        return;
      }

      if (isConfirmingIntent) {
        return;
      }

      setIsConfirmingIntent(true);
      try {
        await pmoApi.confirmPlanIntent({
          ingestionSessionId: selectedSession.ingestion_session_id,
          dateRangeStrategy: selection?.dateRangeStrategy,
          dateRange: selection?.dateRange,
        });
        await pmoApi.generatePlan({
          ingestion_session_id: selectedSession.ingestion_session_id,
          goal: selectedSession.goal,
        });
        await loadSessions(true);

        toast.success('Intent confirmed', {
          description: 'Intent used as input. Plan review now ready.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Intent confirmation failed.';
        toast.error('Confirm intent failed', { description: message });
      } finally {
        setIsConfirmingIntent(false);
      }
    },
    [isConfirmingIntent, loadSessions, selectedSession],
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

    if (isApprovingProfiling) {
      return;
    }

    setIsApprovingProfiling(true);
    try {
      const response = await pmoApi.approveProfilingContinue(selectedSession.ingestion_session_id);
      const existingRuntimeRun = runtimeRunBySessionId.get(selectedSession.ingestion_session_id);
      const sourceFileKey =
        response.profiling_documents[0]?.source_file_key ?? profilingDocuments[0]?.source_file_key;

      let startedRunId: string | null = null;
      let startWorkflowError: string | null = null;

      if (!existingRuntimeRun) {
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
      }

      await Promise.all([loadSessions(true), refreshWorkflowRuntime()]);

      if (startWorkflowError) {
        toast.error('Profiling approved but workflow did not start', {
          description: startWorkflowError,
        });
      } else if (startedRunId) {
        toast.success('Profiling approved and workflow started', {
          description: `Workflow run ${shortId(startedRunId)} is now synchronized from PMO decisions.`,
        });
      } else {
        toast.success('Profiling approved', {
          description: 'Workflow moved to the next PMO-controlled step.',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve profiling gate.';
      toast.error('Approve failed', { description: message });
    } finally {
      setIsApprovingProfiling(false);
    }
  }, [
    isApprovingProfiling,
    loadSessions,
    profilingDocuments,
    refreshWorkflowRuntime,
    reportingPeriodKey,
    runtimeRunBySessionId,
    selectedSession,
  ]);

  const isRuntimeRunCancelable = useCallback((status: string | null | undefined): boolean => {
    return status === 'running' || status === 'paused';
  }, []);

  const isWorkflowCancelable = useCallback(
    (run: PmoPlanningSession): boolean => {
      const runtimeStatus = runtimeRunBySessionId.get(run.ingestion_session_id)?.status;
      return (
        (run.planning_state === 'uploaded' && run.workflow_step_status !== 'cancelled') ||
        isRuntimeRunCancelable(runtimeStatus) ||
        run.workflow_step_status === 'in_progress' ||
        run.workflow_step_status === 'needs_review'
      );
    },
    [isRuntimeRunCancelable, runtimeRunBySessionId],
  );

  const isSessionGeneratable = useCallback((run: PmoPlanningSession): boolean => {
    return run.planning_state === 'uploaded' && run.workflow_step_status !== 'cancelled';
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
        const runtimeRun = runtimeRunBySessionId.get(run.ingestion_session_id);
        const shouldCancelRuntime = isRuntimeRunCancelable(runtimeRun?.status);
        const shouldCancelPmo =
          run.planning_state === 'uploaded' ||
          run.workflow_step_status === 'in_progress' ||
          run.workflow_step_status === 'needs_review';

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
    isGenerating,
    isApproving,
    isConfirmingIntent,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    isCancellingWorkflowBySessionId,
    refreshPage,
    onFile,
    handleAnalyzeGeneratePlan,
    handleGeneratePlanForSession,
    handleRegeneratePlan,
    handleApprovePlanAndStart,
    handleConfirmPlanIntent,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    isWorkflowCancelable,
    isSessionGeneratable,
    handleCancelWorkflow,
  };
}
