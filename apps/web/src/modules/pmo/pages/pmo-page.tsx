import { Button, PageChrome, toast } from '@seta/shared-ui';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type PmoPlan,
  type PmoPlanningSession,
  type PmoProfilingArea,
  pmoApi,
} from '../api/client';
import { PmoSessionHistoryPanel } from '../components/pmo-session-history-panel';
import { PmoWorkflowCardsSection, workflowCardId } from '../components/pmo-workflow-cards-section';
import { usePmoMappingReviewActions } from '../hooks/use-pmo-mapping-review-actions';
import { usePmoNormalizationReviewActions } from '../hooks/use-pmo-normalization-review-actions';
import { usePmoPublishReviewActions } from '../hooks/use-pmo-publish-review-actions';
import { usePmoReportRangeActions } from '../hooks/use-pmo-report-range-actions';
import { usePmoSessionActions } from '../hooks/use-pmo-session-actions';
import { usePmoWorkflowRuntime } from '../hooks/use-pmo-workflow-runtime';
import {
  buildExecutionCards,
  hasActiveIngestionSessionForPolling,
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
  const [sessions, setSessions] = useState<PmoPlanningSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [historyViewSessionId, setHistoryViewSessionId] = useState<string | null>(null);

  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [profilingOverridesBySessionId, setProfilingOverridesBySessionId] = useState<
    Record<string, Record<string, { finalArea: PmoProfilingArea; markIgnore: boolean }>>
  >({});

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return sessions.find((row) => row.ingestion_session_id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

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
    selectedProfilingApproval,
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
    approvalByActionId,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  } = usePmoWorkflowRuntime({
    selectedSession,
    executionCards,
    executionCurrentStepNo: executionState?.current_step_no ?? null,
  });

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

  const historyInitialCardId = useMemo(() => {
    if (!selectedSession || historyViewSessionId !== selectedSession.ingestion_session_id) {
      return null;
    }
    const firstStep = executionCardsForDisplay[0];
    return firstStep ? workflowCardId(firstStep.step_no) : null;
  }, [executionCardsForDisplay, historyViewSessionId, selectedSession]);

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
    const res = await pendingApprovals.refetch();
    return res;
  }, [pendingApprovals]);

  const refreshWorkflowRuntime = useCallback(async () => {
    const [approvalsRes] = await Promise.all([refreshMappingApprovals(), workflowRuns.refetch()]);
    return approvalsRes;
  }, [refreshMappingApprovals, workflowRuns]);

  const {
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    isCancellingWorkflowBySessionId,
    refreshPage,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    isWorkflowCancelable,
    handleCancelWorkflow,
  } = usePmoSessionActions({
    selectedSession,
    profilingOverridesBySessionId,
    loadSessions,
    refreshWorkflowRuntime,
    runtimeRunBySessionId,
    profilingApproval: selectedProfilingApproval,
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

  // Poll for session updates while any session is in a non-terminal state.
  const hasActiveSession = hasActiveIngestionSessionForPolling(sessions);
  useEffect(() => {
    if (!hasActiveSession) return;
    const timer = window.setInterval(() => {
      void loadSessions(true);
      void refreshWorkflowRuntime();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [hasActiveSession, loadSessions, refreshWorkflowRuntime]);

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
    approvalByActionId,
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
    goalDraft: '',
  };

  return (
    <PageChrome
      breadcrumb={['Work']}
      title="PMO Ingestion History"
      subtitle="View past ingestion sessions, workflow status, and audit trail. Start new ingestion from PMO Agent chat."
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
          <PmoSessionHistoryPanel
            sessions={sessionsForHistory}
            selectedSessionId={selectedSession?.ingestion_session_id ?? null}
            isLoadingSessions={isLoadingSessions}
            isCancellingWorkflowBySessionId={isCancellingWorkflowBySessionId}
            isWorkflowCancelable={isWorkflowCancelable}
            onSelectSession={setSelectedSessionId}
            onViewSession={(sessionId) => {
              setSelectedSessionId(sessionId);
              setHistoryViewSessionId(sessionId);
              setIsReviewPanelOpen(true);
            }}
            onCancelWorkflow={handleCancelWorkflow}
          />

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
            {!isReviewPanelOpen ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Select one run and click View to inspect its workflow steps.
              </section>
            ) : !selectedSession ? (
              <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
                Selected run was not found. Refresh the page and try again.
              </section>
            ) : (
              <div className="space-y-3">
                <PmoWorkflowCardsSection
                  key={selectedSession.ingestion_session_id}
                  selectedSession={selectedSession}
                  executionCards={executionCardsForDisplay}
                  isAgentRunning={false}
                  readOnly
                  initialSelectedCardId={historyInitialCardId}
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
