import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PmoPlanningSession } from '../api/client';
import {
  type WorkflowApprovalRow,
  type WorkflowRunRow,
  workflowRuntimeApi,
} from '../api/workflow-runtime';
import {
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  findLatestApprovalByAction,
  isMappingApprovalRow,
  isNormalizationApprovalRow,
  isProfilingApprovalRow,
  isPublishApprovalRow,
  isReportApprovalRow,
  type MappingProgressItem,
  type MappingViewModel,
  mergeSessionApprovals,
  type NormalizationReviewViewModel,
  type PmoPlanActionId,
  type PublishReviewViewModel,
  parseMappingView,
  parseNormalizationReviewView,
  parsePublishReviewView,
  readActionIdFromApproval,
  readActiveWorkflowStepId,
  readIngestionSessionIdFromApproval,
  readIngestionSessionIdFromRunInput,
  sessionIdsMatch,
} from '../pages/pmo-page.logic';
import {
  useWorkflowRuntimePendingApprovals,
  useWorkflowRuntimeRunSnapshot,
  useWorkflowRuntimeRuns,
  workflowRuntimeQueryKeys,
} from './use-workflow-runtime';

function findApprovalByAction(
  approvals: WorkflowApprovalRow[],
  actionId: PmoPlanActionId,
): WorkflowApprovalRow | null {
  return approvals.find((approval) => readActionIdFromApproval(approval) === actionId) ?? null;
}

/**
 * Resolve the best matching approval from a filtered list of candidates.
 *
 * Priority:
 *  1. runId match (same workflow run)
 *  2. ingestion session id embedded in the card payload
 *  3. surfaceChatThreadId matches session's chat_thread_id
 *  4. singleton fallback (exactly one candidate)
 *  5. most recently created candidate (last resort when multiple
 *     candidates exist but none matched by the tiers above — handles
 *     stale approvals from old sessions and __LOCALID_* thread ids)
 */
function resolveApproval(
  candidates: WorkflowApprovalRow[],
  session: PmoPlanningSession | null,
  workflowRunId: string | undefined,
): WorkflowApprovalRow | null {
  if (!session || candidates.length === 0) return null;

  // 1. runId
  if (workflowRunId) {
    const byRun = candidates.find((a) => a.runId === workflowRunId);
    if (byRun) return byRun;
  }

  // 2. ingestion session id in payload
  const bySession = candidates.find((a) => {
    const id = readIngestionSessionIdFromApproval(a);
    return sessionIdsMatch(id, session.ingestion_session_id);
  });
  if (bySession) return bySession;

  // 3. chat thread id
  if (session.chat_thread_id) {
    const byThread = candidates.find(
      (a) => a.surfaceChatThreadId && a.surfaceChatThreadId === session.chat_thread_id,
    );
    if (byThread) return byThread;
  }

  // 4. singleton fallback
  if (candidates.length === 1) return candidates[0] ?? null;

  // 5. most recently created — when multiple candidates exist but none
  // matched above (e.g. __LOCALID_* thread ids, missing session id in
  // payload, stale approvals from prior sessions).
  const sorted = [...candidates].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return sorted[0] ?? null;
}

export interface GroupedMappingItemsBySheet {
  sheetName: string;
  items: MappingProgressItem[];
}

export interface UsePmoWorkflowRuntimeOptions {
  selectedSession: PmoPlanningSession | null;
  executionCards: ExecutionCard[];
  executionCurrentStepNo: number | null;
}

export interface UsePmoWorkflowRuntimeResult {
  pendingApprovals: ReturnType<typeof useWorkflowRuntimePendingApprovals>;
  workflowRuns: ReturnType<typeof useWorkflowRuntimeRuns>;
  runtimeRunBySessionId: Map<string, { runId: string; status: WorkflowRunRow['status'] }>;
  profilingApprovals: WorkflowApprovalRow[];
  selectedProfilingApproval: WorkflowApprovalRow | null;
  mappingApprovals: WorkflowApprovalRow[];
  selectedMappingApproval: WorkflowApprovalRow | null;
  selectedMappingView: MappingViewModel | null;
  groupedMappingItems: GroupedMappingItemsBySheet[];
  normalizationApprovals: WorkflowApprovalRow[];
  selectedNormalizationApproval: WorkflowApprovalRow | null;
  selectedNormalizationView: NormalizationReviewViewModel | null;
  publishApprovals: WorkflowApprovalRow[];
  selectedPublishApproval: WorkflowApprovalRow | null;
  selectedPublishView: PublishReviewViewModel | null;
  reportApprovals: WorkflowApprovalRow[];
  selectedReportApproval: WorkflowApprovalRow | null;
  approvalByActionId: Partial<Record<PmoPlanActionId, WorkflowApprovalRow>>;
  runtimeActiveStepId: string | null;
  hasRuntimeCurrentStepMatch: boolean;
}

export function usePmoWorkflowRuntime(
  options: UsePmoWorkflowRuntimeOptions,
): UsePmoWorkflowRuntimeResult {
  const { selectedSession, executionCards } = options;

  const pendingApprovals = useWorkflowRuntimePendingApprovals();

  const workflowRuns = useWorkflowRuntimeRuns({
    scope: 'self',
    workflowId: 'pmo.orchestrator',
  });

  const pmoIngestRuns = useMemo(() => {
    return (workflowRuns.data?.pages.flatMap((page) => page.rows) ?? []) as WorkflowRunRow[];
  }, [workflowRuns.data]);

  const runtimeRunBySessionId = useMemo(() => {
    const map = new Map<
      string,
      { runId: string; status: WorkflowRunRow['status']; startedAt: string }
    >();
    for (const run of pmoIngestRuns) {
      const ingestionSessionId = readIngestionSessionIdFromRunInput(run.inputSummary);
      if (!ingestionSessionId) continue;
      const existing = map.get(ingestionSessionId);
      if (!existing || run.startedAt > existing.startedAt) {
        map.set(ingestionSessionId, {
          runId: run.runId,
          status: run.status,
          startedAt: run.startedAt,
        });
      }
    }
    return new Map(
      [...map.entries()].map(([sessionId, value]) => [
        sessionId,
        { runId: value.runId, status: value.status },
      ]),
    );
  }, [pmoIngestRuns]);

  const selectedWorkflowRun = useMemo(() => {
    if (!selectedSession) return null;

    const directMatch = runtimeRunBySessionId.get(selectedSession.ingestion_session_id);
    if (directMatch) {
      return pmoIngestRuns.find((run) => run.runId === directMatch.runId) ?? null;
    }

    const matchedBySession = pmoIngestRuns
      .filter((run) => {
        const ingestionSessionId = readIngestionSessionIdFromRunInput(run.inputSummary);
        return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (matchedBySession) return matchedBySession;

    return null;
  }, [pmoIngestRuns, runtimeRunBySessionId, selectedSession]);

  const profilingApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isProfilingApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const mappingApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isMappingApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const publishApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isPublishApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const reportApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isReportApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const normalizationApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isNormalizationApprovalRow(approval)),
    [pendingApprovals.data],
  );

  const selectedMappingApproval = useMemo(
    () => resolveApproval(mappingApprovals, selectedSession, selectedWorkflowRun?.runId),
    [mappingApprovals, selectedSession, selectedWorkflowRun],
  );

  const selectedNormalizationApproval = useMemo(
    () => resolveApproval(normalizationApprovals, selectedSession, selectedWorkflowRun?.runId),
    [normalizationApprovals, selectedSession, selectedWorkflowRun],
  );

  const selectedPublishApproval = useMemo(
    () => resolveApproval(publishApprovals, selectedSession, selectedWorkflowRun?.runId),
    [publishApprovals, selectedSession, selectedWorkflowRun],
  );

  const selectedReportApproval = useMemo(
    () => resolveApproval(reportApprovals, selectedSession, selectedWorkflowRun?.runId),
    [reportApprovals, selectedSession, selectedWorkflowRun],
  );

  const selectedProfilingApproval = useMemo(
    () => resolveApproval(profilingApprovals, selectedSession, selectedWorkflowRun?.runId),
    [profilingApprovals, selectedSession, selectedWorkflowRun],
  );

  // Match pending approvals by runId OR by ingestion session id embedded in
  // the approval payload. Each agent tool suspension creates a new
  // workflow_runs row (new runId), so the latest pending approval may have a
  // different runId than the one cached in runtimeRunBySessionId. Matching by
  // session id ensures approvals are never dropped due to stale runId refs.
  const pendingApprovalsForSelectedSession = useMemo(() => {
    if (!selectedSession) return [] as WorkflowApprovalRow[];
    const rows = pendingApprovals.data ?? [];
    return rows.filter((approval) => {
      if (selectedWorkflowRun?.runId && approval.runId === selectedWorkflowRun.runId) return true;
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
  }, [pendingApprovals.data, selectedSession, selectedWorkflowRun]);

  const selectedWorkflowRunId =
    selectedWorkflowRun?.runId ??
    selectedProfilingApproval?.runId ??
    selectedMappingApproval?.runId ??
    selectedNormalizationApproval?.runId ??
    selectedPublishApproval?.runId ??
    selectedReportApproval?.runId ??
    '';
  const selectedWorkflowRunSnapshot = useWorkflowRuntimeRunSnapshot(selectedWorkflowRunId);

  const sessionRunIds = useMemo(() => {
    if (!selectedSession) return [] as string[];
    return pmoIngestRuns
      .filter((run) =>
        sessionIdsMatch(
          readIngestionSessionIdFromRunInput(run.inputSummary),
          selectedSession.ingestion_session_id,
        ),
      )
      .map((run) => run.runId);
  }, [pmoIngestRuns, selectedSession]);

  const threadApprovalsQuery = useQuery({
    queryKey: ['pmo', 'session-thread-approvals', selectedSession?.chat_thread_id],
    queryFn: () =>
      workflowRuntimeApi.listThreadApprovals(selectedSession?.chat_thread_id as string),
    enabled: Boolean(selectedSession?.chat_thread_id),
    staleTime: 30_000,
  });

  const runApprovalsQueries = useQueries({
    queries: sessionRunIds.map((runId) => ({
      queryKey: workflowRuntimeQueryKeys.runApprovals(runId),
      queryFn: () => workflowRuntimeApi.listRunApprovals(runId),
      enabled: Boolean(runId) && !selectedSession?.chat_thread_id,
      staleTime: 60_000,
    })),
  });

  // Each agentic HITL suspend writes a new workflow_runs row (new runId). History
  // must merge approvals across every run — or the whole chat thread — for one session.
  const sessionHistoricalApprovals = useMemo(() => {
    if (!selectedSession) return [] as WorkflowApprovalRow[];

    if (selectedSession.chat_thread_id && threadApprovalsQuery.data) {
      return mergeSessionApprovals(
        threadApprovalsQuery.data as WorkflowApprovalRow[],
        selectedSession.ingestion_session_id,
        sessionRunIds,
      );
    }

    const merged: WorkflowApprovalRow[] = [];
    for (const query of runApprovalsQueries) {
      if (query.data) merged.push(...query.data);
    }
    return mergeSessionApprovals(merged, selectedSession.ingestion_session_id, sessionRunIds);
  }, [runApprovalsQueries, selectedSession, sessionRunIds, threadApprovalsQuery.data]);

  const historicalProfilingApproval = useMemo(
    () => sessionHistoricalApprovals.find((approval) => isProfilingApprovalRow(approval)) ?? null,
    [sessionHistoricalApprovals],
  );
  const historicalMappingApproval = useMemo(
    () => sessionHistoricalApprovals.find((approval) => isMappingApprovalRow(approval)) ?? null,
    [sessionHistoricalApprovals],
  );
  const historicalNormalizationApproval = useMemo(
    () =>
      sessionHistoricalApprovals.find((approval) => isNormalizationApprovalRow(approval)) ?? null,
    [sessionHistoricalApprovals],
  );
  const historicalPublishApproval = useMemo(
    () => sessionHistoricalApprovals.find((approval) => isPublishApprovalRow(approval)) ?? null,
    [sessionHistoricalApprovals],
  );
  const historicalReportApproval = useMemo(
    () => sessionHistoricalApprovals.find((approval) => isReportApprovalRow(approval)) ?? null,
    [sessionHistoricalApprovals],
  );

  // Use pending approval when available (actionable), fall back to decided
  // approval from the run history (read-only).
  const effectiveProfilingApproval = selectedProfilingApproval ?? historicalProfilingApproval;
  const effectiveMappingApproval = selectedMappingApproval ?? historicalMappingApproval;
  const effectiveNormalizationApproval =
    selectedNormalizationApproval ?? historicalNormalizationApproval;
  const effectivePublishApproval = selectedPublishApproval ?? historicalPublishApproval;
  const effectiveReportApproval = selectedReportApproval ?? historicalReportApproval;

  // approvalByActionId resolves each known action to its canonical approval
  // row: pending first, then historical. No synthetic fallback from step view
  // state — step_views.approval_payload is a cached display snapshot only.
  const approvalByActionId = useMemo(() => {
    const actionIds: PmoPlanActionId[] = [
      'workbook_profiling',
      'column_mapping',
      'normalize_to_staging',
      'database_change_summary',
      'publish_after_approval',
      'generate_report',
      'generic_review',
    ];
    const out: Partial<Record<PmoPlanActionId, WorkflowApprovalRow>> = {};
    for (const actionId of actionIds) {
      const pending = findApprovalByAction(pendingApprovalsForSelectedSession, actionId);
      const historical = findLatestApprovalByAction(sessionHistoricalApprovals, actionId);
      const approval = pending ?? historical;
      if (approval) out[actionId] = approval;
    }
    return out;
  }, [pendingApprovalsForSelectedSession, sessionHistoricalApprovals]);

  const selectedMappingApprovalForDisplay = useMemo(() => {
    const approval = effectiveMappingApproval;
    if (!approval) return null;
    // For decided (historical) approvals, always display them — the
    // "has later pending approval" suppression only applies to pending ones.
    if (approval.status !== 'pending') return approval;
    const mappingRunId = approval.runId;
    const hasLaterApprovalForRun =
      normalizationApprovals.some((a) => a.runId === mappingRunId) ||
      publishApprovals.some((a) => a.runId === mappingRunId) ||
      reportApprovals.some((a) => a.runId === mappingRunId);
    return hasLaterApprovalForRun ? null : approval;
  }, [normalizationApprovals, publishApprovals, reportApprovals, effectiveMappingApproval]);

  const runtimeActiveStepId = useMemo(() => {
    if (selectedReportApproval?.stepId) return selectedReportApproval.stepId;
    if (selectedPublishApproval?.stepId) return selectedPublishApproval.stepId;
    if (selectedNormalizationApproval?.stepId) return selectedNormalizationApproval.stepId;
    if (selectedMappingApprovalForDisplay?.stepId) return selectedMappingApprovalForDisplay.stepId;
    return readActiveWorkflowStepId(selectedWorkflowRunSnapshot.data);
  }, [
    selectedMappingApprovalForDisplay,
    selectedNormalizationApproval,
    selectedPublishApproval,
    selectedReportApproval,
    selectedWorkflowRunSnapshot.data,
  ]);

  const hasRuntimeCurrentStepMatch = useMemo(() => {
    if (!runtimeActiveStepId) return false;
    return executionCards.some((step) =>
      executionStepMatchesRuntimeStep(step, runtimeActiveStepId),
    );
  }, [executionCards, runtimeActiveStepId]);

  const currentActionId = useMemo(() => {
    if (!selectedSession) return null;
    const activeStep =
      executionCards.find((step) =>
        runtimeActiveStepId ? executionStepMatchesRuntimeStep(step, runtimeActiveStepId) : false,
      ) ??
      executionCards.find((step) => step.step_no === options.executionCurrentStepNo) ??
      null;
    return (activeStep?.action_id as PmoPlanActionId | undefined) ?? null;
  }, [executionCards, options.executionCurrentStepNo, runtimeActiveStepId, selectedSession]);

  const selectedMappingApprovalForAction =
    currentActionId === 'column_mapping'
      ? (approvalByActionId.column_mapping ?? selectedMappingApprovalForDisplay)
      : selectedMappingApprovalForDisplay;
  const selectedNormalizationApprovalForAction =
    currentActionId === 'normalize_to_staging'
      ? (approvalByActionId.normalize_to_staging ?? effectiveNormalizationApproval)
      : effectiveNormalizationApproval;
  const selectedPublishApprovalForAction =
    currentActionId === 'database_change_summary' || currentActionId === 'publish_after_approval'
      ? (approvalByActionId[currentActionId] ?? effectivePublishApproval)
      : effectivePublishApproval;
  const selectedReportApprovalForAction =
    currentActionId === 'generate_report'
      ? (approvalByActionId.generate_report ?? effectiveReportApproval)
      : effectiveReportApproval;

  const selectedMappingView = useMemo(
    () => parseMappingView(selectedMappingApprovalForAction),
    [selectedMappingApprovalForAction],
  );

  const selectedPublishView = useMemo(
    () => parsePublishReviewView(selectedPublishApprovalForAction),
    [selectedPublishApprovalForAction],
  );

  const selectedNormalizationView = useMemo(
    () => parseNormalizationReviewView(selectedNormalizationApprovalForAction),
    [selectedNormalizationApprovalForAction],
  );

  const groupedMappingItems = useMemo(() => {
    if (!selectedMappingView?.items.length) {
      return [] as GroupedMappingItemsBySheet[];
    }

    const sorted = [...selectedMappingView.items].sort((a, b) => {
      const sheetCompare = (a.sourceSheet ?? '').localeCompare(b.sourceSheet ?? '');
      if (sheetCompare !== 0) return sheetCompare;
      const tableCompare = a.table.localeCompare(b.table);
      if (tableCompare !== 0) return tableCompare;
      return a.field.localeCompare(b.field);
    });

    const groups: GroupedMappingItemsBySheet[] = [];
    for (const item of sorted) {
      const sheetName = item.sourceSheet ?? 'Unknown sheet';
      const last = groups[groups.length - 1];
      if (!last || last.sheetName !== sheetName) {
        groups.push({ sheetName, items: [item] });
        continue;
      }
      last.items.push(item);
    }

    return groups;
  }, [selectedMappingView]);

  return {
    pendingApprovals,
    workflowRuns,
    runtimeRunBySessionId,
    profilingApprovals,
    selectedProfilingApproval: effectiveProfilingApproval,
    mappingApprovals,
    selectedMappingApproval: selectedMappingApprovalForAction,
    selectedMappingView,
    groupedMappingItems,
    normalizationApprovals,
    selectedNormalizationApproval: selectedNormalizationApprovalForAction,
    selectedNormalizationView,
    publishApprovals,
    selectedPublishApproval: selectedPublishApprovalForAction,
    selectedPublishView,
    reportApprovals,
    selectedReportApproval: selectedReportApprovalForAction,
    approvalByActionId,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  };
}
