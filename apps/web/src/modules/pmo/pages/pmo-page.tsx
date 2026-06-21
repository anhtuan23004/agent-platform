import { Button, Dropzone, Input, Label, PageChrome, Textarea, toast } from '@seta/shared-ui';
import { Loader2, RefreshCw, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type PmoPlan,
  type PmoPlanningSession,
  type PmoProfilingArea,
  pmoApi,
} from '../api/client';
import { PmoSessionHistoryPanel } from '../components/pmo-session-history-panel';
import { PmoWorkflowCardsSection } from '../components/pmo-workflow-cards-section';
import { usePmoMappingReviewActions } from '../hooks/use-pmo-mapping-review-actions';
import { usePmoNormalizationReviewActions } from '../hooks/use-pmo-normalization-review-actions';
import { usePmoPublishReviewActions } from '../hooks/use-pmo-publish-review-actions';
import { usePmoReportRangeActions } from '../hooks/use-pmo-report-range-actions';
import { type UploadedWorkbookInfo, usePmoSessionActions } from '../hooks/use-pmo-session-actions';
import { usePmoWorkflowRuntime } from '../hooks/use-pmo-workflow-runtime';
import {
  buildExecutionCards,
  formatBytes,
  formatLocalDate,
  profilingSheetKey,
} from './pmo-page.logic';

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

export function PmoPage() {
  const [reportingPeriodKey, setReportingPeriodKey] = useState('');
  const [goalDraft, setGoalDraft] = useState(
    'Ingest this workbook and prepare data for RA calculation.',
  );
  const [sessions, setSessions] = useState<PmoPlanningSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);

  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [profilingOverridesBySessionId, setProfilingOverridesBySessionId] = useState<
    Record<string, Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>>
  >({});

  const [uploadedInfo, setUploadedInfo] = useState<UploadedWorkbookInfo | null>(null);

  const [feedbackBySessionId, setFeedbackBySessionId] = useState<Record<string, string>>({});

  const selectedSession = useMemo(
    () =>
      sessions.find((row) => row.ingestion_session_id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  );

  const selectedFeedback = selectedSession
    ? (feedbackBySessionId[selectedSession.ingestion_session_id] ?? '')
    : '';

  const selectedUploadedSessionId =
    selectedSession?.planning_state === 'uploaded' &&
    selectedSession.workflow_step_status !== 'cancelled'
      ? selectedSession.ingestion_session_id
      : null;
  const fallbackUploadedSessionId = selectedSession
    ? null
    : (uploadedInfo?.ingestionSessionId ?? null);
  const targetGenerateSessionId: string | null =
    selectedUploadedSessionId ?? fallbackUploadedSessionId;

  const executionCards = buildExecutionCards(selectedSession);
  const executionState = selectedSession?.execution_state ?? null;
  const profilingDocuments = selectedSession?.profiling_documents.length
    ? selectedSession.profiling_documents
    : (executionState?.documents ?? []);
  const profilingSummary = selectedSession?.profiling_summary ?? executionState?.profiling_summary;
  const profilingReviewState =
    selectedSession?.profiling_review ?? executionState?.profiling_review;
  const selectedSessionOverrides = selectedSession
    ? (profilingOverridesBySessionId[selectedSession.ingestion_session_id] ?? {})
    : {};

  const {
    pendingApprovals,
    workflowRuns,
    runtimeRunBySessionId,
    mappingApprovals,
    selectedMappingApproval,
    selectedMappingView,
    groupedMappingItems,
    normalizationApprovals,
    selectedNormalizationApproval,
    selectedNormalizationView,
    publishApprovals,
    selectedPublishApproval,
    selectedPublishView,
    reportApprovals,
    selectedReportApproval,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  } = usePmoWorkflowRuntime({
    selectedSession,
    executionCards,
    executionCurrentStepNo: executionState?.current_step_no ?? null,
  });

  const feedbackHistoryItems = useMemo(() => {
    if (!selectedSession) {
      return [] as Array<{ key: string; feedback: string }>;
    }

    const duplicateCountByValue = new Map<string, number>();
    return selectedSession.feedback_history.map((feedback) => {
      const duplicateCount = (duplicateCountByValue.get(feedback) ?? 0) + 1;
      duplicateCountByValue.set(feedback, duplicateCount);

      return {
        key: `${selectedSession.ingestion_session_id}-feedback-${feedback}-${duplicateCount}`,
        feedback,
      };
    });
  }, [selectedSession]);

  const selectedRuntimeRun = selectedSession
    ? (runtimeRunBySessionId.get(selectedSession.ingestion_session_id) ?? null)
    : null;
  const runtimeCancelled = selectedRuntimeRun?.status === 'canceled';

  const executionCardsForDisplay = useMemo(() => {
    if (!runtimeCancelled) return executionCards;

    return executionCards.map((step) => {
      if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled') {
        return step;
      }

      return {
        ...step,
        status: 'cancelled' as const,
      };
    });
  }, [executionCards, runtimeCancelled]);

  const sessionsForHistory = useMemo(() => {
    return sessions.map((run) => {
      const runtimeStatus = runtimeRunBySessionId.get(run.ingestion_session_id)?.status;
      if (runtimeStatus !== 'canceled') return run;

      if (run.workflow_step_status === 'cancelled' && run.status_label === 'Cancelled') {
        return run;
      }

      return {
        ...run,
        status_label: 'Cancelled',
        active_gate: 'Workflow cancelled',
        workflow_step_status: 'cancelled' as const,
      };
    });
  }, [sessions, runtimeRunBySessionId]);

  const firstExecutionStepNo = executionCardsForDisplay[0]?.step_no ?? null;

  const loadSessions = useCallback(async (keepSelection = true) => {
    setIsLoadingSessions(true);
    try {
      const response = await pmoApi.listPlanningSessions();
      setSessions(response.items);
      const firstSessionId = response.items[0]?.ingestion_session_id ?? null;

      setSelectedSessionId((current) => {
        if (!keepSelection) {
          return firstSessionId;
        }

        if (!current) {
          return firstSessionId;
        }

        const exists = response.items.some((item) => item.ingestion_session_id === current);
        return exists ? current : firstSessionId;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load ingestion sessions.';
      toast.error('Failed to load sessions', { description: message });
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const refreshMappingApprovals = useCallback(async () => {
    await pendingApprovals.refetch();
  }, [pendingApprovals]);

  const refreshWorkflowRuntime = useCallback(async () => {
    await Promise.all([refreshMappingApprovals(), workflowRuns.refetch()]);
  }, [refreshMappingApprovals, workflowRuns]);

  const {
    isUploading,
    isGenerating,
    generatingSessionId,
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
  } = usePmoSessionActions({
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
  });

  const {
    editingMappingKey,
    selectedMappingAlternate,
    editingMappingItem,
    editingMappingAlternates,
    selectedAlternateOption,
    canProceedToNextStep,
    isSubmittingDecision,
    approveCurrentMappingItem,
    openMappingModify,
    applyMappingModify,
    proceedToNextWorkflowStep,
    selectMappingAlternate,
    cancelMappingModify,
  } = usePmoMappingReviewActions({
    selectedSessionId,
    selectedMappingApproval,
    selectedMappingView,
    loadSessions,
    refreshMappingApprovals,
  });

  const { isSubmittingPublishDecision, approvePublish, rejectPublish } = usePmoPublishReviewActions(
    {
      selectedPublishApproval,
      loadSessions,
      refreshWorkflowRuntime,
    },
  );

  const { isSubmittingReportDecision, confirmReportRange, rejectReportRange } =
    usePmoReportRangeActions({
      selectedReportApproval,
      loadSessions,
      refreshWorkflowRuntime,
    });

  const {
    normalizationReviewView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  } = usePmoNormalizationReviewActions({
    selectedNormalizationApproval,
    selectedNormalizationView,
    loadSessions,
    refreshWorkflowRuntime,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessions(false);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadSessions]);

  const handleSelectProfilingArea = useCallback(
    (documentId: string, sheetName: string, selectedArea: PmoProfilingArea) => {
      if (!selectedSession) {
        return;
      }

      const key = profilingSheetKey(documentId, sheetName);
      const sessionId = selectedSession.ingestion_session_id;

      setProfilingOverridesBySessionId((prev) => ({
        ...prev,
        [sessionId]: {
          ...(prev[sessionId] ?? {}),
          [key]: {
            finalArea: selectedArea,
            markIgnore: selectedArea === 'unknown',
          },
        },
      }));
    },
    [selectedSession],
  );

  const handleToggleProfilingIgnore = useCallback(
    (documentId: string, sheetName: string, checked: boolean, fallbackArea: PmoProfilingArea) => {
      if (!selectedSession) {
        return;
      }

      const key = profilingSheetKey(documentId, sheetName);
      const sessionId = selectedSession.ingestion_session_id;

      setProfilingOverridesBySessionId((prev) => {
        const currentOverride = prev[sessionId]?.[key];

        return {
          ...prev,
          [sessionId]: {
            ...(prev[sessionId] ?? {}),
            [key]: {
              finalArea: checked ? 'unknown' : (currentOverride?.finalArea ?? fallbackArea),
              markIgnore: checked,
            },
          },
        };
      });
    },
    [selectedSession],
  );

  const plan: PmoPlan | null = selectedSession?.plan ?? null;
  const executionRuntime = {
    executionCurrentStepNo: executionState?.current_step_no ?? null,
    executionCurrentStepStatus: runtimeCancelled
      ? ('cancelled' as const)
      : (executionState?.current_step_status ?? null),
    firstExecutionStepNo,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  };

  const executionMapping = {
    selectedMappingApproval,
    mappingApprovalsCount: mappingApprovals.length,
    groupedMappingItems,
    selectedMappingView,
    editingMappingKey,
    selectedMappingAlternate,
    editingMappingItem,
    editingMappingAlternates,
    selectedAlternateOption,
    canProceedToNextStep,
    isSubmittingDecision,
    approveCurrentMappingItem,
    openMappingModify,
    applyMappingModify,
    proceedToNextWorkflowStep,
    selectMappingAlternate,
    cancelMappingModify,
  };

  const executionNormalization = {
    selectedNormalizationApproval,
    normalizationApprovalsCount: normalizationApprovals.length,
    selectedNormalizationView: normalizationReviewView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  };

  const executionPublish = {
    selectedPublishApproval,
    publishApprovalsCount: publishApprovals.length,
    selectedPublishView,
    isSubmittingPublishDecision,
    approvePublish,
    rejectPublish,
  };

  const executionReport = {
    selectedReportApproval,
    reportApprovalsCount: reportApprovals.length,
    isSubmittingReportDecision,
    confirmReportRange,
    rejectReportRange,
  };

  const executionProfiling = {
    profilingReviewState,
    profilingSummary,
    profilingDocuments,
    selectedSessionOverrides,
    profilingAreas: PROFILING_AREAS,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    dropzoneAccept: ACCEPT,
    dropzoneMaxBytes: MAX_BYTES,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    onSelectSheetArea: handleSelectProfilingArea,
    onToggleSheetIgnore: handleToggleProfilingIgnore,
  };

  const executionPlan = {
    plan,
    goalDraft,
  };

  return (
    <PageChrome
      breadcrumb={['Work']}
      title="PMO Ingestion"
      subtitle="Persisted state workflow: upload -> generate plan -> review/regenerate -> approve."
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={refreshPage}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="min-h-full bg-surface-1 px-4 py-5 pb-8 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3">
          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-md bg-primary-tint p-2 text-primary">
                <Workflow className="size-5" />
              </span>
              <div>
                <h2 className="text-body-sm font-semibold text-ink">Workflow path</h2>
                <p className="mt-0.5 text-body-sm text-ink-subtle">
                  Upload workbook, generate plan from Goal via LLM, review/regenerate, then approve.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="reporting-period-key">Reporting period key (optional)</Label>
                  <Input
                    id="reporting-period-key"
                    value={reportingPeriodKey}
                    onChange={(e) => setReportingPeriodKey(e.target.value)}
                    placeholder="e.g. 2025-W35"
                    disabled={isUploading || isGenerating}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pmo-goal-input">Goal</Label>
                    <span className="text-caption text-ink-subtle">{goalDraft.length} / 500</span>
                  </div>
                  <Textarea
                    id="pmo-goal-input"
                    rows={3}
                    maxLength={500}
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                    className="resize-none"
                    placeholder="Describe an ingest workflow or a report to generate from PMO data."
                    disabled={isGenerating}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={handleAnalyzeGeneratePlan}
                    disabled={(!targetGenerateSessionId && !goalDraft.trim()) || isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating plan...
                      </>
                    ) : (
                      'Analyze & generate plan'
                    )}
                  </Button>

                  <span className="rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-caption text-ink-subtle">
                    {targetGenerateSessionId
                      ? 'Ready to generate plan'
                      : 'Enter a database report goal or upload a workbook'}
                  </span>
                </div>
              </section>

              <Dropzone
                accept={ACCEPT}
                maxBytes={MAX_BYTES}
                label="Drop PMO workbook here, or click to choose"
                hint="XLSX / XLSM · up to 50 MB"
                pendingLabel="Uploading workbook..."
                tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
                isPending={isUploading}
                onFile={onFile}
              />
            </div>

            {uploadedInfo ? (
              <section className="mt-3 rounded-lg border border-hairline bg-surface-1 p-3 text-caption">
                <h3 className="text-body-sm font-semibold text-ink">Uploaded workbook</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <p className="text-ink-subtle">
                    Session:{' '}
                    <span className="font-medium text-ink">{uploadedInfo.ingestionSessionId}</span>
                  </p>
                  <p className="text-ink-subtle">
                    Name: <span className="font-medium text-ink">{uploadedInfo.fileName}</span>
                  </p>
                  <p className="text-ink-subtle">
                    Size:{' '}
                    <span className="font-medium text-ink">
                      {formatBytes(uploadedInfo.fileSizeBytes)}
                    </span>
                  </p>
                  <p className="text-ink-subtle">
                    Uploaded at:{' '}
                    <span className="font-medium text-ink">
                      {formatLocalDate(uploadedInfo.uploadedAtIso)}
                    </span>
                  </p>
                </div>
              </section>
            ) : null}
          </section>

          <PmoSessionHistoryPanel
            sessions={sessionsForHistory}
            selectedSessionId={selectedSession?.ingestion_session_id ?? null}
            isLoadingSessions={isLoadingSessions}
            isCancellingWorkflowBySessionId={isCancellingWorkflowBySessionId}
            generatingSessionId={generatingSessionId}
            isWorkflowCancelable={isWorkflowCancelable}
            isSessionGeneratable={isSessionGeneratable}
            onSelectSession={setSelectedSessionId}
            onViewSession={(sessionId) => {
              setSelectedSessionId(sessionId);
              setIsReviewPanelOpen(true);
            }}
            onGeneratePlan={handleGeneratePlanForSession}
            onCancelWorkflow={handleCancelWorkflow}
          />

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            {!isReviewPanelOpen ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Select one run and click View to open Plan tab.
              </section>
            ) : !selectedSession ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Selected run was not found.
              </section>
            ) : (
              <div className="space-y-3">
                <PmoWorkflowCardsSection
                  selectedSession={selectedSession}
                  plan={plan}
                  goalDraft={goalDraft}
                  executionCards={executionCardsForDisplay}
                  selectedFeedback={selectedFeedback}
                  onFeedbackChange={(nextValue) => {
                    setFeedbackBySessionId((prev) => ({
                      ...prev,
                      [selectedSession.ingestion_session_id]: nextValue,
                    }));
                  }}
                  isGenerating={isGenerating}
                  isApproving={isApproving}
                  isConfirmingIntent={isConfirmingIntent}
                  onConfirmIntent={handleConfirmPlanIntent}
                  onRegeneratePlan={handleRegeneratePlan}
                  onApprovePlanAndStart={handleApprovePlanAndStart}
                  feedbackHistoryItems={feedbackHistoryItems}
                  runtime={executionRuntime}
                  mapping={executionMapping}
                  normalization={executionNormalization}
                  publish={executionPublish}
                  report={executionReport}
                  profiling={executionProfiling}
                  planContext={executionPlan}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </PageChrome>
  );
}
