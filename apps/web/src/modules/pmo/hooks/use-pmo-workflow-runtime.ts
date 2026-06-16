import { useMemo } from 'react';
import type { WorkflowApprovalRow, WorkflowRunRow } from '../../agent/workflows/api/schemas.ts';
import { usePendingApprovals } from '../../agent/workflows/hooks/use-pending-approvals.ts';
import { useWorkflowRunSnapshot } from '../../agent/workflows/hooks/use-workflow-run-snapshot.ts';
import { useWorkflowRuns } from '../../agent/workflows/hooks/use-workflow-runs.ts';
import type { PmoPlanningSession } from '../api/client';
import {
  buildExecutionRuntimeTimeline,
  buildPlanningTimeline,
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  isMappingApprovalRow,
  type MappingProgressItem,
  type MappingViewModel,
  parseMappingView,
  readActiveWorkflowStepId,
  readIngestionSessionIdFromApproval,
  readIngestionSessionIdFromRunInput,
  resolveExecutionCurrentStepIndex,
  sessionIdsMatch,
  type TimelineState,
} from '../pages/pmo-page.logic';

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
  pendingApprovals: ReturnType<typeof usePendingApprovals>;
  workflowRuns: ReturnType<typeof useWorkflowRuns>;
  mappingApprovals: WorkflowApprovalRow[];
  selectedMappingApproval: WorkflowApprovalRow | null;
  selectedMappingView: MappingViewModel | null;
  groupedMappingItems: GroupedMappingItemsBySheet[];
  runtimeActiveStepId: string | null;
  hasRuntimeCurrentStepMatch: boolean;
  timeline: Array<{ id: number; label: string; state: TimelineState }>;
}

export function usePmoWorkflowRuntime(
  options: UsePmoWorkflowRuntimeOptions,
): UsePmoWorkflowRuntimeResult {
  const { selectedSession, executionCards, executionCurrentStepNo } = options;

  const pendingApprovals = usePendingApprovals();

  const workflowRuns = useWorkflowRuns({
    scope: 'self',
    workflowId: 'pmo.ingestData',
  });

  const pmoIngestRuns = useMemo(
    () => workflowRuns.data?.pages.flatMap((page) => page.rows) ?? ([] as WorkflowRunRow[]),
    [workflowRuns.data],
  );

  const selectedWorkflowRun = useMemo(() => {
    if (!selectedSession) return null;

    const matchedBySession = pmoIngestRuns.find((run) => {
      const ingestionSessionId = readIngestionSessionIdFromRunInput(run.inputSummary);
      return sessionIdsMatch(ingestionSessionId, selectedSession.ingestion_session_id);
    });
    if (matchedBySession) return matchedBySession;

    return null;
  }, [pmoIngestRuns, selectedSession]);

  const mappingApprovals = useMemo(
    () => (pendingApprovals.data ?? []).filter((approval) => isMappingApprovalRow(approval)),
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
    if (mappingApprovals.length === 1) {
      return mappingApprovals[0] ?? null;
    }

    return null;
  }, [mappingApprovals, selectedSession, selectedWorkflowRun?.runId]);

  const selectedWorkflowRunId = selectedWorkflowRun?.runId ?? selectedMappingApproval?.runId ?? '';
  const selectedWorkflowRunSnapshot = useWorkflowRunSnapshot(selectedWorkflowRunId);

  const selectedMappingView = useMemo(
    () => parseMappingView(selectedMappingApproval),
    [selectedMappingApproval],
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
  }, [selectedMappingView?.items]);

  const runtimeActiveStepId = useMemo(() => {
    if (selectedMappingApproval?.stepId) return selectedMappingApproval.stepId;
    return readActiveWorkflowStepId(selectedWorkflowRunSnapshot.data);
  }, [selectedMappingApproval?.stepId, selectedWorkflowRunSnapshot.data]);

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
    mappingApprovals,
    selectedMappingApproval,
    selectedMappingView,
    groupedMappingItems,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
    timeline,
  };
}
