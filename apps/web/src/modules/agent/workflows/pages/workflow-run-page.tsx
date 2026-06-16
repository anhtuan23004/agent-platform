import { Button, PageChrome } from '@seta/shared-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { WorkflowApprovalRow } from '../api/schemas.ts';
import { workflowsApi } from '../api/workflows.ts';
import { cardToolId } from '../components/decided-approval.ts';
import { HitlApprovalCard } from '../components/hitl-approval-card.tsx';
import { HitlCardHost } from '../components/hitl-card-host.tsx';
import { RunRightPanel } from '../components/run-right-panel.tsx';
import { RunStatusPill } from '../components/run-status-pill.tsx';
import { WorkflowGraph } from '../components/workflow-graph.tsx';
import { useDecideApproval } from '../hooks/use-decide-approval.ts';
import { usePendingApprovals } from '../hooks/use-pending-approvals.ts';
import { useWorkflowRun } from '../hooks/use-workflow-run.ts';
import { useWorkflowRunSnapshot } from '../hooks/use-workflow-run-snapshot.ts';
import { workflowsQueryKeys } from '../state/query-keys.ts';

const TERMINAL = new Set(['success', 'failed', 'tripwire', 'canceled']);

interface PlannerStepRow {
  step_no: number;
  step_name: string;
  description?: string;
}

interface PlanningSessionLite {
  ingestion_session_id: string;
  plan?: {
    proposed_workflow?: PlannerStepRow[];
  } | null;
}

interface ListPlanningSessionsLiteResponse {
  items: PlanningSessionLite[];
}

function workflowLabel(workflowId: string): string {
  return workflowId.replace(/^.*\./, '');
}

function readIngestionSessionId(inputSummary: unknown): string | null {
  if (!inputSummary || typeof inputSummary !== 'object') return null;
  const summary = inputSummary as {
    ingestionSessionId?: unknown;
    ingestion_session_id?: unknown;
  };

  if (typeof summary.ingestionSessionId === 'string' && summary.ingestionSessionId.trim()) {
    return summary.ingestionSessionId.trim();
  }

  if (typeof summary.ingestion_session_id === 'string' && summary.ingestion_session_id.trim()) {
    return summary.ingestion_session_id.trim();
  }

  return null;
}

async function listPlannerStepsForSession(ingestionSessionId: string): Promise<PlannerStepRow[]> {
  const res = await fetch('/api/pmo/v1/planning/sessions', {
    credentials: 'include',
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? res.statusText);
  }

  const sessions = (await res.json()) as ListPlanningSessionsLiteResponse;
  const matched = sessions.items.find((item) => item.ingestion_session_id === ingestionSessionId);
  return matched?.plan?.proposed_workflow ?? [];
}

/**
 * Best-effort recovery of the ApprovalCard from the workflow snapshot when the
 * projection's workflow_approvals.proposed_payload is empty (legacy rows from
 * before the adapter was fixed). Mastra stores the suspend payload at
 * `snapshot.result.suspendPayload` (top-level for the most recently suspended
 * step) and under `snapshot.context[stepId].suspendPayload`. Either contains
 * the full card; primary first, then any suspended step.
 */
function cardFromSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const snap = snapshot as {
    result?: { suspendPayload?: unknown };
    context?: Record<string, { suspendPayload?: unknown }>;
    suspendedPaths?: Record<string, unknown>;
  };
  if (snap.result?.suspendPayload && typeof snap.result.suspendPayload === 'object') {
    return snap.result.suspendPayload;
  }
  const suspendedStepId = snap.suspendedPaths ? Object.keys(snap.suspendedPaths)[0] : undefined;
  if (suspendedStepId && snap.context?.[suspendedStepId]?.suspendPayload) {
    return snap.context[suspendedStepId].suspendPayload;
  }
  // Fallback: scan context for any entry with a suspendPayload.
  if (snap.context) {
    for (const entry of Object.values(snap.context)) {
      if (entry?.suspendPayload && typeof entry.suspendPayload === 'object') {
        return entry.suspendPayload;
      }
    }
  }
  return undefined;
}

export interface WorkflowRunPageProps {
  runId: string;
}

export function WorkflowRunPage({ runId }: WorkflowRunPageProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const runQuery = useWorkflowRun(runId);
  const workflowsBreadcrumb = [
    <Link
      key="agent"
      to="/agent/workflows"
      className="rounded px-1 py-0.5 hover:bg-surface-1 hover:text-ink"
    >
      Agent
    </Link>,
    <Link
      key="workflows"
      to="/agent/workflows"
      className="rounded px-1 py-0.5 hover:bg-surface-1 hover:text-ink"
    >
      Workflows
    </Link>,
  ] as const;
  const snapshotQuery = useWorkflowRunSnapshot(runId);
  const approvalsQuery = usePendingApprovals();
  const decide = useDecideApproval(runId, { workflowHint: runQuery.data?.workflowId });
  const runData = runQuery.data;
  const ingestionSessionId =
    runData?.workflowId === 'pmo.ingestData' ? readIngestionSessionId(runData.inputSummary) : null;

  const plannerStepsQuery = useQuery({
    queryKey: ['pmo', 'planner-steps', ingestionSessionId],
    enabled: Boolean(ingestionSessionId),
    queryFn: () => {
      if (!ingestionSessionId) return [];
      return listPlannerStepsForSession(ingestionSessionId);
    },
    staleTime: 15_000,
  });

  const plannerSteps = useMemo(
    () => [...(plannerStepsQuery.data ?? [])].sort((a, b) => a.step_no - b.step_no),
    [plannerStepsQuery.data],
  );

  const onReplay = useCallback(
    async (args: { stepId: string; originalPayload: unknown }) => {
      const out = await workflowsApi.replayFromStep(
        runId,
        args.stepId,
        (args.originalPayload ?? {}) as Record<string, unknown>,
      );
      if (out.newRunId === runId) {
        // timeTravel replays in-place — invalidate so the graph, status, and
        // pending approvals all refresh from the freshly-committed DB state.
        await Promise.all([
          qc.invalidateQueries({ queryKey: workflowsQueryKeys.run(runId) }),
          qc.invalidateQueries({ queryKey: workflowsQueryKeys.runSnapshot(runId) }),
          qc.invalidateQueries({ queryKey: workflowsQueryKeys.pendingApprovals() }),
        ]);
      } else {
        void navigate({
          to: '/agent/workflows/runs/$runId',
          params: { runId: out.newRunId },
          search: {},
        });
      }
    },
    [runId, navigate, qc],
  );

  const rerunMutation = useMutation({
    mutationFn: () => workflowsApi.rerunRun(runId),
    onSuccess: (out) => {
      void navigate({
        to: '/agent/workflows/runs/$runId',
        params: { runId: out.newRunId },
        search: {},
      });
    },
  });

  if (runQuery.isLoading) {
    return (
      <PageChrome breadcrumb={workflowsBreadcrumb} title="Loading run…">
        <div className="p-8 text-sm text-ink-subtle">Loading run…</div>
      </PageChrome>
    );
  }
  if (!runData) {
    return (
      <PageChrome breadcrumb={workflowsBreadcrumb} title="Run not found">
        <div className="grid h-full place-items-center p-8 text-sm">
          <div className="space-y-2 text-center">
            <p className="text-ink">We couldn&apos;t find that run.</p>
            <p className="text-xs text-ink-subtle">
              It may have been deleted, or you might not have access.
            </p>
          </div>
        </div>
      </PageChrome>
    );
  }

  const run = runData;

  const myApproval = approvalsQuery.data?.find((a) => a.runId === runId) ?? null;
  const fallbackPayload = cardFromSnapshot(snapshotQuery.data);
  const resolvedPayload = myApproval?.proposedPayload ?? fallbackPayload;
  const toolId = cardToolId(resolvedPayload);
  const isPmoApprovalCard = typeof toolId === 'string' && toolId.startsWith('pmo_');
  const hostApproval: WorkflowApprovalRow | null =
    myApproval && resolvedPayload !== myApproval.proposedPayload
      ? ({ ...myApproval, proposedPayload: resolvedPayload } as WorkflowApprovalRow)
      : myApproval;
  const terminal = TERMINAL.has(run.status);

  return (
    <PageChrome
      breadcrumb={workflowsBreadcrumb}
      title={<span className="font-mono">{workflowLabel(run.workflowId)}</span>}
      subtitle={
        <>
          <span className="font-mono text-xs">Run {run.runId.slice(0, 7)}</span>
          <RunStatusPill status={run.status} />
        </>
      }
      actions={
        terminal ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={rerunMutation.isPending}
            onClick={() => rerunMutation.mutate()}
          >
            {rerunMutation.isPending ? 'Replaying…' : 'Replay from start'}
          </Button>
        ) : undefined
      }
    >
      <div className="flex h-full flex-1 overflow-hidden">
        <main className="relative flex-1 overflow-hidden bg-surface-2">
          <WorkflowGraph
            snapshot={snapshotQuery.data}
            run={{
              runId: run.runId,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              status: run.status,
            }}
            onReplay={onReplay}
          />
          {run.status === 'paused' && myApproval ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
              <div className="pointer-events-auto w-full max-w-xl">
                {isPmoApprovalCard && hostApproval ? (
                  <HitlCardHost
                    approval={hostApproval}
                    canAct
                    threadId={hostApproval.surfaceChatThreadId ?? undefined}
                  />
                ) : (
                  <HitlApprovalCard
                    approval={myApproval}
                    // Snapshot fallback: legacy approval rows have empty
                    // proposed_payload because the adapter wasn't extracting the
                    // suspend payload. The Mastra snapshot still has the full card
                    // under .result.suspendPayload (and .context[step].suspendPayload),
                    // so the UI can recover the candidate list from there.
                    proposedPayloadFallback={fallbackPayload}
                    canAct
                    pending={decide.isPending}
                    onDecide={(args) =>
                      decide.mutate({ approvalId: myApproval.approvalId, ...args })
                    }
                  />
                )}
              </div>
            </div>
          ) : null}
        </main>
        <RunRightPanel
          run={run}
          streamEvents={runQuery.streamEvents}
          snapshot={snapshotQuery.data}
          plannerSteps={plannerSteps}
          plannerStepsLoading={plannerStepsQuery.isLoading}
        />
      </div>
    </PageChrome>
  );
}
