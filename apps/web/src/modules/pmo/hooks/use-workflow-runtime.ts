import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { notifyApprovalResolved } from '../../agent/hooks/use-approval-events';
import { type WorkflowRunScope, workflowRuntimeApi } from '../api/workflow-runtime';

const PAGE_SIZE = 25;

export const workflowRuntimeQueryKeys = {
  all: ['pmo', 'workflow-runtime'] as const,
  runs: (scope: WorkflowRunScope, workflowId?: string | null) =>
    [...workflowRuntimeQueryKeys.all, 'runs', scope, workflowId ?? null] as const,
  runSnapshot: (runId: string) =>
    [...workflowRuntimeQueryKeys.all, 'run', runId, 'snapshot'] as const,
  pendingApprovals: () => [...workflowRuntimeQueryKeys.all, 'pending-approvals'] as const,
  runApprovals: (runId: string) =>
    [...workflowRuntimeQueryKeys.all, 'run', runId, 'approvals'] as const,
};

export interface UseWorkflowRuntimeRunsOptions {
  scope: WorkflowRunScope;
  workflowId?: string | null;
}

export function useWorkflowRuntimeRuns(opts: UseWorkflowRuntimeRunsOptions) {
  const qc = useQueryClient();
  const workflowId = opts.workflowId ?? null;
  const queryKey = useMemo(
    () => workflowRuntimeQueryKeys.runs(opts.scope, workflowId),
    [opts.scope, workflowId],
  );

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      workflowRuntimeApi.listRuns({
        scope: opts.scope,
        cursor: pageParam ?? undefined,
        limit: PAGE_SIZE,
        workflowId: workflowId ?? undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;

    void (async () => {
      let token: string;
      try {
        token = await workflowRuntimeApi.issueSseToken();
      } catch {
        return;
      }

      if (cancelled) return;

      const url = `/api/agent/workflows/runs/stream?scope=${encodeURIComponent(
        opts.scope,
      )}&token=${encodeURIComponent(token)}`;
      es = new EventSource(url);

      const invalidate = () => {
        qc.invalidateQueries({ queryKey });
      };

      es.addEventListener('run.created', invalidate);
      es.addEventListener('run.status_changed', invalidate);
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [opts.scope, qc, queryKey]);

  return query;
}

export function useWorkflowRuntimePendingApprovals() {
  return useQuery({
    queryKey: workflowRuntimeQueryKeys.pendingApprovals(),
    queryFn: () => workflowRuntimeApi.listMyPendingApprovals(),
    refetchInterval: 5000,
  });
}

export function useWorkflowRuntimeRunSnapshot(runId: string) {
  return useQuery({
    queryKey: workflowRuntimeQueryKeys.runSnapshot(runId),
    queryFn: () => workflowRuntimeApi.getRunSnapshot(runId),
    enabled: Boolean(runId),
  });
}

export function useWorkflowRuntimeRunApprovals(runId: string) {
  return useQuery({
    queryKey: workflowRuntimeQueryKeys.runApprovals(runId),
    queryFn: () => workflowRuntimeApi.listRunApprovals(runId),
    enabled: Boolean(runId),
  });
}

export interface SubmitRuntimeDecisionArgs {
  approvalId: string;
  agentic: boolean;
  decision: 'approve' | 'reject' | 'modify' | 'clarify';
  overrideUserIds?: string[];
  alternateIndices?: number[];
  payloadPatch?: Record<string, unknown>;
  note?: string;
  clarificationMessage?: string;
}

export function useSubmitWorkflowRuntimeDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ approvalId, agentic, ...decision }: SubmitRuntimeDecisionArgs) =>
      agentic
        ? workflowRuntimeApi.resumeChat({ approvalId, ...decision })
        : workflowRuntimeApi.decideApproval(approvalId, decision),
    onSuccess: (_data, variables) => {
      // After a successful decision, notify the chat panel so it reloads the
      // thread messages that the agent produced during resume.
      if (variables.agentic) {
        notifyApprovalResolved();
      }
      // Invalidate approval queries so the PMO cards reflect the decision.
      void qc.invalidateQueries({ queryKey: workflowRuntimeQueryKeys.pendingApprovals() });
    },
  });
}
