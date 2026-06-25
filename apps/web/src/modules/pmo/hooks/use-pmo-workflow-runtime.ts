import { useMemo } from 'react';
import type { PmoPlanningSession } from '../api/client';
import type { WorkflowApprovalRow, WorkflowRunRow } from '../api/workflow-runtime';
import {
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  isMappingApprovalRow,
  isNormalizationApprovalRow,
  isPublishApprovalRow,
  isReportApprovalRow,
  type MappingProgressItem,
  type MappingViewModel,
  type NormalizationReviewViewModel,
  type PublishReviewViewModel,
  parseMappingView,
  parseNormalizationReviewView,
  parsePublishReviewView,
  readActiveWorkflowStepId,
  readIngestionSessionIdFromApproval,
  readIngestionSessionIdFromRunInput,
  sessionIdsMatch,
} from '../pages/pmo-page.logic';
import {
  useWorkflowRuntimePendingApprovals,
  useWorkflowRuntimeRunApprovals,
  useWorkflowRuntimeRunSnapshot,
  useWorkflowRuntimeRuns,
} from './use-workflow-runtime';

function syntheticApprovalFromViewState(
  step: ExecutionCard | undefined,
  selectedSession: PmoPlanningSession | null,
): WorkflowApprovalRow | null {
  const payload = step?.view_state?.approval_payload;
  if (!step?.view_state || !payload) return null;

  return {
    approvalId: `step-view:${selectedSession?.ingestion_session_id ?? 'unknown'}:${step.view_state.action_id}`,
    runId: '',
    stepId: step.view_state.planner_step_id,
    proposedPayload: payload,
    approverUserId: '',
    surfaceCanvas: true,
    surfaceChatThreadId: selectedSession?.chat_thread_id ?? null,
    agentic: true,
    status: 'decided',
    decisionPayload: null,
    decidedAt: step.view_state.updated_at,
    expiresAt: step.view_state.updated_at,
    createdAt: step.view_state.updated_at,
  };
}

function findExecutionCardByAction(
  cards: ExecutionCard[],
  actionIds: string[],
): ExecutionCard | undefined {
  return cards.find((card) => card.action_id && actionIds.includes(card.action_id));
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
    workflowId: 'pmo.ingestData.v2',
  });

  const agenticRuns = useWorkflowRuntimeRuns({
    scope: 'self',
    workflowId: 'pmo.orchestrator',
  });

  const pmoIngestRuns = useMemo(() => {
    const workflow = workflowRuns.data?.pages.flatMap((page) => page.rows) ?? [];
    const agentic = agenticRuns.data?.pages.flatMap((page) => page.rows) ?? [];
    return [...workflow, ...agentic] as WorkflowRunRow[];
  }, [workflowRuns.data, agenticRuns.data]);

  const runtimeRunBySessionId = useMemo(() => {
    const map = new Map<string, { runId: string; status: WorkflowRunRow['status'] }>();
    for (const run of pmoIngestRuns) {
      const ingestionSessionId = readIngestionSessionIdFromRunInput(run.inputSummary);
      if (!ingestionSessionId || map.has(ingestionSessionId)) continue;
      map.set(ingestionSessionId, {
        runId: run.runId,
        status: run.status,
      });
    }
    return map;
  }, [pmoIngestRuns]);

  const selectedWorkflowRun = useMemo(() => {
    if (!selectedSession) return null;

    const directMatch = runtimeRunBySessionId.get(selectedSession.ingestion_session_id);
    if (directMatch) {
      return pmoIngestRuns.find((run) => run.runId === directMatch.runId) ?? null;
    }

    const matchedBySession = pmoIngestRuns.find((run) => {
      const ingestionSessionId = readIngestionSessionIdFromRunInput(run.inputSummary);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (matchedBySession) return matchedBySession;

    return null;
  }, [pmoIngestRuns, runtimeRunBySessionId, selectedSession]);

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

  const selectedMappingApproval = useMemo(() => {
    if (!selectedSession) return null;

    if (selectedWorkflowRun?.runId) {
      const matchedByRun = mappingApprovals.find(
        (approval) => approval.runId === selectedWorkflowRun.runId,
      );
      if (matchedByRun) return matchedByRun;
    }

    const exactMatch = mappingApprovals.find((approval) => {
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (exactMatch) return exactMatch;

    // Fallback for cards that do not carry a parseable session id.
    if (!selectedWorkflowRun?.runId && mappingApprovals.length === 1) {
      return mappingApprovals[0] ?? null;
    }

    return null;
  }, [mappingApprovals, selectedSession, selectedWorkflowRun]);

  const selectedNormalizationApproval = useMemo(() => {
    if (!selectedSession) return null;

    if (selectedWorkflowRun?.runId) {
      const matchedByRun = normalizationApprovals.find(
        (approval) => approval.runId === selectedWorkflowRun.runId,
      );
      if (matchedByRun) return matchedByRun;
    }

    const exactMatch = normalizationApprovals.find((approval) => {
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (exactMatch) return exactMatch;

    if (!selectedWorkflowRun?.runId && normalizationApprovals.length === 1) {
      return normalizationApprovals[0] ?? null;
    }

    return null;
  }, [normalizationApprovals, selectedSession, selectedWorkflowRun]);

  const selectedPublishApproval = useMemo(() => {
    if (!selectedSession) return null;

    if (selectedWorkflowRun?.runId) {
      const matchedByRun = publishApprovals.find(
        (approval) => approval.runId === selectedWorkflowRun.runId,
      );
      if (matchedByRun) return matchedByRun;
    }

    const exactMatch = publishApprovals.find((approval) => {
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (exactMatch) return exactMatch;

    // Fallback for cards that do not carry a parseable session id.
    if (!selectedWorkflowRun?.runId && publishApprovals.length === 1) {
      return publishApprovals[0] ?? null;
    }

    return null;
  }, [publishApprovals, selectedSession, selectedWorkflowRun]);

  const selectedReportApproval = useMemo(() => {
    if (!selectedSession) return null;

    if (selectedWorkflowRun?.runId) {
      const matchedByRun = reportApprovals.find(
        (approval) => approval.runId === selectedWorkflowRun.runId,
      );
      if (matchedByRun) return matchedByRun;
    }

    const exactMatch = reportApprovals.find((approval) => {
      const ingestionSessionId = readIngestionSessionIdFromApproval(approval);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (exactMatch) return exactMatch;

    if (!selectedWorkflowRun?.runId && reportApprovals.length === 1) {
      return reportApprovals[0] ?? null;
    }

    return null;
  }, [reportApprovals, selectedSession, selectedWorkflowRun]);

  const selectedWorkflowRunId =
    selectedWorkflowRun?.runId ??
    selectedMappingApproval?.runId ??
    selectedNormalizationApproval?.runId ??
    selectedPublishApproval?.runId ??
    selectedReportApproval?.runId ??
    '';
  const selectedWorkflowRunSnapshot = useWorkflowRuntimeRunSnapshot(selectedWorkflowRunId);

  // Fetch ALL approvals (pending + decided) for the selected run so completed
  // steps can render their historical approval data in read-only mode.
  const runApprovals = useWorkflowRuntimeRunApprovals(selectedWorkflowRunId);

  const historicalMappingApproval = useMemo(() => {
    if (!selectedWorkflowRunId) return null;
    return (
      (runApprovals.data ?? []).find(
        (a) => a.runId === selectedWorkflowRunId && isMappingApprovalRow(a),
      ) ?? null
    );
  }, [runApprovals.data, selectedWorkflowRunId]);

  const historicalNormalizationApproval = useMemo(() => {
    if (!selectedWorkflowRunId) return null;
    return (
      (runApprovals.data ?? []).find(
        (a) => a.runId === selectedWorkflowRunId && isNormalizationApprovalRow(a),
      ) ?? null
    );
  }, [runApprovals.data, selectedWorkflowRunId]);

  const historicalPublishApproval = useMemo(() => {
    if (!selectedWorkflowRunId) return null;
    return (
      (runApprovals.data ?? []).find(
        (a) => a.runId === selectedWorkflowRunId && isPublishApprovalRow(a),
      ) ?? null
    );
  }, [runApprovals.data, selectedWorkflowRunId]);

  const historicalReportApproval = useMemo(() => {
    if (!selectedWorkflowRunId) return null;
    return (
      (runApprovals.data ?? []).find(
        (a) => a.runId === selectedWorkflowRunId && isReportApprovalRow(a),
      ) ?? null
    );
  }, [runApprovals.data, selectedWorkflowRunId]);

  // Use pending approval when available (actionable), fall back to decided
  // approval from the run history (read-only).
  const effectiveMappingApproval = selectedMappingApproval ?? historicalMappingApproval;
  const effectiveNormalizationApproval =
    selectedNormalizationApproval ?? historicalNormalizationApproval;
  const effectivePublishApproval = selectedPublishApproval ?? historicalPublishApproval;
  const effectiveReportApproval = selectedReportApproval ?? historicalReportApproval;

  const mappingStepViewApproval = useMemo(
    () =>
      syntheticApprovalFromViewState(
        findExecutionCardByAction(executionCards, ['column_mapping']),
        selectedSession,
      ),
    [executionCards, selectedSession],
  );
  const normalizationStepViewApproval = useMemo(
    () =>
      syntheticApprovalFromViewState(
        findExecutionCardByAction(executionCards, ['normalize_to_staging']),
        selectedSession,
      ),
    [executionCards, selectedSession],
  );
  const publishStepViewApproval = useMemo(
    () =>
      syntheticApprovalFromViewState(
        findExecutionCardByAction(executionCards, [
          'database_change_summary',
          'publish_after_approval',
        ]),
        selectedSession,
      ),
    [executionCards, selectedSession],
  );
  const reportStepViewApproval = useMemo(
    () =>
      syntheticApprovalFromViewState(
        findExecutionCardByAction(executionCards, ['generate_report']),
        selectedSession,
      ),
    [executionCards, selectedSession],
  );

  const effectiveMappingApprovalWithView = effectiveMappingApproval ?? mappingStepViewApproval;
  const effectiveNormalizationApprovalWithView =
    effectiveNormalizationApproval ?? normalizationStepViewApproval;
  const effectivePublishApprovalWithView = effectivePublishApproval ?? publishStepViewApproval;
  const effectiveReportApprovalWithView = effectiveReportApproval ?? reportStepViewApproval;

  const selectedMappingView = useMemo(
    () => parseMappingView(effectiveMappingApprovalWithView),
    [effectiveMappingApprovalWithView],
  );

  const selectedPublishView = useMemo(
    () => parsePublishReviewView(effectivePublishApprovalWithView),
    [effectivePublishApprovalWithView],
  );

  const selectedNormalizationView = useMemo(
    () => parseNormalizationReviewView(effectiveNormalizationApprovalWithView),
    [effectiveNormalizationApprovalWithView],
  );

  const selectedMappingApprovalForDisplay = useMemo(() => {
    const approval = effectiveMappingApprovalWithView;
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
  }, [normalizationApprovals, publishApprovals, reportApprovals, effectiveMappingApprovalWithView]);

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

  return {
    pendingApprovals,
    workflowRuns,
    runtimeRunBySessionId,
    mappingApprovals,
    selectedMappingApproval: selectedMappingApprovalForDisplay,
    selectedMappingView,
    groupedMappingItems,
    normalizationApprovals,
    selectedNormalizationApproval: effectiveNormalizationApprovalWithView,
    selectedNormalizationView,
    publishApprovals,
    selectedPublishApproval: effectivePublishApprovalWithView,
    selectedPublishView,
    reportApprovals,
    selectedReportApproval: effectiveReportApprovalWithView,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  };
}
