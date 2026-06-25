interface ApiErrorBody {
  error?: string;
  message?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}) as ApiErrorBody)) as ApiErrorBody;
    throw Object.assign(new Error(body.message ?? res.statusText), {
      status: res.status,
      code: body.error,
    });
  }
  return (await res.json()) as T;
}

export type WorkflowRunScope = 'self' | 'group' | 'tenant' | 'instance';

export interface WorkflowRunRow {
  runId: string;
  workflowId: string;
  tenantId: string;
  startedBy: string;
  startedVia: 'event' | 'chat' | 'rerun';
  status: string;
  suspendReason: string | null;
  errorSummary: string | null;
  inputSummary: unknown;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  latestApprovalKind: string | null;
  latestApprovalReason: string | null;
}

export interface WorkflowApprovalRow {
  approvalId: string;
  runId: string;
  stepId: string;
  proposedPayload: unknown;
  approverUserId: string;
  surfaceCanvas: boolean;
  surfaceChatThreadId: string | null;
  agentic: boolean;
  status: string;
  decisionPayload: unknown | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface ListWorkflowRunsResponse {
  rows: WorkflowRunRow[];
  nextCursor: string | null;
}

export interface ListWorkflowRunsOptions {
  scope: WorkflowRunScope;
  cursor?: string;
  limit?: number;
  workflowId?: string;
}

export interface DecideApprovalBody {
  decision: 'approve' | 'reject' | 'modify' | 'clarify';
  overrideUserIds?: string[];
  alternateIndex?: number;
  alternateIndices?: number[];
  payloadPatch?: Record<string, unknown>;
  note?: string;
  clarificationMessage?: string;
}

export interface ResumeChatBody {
  approvalId: string;
  decision: 'approve' | 'reject' | 'modify' | 'clarify';
  overrideUserIds?: string[];
  alternateIndices?: number[];
  payloadPatch?: Record<string, unknown>;
  note?: string;
  clarificationMessage?: string;
}

interface SseTokenResponse {
  token: string;
}

export const workflowRuntimeApi = {
  async listRuns(opts: ListWorkflowRunsOptions): Promise<ListWorkflowRunsResponse> {
    const qs = new URLSearchParams({ scope: opts.scope });
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.workflowId) qs.set('workflowId', opts.workflowId);

    const res = await fetch(`/api/agent/v1/workflows/runs?${qs}`, {
      credentials: 'include',
    });
    return jsonOrThrow<ListWorkflowRunsResponse>(res);
  },

  async getRunSnapshot(runId: string): Promise<unknown | null> {
    const res = await fetch(`/api/agent/v1/workflows/runs/${encodeURIComponent(runId)}/snapshot`, {
      credentials: 'include',
    });
    if (res.status === 404) return null;
    return jsonOrThrow<unknown>(res);
  },

  async listMyPendingApprovals(): Promise<WorkflowApprovalRow[]> {
    const res = await fetch('/api/agent/v1/workflows/my-pending-approvals', {
      credentials: 'include',
    });
    return jsonOrThrow<WorkflowApprovalRow[]>(res);
  },

  async listRunApprovals(runId: string): Promise<WorkflowApprovalRow[]> {
    const res = await fetch(`/api/agent/v1/workflows/runs/${encodeURIComponent(runId)}/approvals`, {
      credentials: 'include',
    });
    return jsonOrThrow<WorkflowApprovalRow[]>(res);
  },

  async decideApproval(approvalId: string, body: DecideApprovalBody): Promise<unknown> {
    const res = await fetch(
      `/api/agent/v1/workflows/approvals/${encodeURIComponent(approvalId)}/decide`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return jsonOrThrow<unknown>(res);
  },

  async resumeChat(body: ResumeChatBody): Promise<void> {
    const res = await fetch('/api/agent/v1/chat/resume', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await jsonOrThrow<unknown>(res);
    }
    // Native resume responds as SSE. Drain it so callers refresh only after the
    // suspended workflow has consumed the decision and persisted its next state.
    await res.text();
  },

  async cancelRun(runId: string): Promise<void> {
    const res = await fetch(`/api/agent/v1/workflows/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });
    await jsonOrThrow<{ ok: true }>(res);
  },

  async issueSseToken(): Promise<string> {
    const res = await fetch('/api/agent/v1/workflows/sse-token', {
      credentials: 'include',
    });
    const out = await jsonOrThrow<SseTokenResponse>(res);
    return out.token;
  },
};
