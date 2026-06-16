import { useMemo } from 'react';
import type { PmoPlanningSession } from '../api/client';
import type { WorkflowApprovalRow, WorkflowRunRow } from '../api/workflow-runtime';
import {
  buildExecutionRuntimeTimeline,
  buildPlanningTimeline,
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  isMappingApprovalRow,
  isNormalizationApprovalRow,
  isPublishApprovalRow,
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
  resolveExecutionCurrentStepIndex,
  sessionIdsMatch,
  type TimelineState,
} from '../pages/pmo-page.logic';
import {
  useWorkflowRuntimePendingApprovals,
  useWorkflowRuntimeRunSnapshot,
  useWorkflowRuntimeRuns,
} from './use-workflow-runtime';

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
  runtimeActiveStepId: string | null;
  hasRuntimeCurrentStepMatch: boolean;
  timeline: Array<{ id: number; label: string; state: TimelineState }>;
}

export function usePmoWorkflowRuntime(
  options: UsePmoWorkflowRuntimeOptions,
): UsePmoWorkflowRuntimeResult {
  const { selectedSession, executionCards, executionCurrentStepNo } = options;

  const pendingApprovals = useWorkflowRuntimePendingApprovals();

  const workflowRuns = useWorkflowRuntimeRuns({
    scope: 'self',
    workflowId: 'pmo.ingestData',
  });

  const pmoIngestRuns = useMemo(
    () => workflowRuns.data?.pages.flatMap((page) => page.rows) ?? ([] as WorkflowRunRow[]),
    [workflowRuns.data],
  );

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

  const selectedWorkflowRunId =
    selectedWorkflowRun?.runId ??
    selectedMappingApproval?.runId ??
    selectedNormalizationApproval?.runId ??
    selectedPublishApproval?.runId ??
    '';
  const selectedWorkflowRunSnapshot = useWorkflowRuntimeRunSnapshot(selectedWorkflowRunId);

  const selectedMappingView = useMemo(
    () => parseMappingView(selectedMappingApproval),
    [selectedMappingApproval],
  );

  const selectedPublishView = useMemo(
    () => parsePublishReviewView(selectedPublishApproval),
    [selectedPublishApproval],
  );

  const selectedNormalizationView = useMemo(
    () => parseNormalizationReviewView(selectedNormalizationApproval),
    [selectedNormalizationApproval],
  );

  const selectedMappingApprovalForDisplay = useMemo(() => {
    if (!selectedMappingApproval) return null;
    const mappingRunId = selectedMappingApproval.runId;
    const hasLaterApprovalForRun =
      normalizationApprovals.some((approval) => approval.runId === mappingRunId) ||
      publishApprovals.some((approval) => approval.runId === mappingRunId);
    return hasLaterApprovalForRun ? null : selectedMappingApproval;
  }, [normalizationApprovals, publishApprovals, selectedMappingApproval]);

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
    if (selectedPublishApproval?.stepId) return selectedPublishApproval.stepId;
    if (selectedNormalizationApproval?.stepId) return selectedNormalizationApproval.stepId;
    if (selectedMappingApprovalForDisplay?.stepId) return selectedMappingApprovalForDisplay.stepId;
    return readActiveWorkflowStepId(selectedWorkflowRunSnapshot.data);
  }, [
    selectedMappingApprovalForDisplay,
    selectedNormalizationApproval,
    selectedPublishApproval,
    selectedWorkflowRunSnapshot.data,
  ]);

  const hasRuntimeCurrentStepMatch = useMemo(() => {
    if (!runtimeActiveStepId) return false;
    return executionCards.some((step) =>
      executionStepMatchesRuntimeStep(step, runtimeActiveStepId),
    );
  }, [executionCards, runtimeActiveStepId]);

  const timeline = useMemo(() => {
    const planningState = selectedSession?.planning_state ?? null;
    if (!selectedSession) {
      return buildPlanningTimeline(planningState);
    }

    if (planningState !== 'approved_plan' && !selectedWorkflowRun) {
      return buildPlanningTimeline(planningState);
    }

    if (executionCards.length === 0) {
      return buildPlanningTimeline(planningState);
    }

    const currentStepIndex = resolveExecutionCurrentStepIndex({
      cards: executionCards,
      runtimeActiveStepId,
      executionCurrentStepNo,
    });

    return buildExecutionRuntimeTimeline({
      cards: executionCards,
      currentStepIndex,
      runStatus: selectedWorkflowRun?.status ?? null,
    });
  }, [
    executionCards,
    executionCurrentStepNo,
    runtimeActiveStepId,
    selectedSession,
    selectedWorkflowRun,
  ]);

  return {
    pendingApprovals,
    workflowRuns,
    runtimeRunBySessionId,
    mappingApprovals,
    selectedMappingApproval: selectedMappingApprovalForDisplay,
    selectedMappingView,
    groupedMappingItems,
    normalizationApprovals,
    selectedNormalizationApproval,
    selectedNormalizationView,
    publishApprovals,
    selectedPublishApproval,
    selectedPublishView,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
    timeline,
  };
}
