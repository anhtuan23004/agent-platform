import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => {
    const allowed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'params' || k === 'to' || k === 'search') continue;
      allowed[k] = v;
    }
    return <a {...allowed}>{children}</a>;
  },
}));

import { PmoPage } from '@/modules/pmo/pages/pmo-page';

function withQuery(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dropFile(file: File) {
  const dropzone = screen.getByRole('button', { name: /drop pmo workbook here/i });
  const dropEvent = new DragEvent('drop', { bubbles: true });
  Object.defineProperty(dropEvent, 'dataTransfer', {
    value: { files: [file], items: [], types: [] },
  });
  dropzone.dispatchEvent(dropEvent);
}

function makeRunRow(partial?: Partial<Record<string, unknown>>) {
  return {
    runId: 'run-123',
    workflowId: 'pmo.ingestData.v2',
    tenantId: '11111111-1111-4111-8111-111111111111',
    startedBy: '22222222-2222-4222-8222-222222222222',
    startedVia: 'event',
    status: 'paused',
    suspendReason: null,
    errorSummary: null,
    inputSummary: {
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
      fileKey: 'tenant/pmo/session/workbook.xlsx',
      reportingPeriodKey: '2026-W24',
    },
    startedAt: '2026-06-13T08:00:00.000Z',
    finishedAt: null,
    durationMs: null,
    latestApprovalKind: 'pending',
    latestApprovalReason: null,
    ...partial,
  };
}

function makePlan() {
  return {
    title: 'PMO ingestion plan',
    goal_summary: 'Ingest this workbook and prepare data for RA calculation.',
    uploaded_file_summary: {
      file_name: 'pmo_2025-w35.xlsx',
      file_size: '12 KB',
      uploaded_at: '2026-06-13T08:00:00.000Z',
      file_type: 'xlsx',
    },
    scope_assumption: {
      likely_data_areas: [],
      basis: 'test',
    },
    proposed_workflow: [
      {
        step_no: 1,
        step_name: 'Workbook profiling',
        description: 'Profile workbook sheets before mapping.',
        agent_responsibility: 'Profile workbook',
        user_responsibility: 'Confirm detected sheets',
        requires_user_review: true,
      },
      {
        step_no: 2,
        step_name: 'Column mapping proposal',
        description: 'Map workbook fields to PMO target columns.',
        agent_responsibility: 'Propose mappings',
        user_responsibility: 'Approve or modify mappings',
        requires_user_review: true,
      },
      {
        step_no: 3,
        step_name: 'Validation and normalization to staging',
        description: 'Validate normalized rows before staging.',
        agent_responsibility: 'Normalize and validate data',
        user_responsibility: 'Resolve data quality findings',
        requires_user_review: true,
      },
      {
        step_no: 4,
        step_name: 'Database comparison and change summary',
        description: 'Compare staged rows with database records.',
        agent_responsibility: 'Summarize database changes',
        user_responsibility: 'Review changes',
        requires_user_review: true,
      },
      {
        step_no: 5,
        step_name: 'Publish only after final approval',
        description: 'Publish approved changes.',
        agent_responsibility: 'Publish changes',
        user_responsibility: 'Approve final publish',
        requires_user_review: true,
      },
    ],
    review_gates: [],
    state_management_plan: {
      state_to_save: [],
      resume_behavior: 'resume from PMO-approved step',
    },
    risks_and_assumptions: [],
    not_yet_performed: [],
    approval_policy: {
      can_continue_after_plan_approval: true,
      requires_mapping_review_before_normalization: true,
      requires_db_change_review_before_publish: true,
      will_publish_without_user_approval: false,
    },
    next_action: {
      label: 'Approve plan',
      description: 'Approve the plan to start profiling.',
    },
  };
}

function workflowStepNoFromApproval(stepId: string): number {
  if (/mapping|confirmMapping/i.test(stepId)) return 2;
  if (/normaliz|validate|validation/i.test(stepId)) return 3;
  if (/reviewChanges|publish|confirmPublish/i.test(stepId)) return 4;
  return 1;
}

function makePlanningSession(partial?: Partial<Record<string, unknown>>) {
  const currentStepNo = Number(partial?.currentStepNo ?? 1);
  const currentStepStatus =
    (partial?.currentStepStatus as
      | 'in_progress'
      | 'needs_review'
      | 'completed'
      | 'cancelled'
      | undefined) ?? 'needs_review';
  const steps = makePlan().proposed_workflow.map((step) => ({
    step_no: step.step_no,
    step_name: step.step_name,
    status:
      step.step_no < currentStepNo
        ? ('completed' as const)
        : step.step_no === currentStepNo
          ? currentStepStatus
          : ('pending' as const),
  }));

  return {
    ingestion_session_id:
      (partial?.ingestion_session_id as string | undefined) ??
      '629d3033-67df-4d5b-a270-77d690c43c13',
    workbook_name: (partial?.workbook_name as string | undefined) ?? 'pmo_2025-w35.xlsx',
    workbook_size_bytes: 12_345,
    workbook_size: '12.1 KB',
    file_type: 'xlsx',
    uploaded_at: '2026-06-13T08:00:00.000Z',
    operator: 'PMO User',
    planning_state: 'approved_plan',
    status_label: currentStepStatus === 'needs_review' ? 'Needs review' : 'In progress',
    active_gate: steps.find((step) => step.step_no === currentStepNo)?.step_name ?? 'Workflow',
    progress_text: `Step ${currentStepNo}/5`,
    progress_pct: currentStepNo * 20,
    goal: 'Ingest this workbook and prepare data for RA calculation.',
    plan: makePlan(),
    plan_version: 1,
    feedback_history: [],
    execution_state: {
      state_version: 1,
      started_at: '2026-06-13T08:00:00.000Z',
      updated_at: '2026-06-13T08:00:00.000Z',
      current_step_no: currentStepNo,
      current_step_status: currentStepStatus,
      steps,
      documents: [
        {
          document_id: 'doc-1',
          source_file_key: 'tenant/pmo/session/pmo_2025-w35.xlsx',
          file_name: (partial?.workbook_name as string | undefined) ?? 'pmo_2025-w35.xlsx',
          file_size_bytes: 12_345,
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          uploaded_at: '2026-06-13T08:00:00.000Z',
          status: 'profiled',
        },
      ],
      profiling_summary: null,
      profiling_review: {
        status: 'approved',
        sheet_overrides: [],
        waived_missing_areas: [],
        last_updated_at: '2026-06-13T08:00:00.000Z',
      },
    },
    profiling_documents: [],
    profiling_summary: null,
    profiling_review: {
      status: 'approved',
      sheet_overrides: [],
      waived_missing_areas: [],
      last_updated_at: '2026-06-13T08:00:00.000Z',
    },
    workflow_current_step: steps.find((step) => step.step_no === currentStepNo)?.step_name ?? null,
    workflow_step_status: currentStepStatus,
    workflow_started_at: '2026-06-13T08:00:00.000Z',
    workflow_updated_at: '2026-06-13T08:00:00.000Z',
    plan_generated_at: '2026-06-13T08:00:00.000Z',
    plan_approved_at: '2026-06-13T08:00:00.000Z',
    ...partial,
  };
}

function planningSessionFromRun(run: unknown, pendingApprovals: unknown[]) {
  const row = run as {
    runId?: string;
    status?: string;
    inputSummary?: { ingestionSessionId?: string; fileKey?: string };
    startedAt?: string;
  };
  const approvalsForRun = pendingApprovals.filter(
    (item) => (item as { runId?: string }).runId === row.runId,
  ) as Array<{ stepId?: string }>;
  const approvalStepNo = approvalsForRun.reduce(
    (maxStepNo, approval) =>
      Math.max(maxStepNo, approval.stepId ? workflowStepNoFromApproval(approval.stepId) : 0),
    0,
  );
  const currentStepNo = approvalStepNo
    ? approvalStepNo
    : row.status === 'success' || row.status === 'canceled'
      ? 5
      : 1;
  const terminal = row.status === 'success' || row.status === 'canceled';
  const currentStepStatus = terminal
    ? row.status === 'canceled'
      ? 'cancelled'
      : 'completed'
    : approvalStepNo
      ? 'needs_review'
      : 'in_progress';

  const fileKey = row.inputSummary?.fileKey ?? 'tenant/pmo/session/pmo_2025-w35.xlsx';
  const workbookName = fileKey.split('/').at(-1) ?? 'pmo_2025-w35.xlsx';

  return makePlanningSession({
    ingestion_session_id:
      row.inputSummary?.ingestionSessionId ?? '629d3033-67df-4d5b-a270-77d690c43c13',
    workbook_name: workbookName,
    uploaded_at: row.startedAt ?? '2026-06-13T08:00:00.000Z',
    currentStepNo,
    currentStepStatus,
    status_label:
      row.status === 'success'
        ? 'Completed'
        : row.status === 'canceled'
          ? 'Cancelled'
          : currentStepStatus === 'needs_review'
            ? 'Needs review'
            : 'In progress',
    workflow_step_status: currentStepStatus,
  });
}

function createFetchMock(opts?: {
  runRows?: unknown[];
  planningSessions?: unknown[];
  pendingApprovals?: unknown[];
  snapshotResponse?: unknown;
  uploadResponse?: unknown;
  uploadStatus?: number;
  startResponse?: unknown;
  startStatus?: number;
  decideResponse?: unknown;
  decideStatus?: number;
  cancelResponse?: unknown;
  cancelStatus?: number;
}) {
  const runRows = opts?.runRows ?? [];
  const pendingApprovals = opts?.pendingApprovals ?? [];
  const planningSessions =
    opts?.planningSessions ?? runRows.map((run) => planningSessionFromRun(run, pendingApprovals));
  const uploadStatus = opts?.uploadStatus ?? 200;
  const startStatus = opts?.startStatus ?? 200;
  const decideStatus = opts?.decideStatus ?? 200;
  const cancelStatus = opts?.cancelStatus ?? 200;

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('/api/agent/v1/workflows/runs?')) {
      return mockJsonResponse({ rows: runRows, nextCursor: null });
    }
    if (url === '/api/agent/v1/workflows/sse-token') {
      return mockJsonResponse({ token: 'test-sse-token' });
    }
    if (/^\/api\/agent\/v1\/workflows\/runs\/[^/]+\/snapshot$/.test(url)) {
      return mockJsonResponse(opts?.snapshotResponse ?? {});
    }
    if (url === '/api/agent/v1/workflows/my-pending-approvals') {
      return mockJsonResponse(pendingApprovals);
    }
    if (url === '/api/pmo/v1/ingestion-sessions') {
      return mockJsonResponse({ items: planningSessions });
    }
    if (url === '/api/pmo/v1/upload') {
      return mockJsonResponse(
        opts?.uploadResponse ?? {
          ingestion_session_id: '11111111-1111-4111-8111-111111111111',
          s3_key: 'tenant/pmo/session/workbook.xlsx',
          status: 'uploaded',
        },
        uploadStatus,
      );
    }
    if (url === '/api/pmo/v1/plan/generate') {
      return mockJsonResponse({
        ingestion_session_id: '11111111-1111-4111-8111-111111111111',
        planning_state: 'plan_review',
        plan: makePlan(),
        plan_version: 1,
        feedback_history: [],
      });
    }
    if (url === '/api/agent/v1/workflows/runs/pmo.ingestData.v2/start') {
      return mockJsonResponse(opts?.startResponse ?? { runId: 'run-123' }, startStatus);
    }
    if (/^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(url)) {
      return mockJsonResponse(
        opts?.decideResponse ?? { runId: 'run-123', approvalId: 'approval-1', resumed: true },
        decideStatus,
      );
    }
    if (/^\/api\/agent\/v1\/workflows\/runs\/[^/]+\/cancel$/.test(url)) {
      return mockJsonResponse(opts?.cancelResponse ?? { ok: true }, cancelStatus);
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

function findCall(
  fetchMock: ReturnType<typeof vi.fn>,
  matcher: (url: string) => boolean,
): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls.find((entry) => matcher(String(entry[0])));
  if (!call) {
    throw new Error('Expected fetch call was not made');
  }
  return call as [string, RequestInit | undefined];
}

describe('PmoPage', () => {
  beforeEach(() => {
    class TestEventSource {
      addEventListener = vi.fn();
      close = vi.fn();
    }

    vi.stubGlobal('EventSource', TestEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads workbook, then generates a plan only after clicking Analyze', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-123',
          status: 'running',
          latestApprovalKind: null,
        }),
      ],
      pendingApprovals: [],
      uploadResponse: {
        ingestion_session_id: '11111111-1111-4111-8111-111111111111',
        s3_key: 'tenant/pmo/session/workbook.xlsx',
        status: 'uploaded',
      },
      startResponse: { runId: 'run-123' },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    fireEvent.change(screen.getByLabelText(/reporting period key/i), {
      target: { value: '2026-W24' },
    });

    const file = new File(['sheet-data'], 'workbook.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    dropFile(file);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((entry) => String(entry[0]) === '/api/pmo/v1/upload')).toBe(
        true,
      );
    });

    expect(
      fetchMock.mock.calls.some(
        (entry) => String(entry[0]) === '/api/agent/v1/workflows/runs/pmo.ingestData.v2/start',
      ),
    ).toBe(false);

    expect(screen.getByRole('button', { name: 'Analyze & generate plan' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze & generate plan' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((entry) => String(entry[0]) === '/api/pmo/v1/plan/generate'),
      ).toBe(true);
    });

    const uploadCall = findCall(fetchMock, (url) => url === '/api/pmo/v1/upload');
    expect(uploadCall[0]).toBe('/api/pmo/v1/upload');
    expect(uploadCall[1]?.method).toBe('POST');
    const uploadBody = uploadCall[1]?.body as FormData;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect(uploadBody.get('reporting_period_key')).toBe('2026-W24');
    const sentFile = uploadBody.get('file');
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe('workbook.xlsx');

    const generateCall = findCall(fetchMock, (url) => url === '/api/pmo/v1/plan/generate');
    expect(generateCall[0]).toBe('/api/pmo/v1/plan/generate');
    expect(generateCall[1]?.method).toBe('POST');
    expect(generateCall[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(generateCall[1]?.body))).toEqual({
      ingestion_session_id: '11111111-1111-4111-8111-111111111111',
      goal: 'Ingest this workbook and prepare data for RA calculation.',
    });

    await waitFor(() => {
      expect(screen.getByText('Upload history')).toBeInTheDocument();
      expect(screen.getAllByText('workbook.xlsx').length).toBeGreaterThan(0);
    });
  });

  it('does not start workflow when upload fails', async () => {
    const fetchMock = createFetchMock({
      runRows: [],
      pendingApprovals: [],
      uploadResponse: { message: 'upload_failed' },
      uploadStatus: 500,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    const file = new File(['sheet-data'], 'workbook.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    dropFile(file);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((entry) => String(entry[0]) === '/api/pmo/v1/upload')).toBe(
        true,
      );
    });

    expect(
      fetchMock.mock.calls.some(
        (entry) => String(entry[0]) === '/api/agent/v1/workflows/runs/pmo.ingestData.v2/start',
      ),
    ).toBe(false);
  });

  it('shows need review state and in-page approve card for pending reviewChanges', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-review',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-1',
          runId: 'run-review',
          stepId: 'pmo.ingest.reviewChanges',
          proposedPayload: {
            toolCallId: 'workflow:run-review:pmo_confirmPublish',
            intent: 'Review staging changes before publish',
            riskBadge: 'write',
            summary: 'Ready to publish 1200 effective change(s).',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'New rows', v: '11' },
                  { k: 'Updated rows', v: '3' },
                  { k: 'Duplicates in upload', v: '1' },
                ],
              },
            ],
            primary: { label: 'Approve publish', argsPatch: { decision: 'approve' } },
            alternates: [],
            decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmPublish',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getAllByText('Review staging changes').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Approve publish' })).toBeInTheDocument();
    });
  });

  it('shows in-page mapping approval when approval stepId uses legacy format', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-mapping',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-mapping-1',
          runId: 'run-mapping',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-mapping:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/3. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Ingestion session', v: '889fca56-3ad8-432a-be92-27d4ab1ea1d5' },
                  { k: 'Validation status', v: 'needs_review' },
                  { k: 'Workbook confidence', v: '95.0%' },
                  { k: 'Approved items', v: '0/3' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Issue type', v: 'needs_review' },
                  { k: 'Table', v: 'overbook_idle_config' },
                  { k: 'Sheet', v: 'DS03_Overbook_Idle_Config' },
                  { k: 'Field', v: 'overbook_threshold' },
                  { k: 'Source column', v: 'Overbook_threshold' },
                  { k: 'Confidence', v: '94.0%' },
                  { k: 'Issue', v: 'needs_review <- Overbook_threshold (94.0%)' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'current review | needs_review',
                  },
                  {
                    k: 'overbook_idle_config.overbook_threshold_2',
                    v: 'pending review | ambiguous',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/3',
              argsPatch: {
                decision: 'approve',
                approvedItemKey:
                  'overbook_idle_config|mapping|overbook_threshold|Overbook_threshold|needs_review',
                approvedItemKeys: [],
              },
            },
            alternates: [],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByText('Review column mappings')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Approve' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled();
    });
  });

  it('groups mapping rows by sheet and renders modify-only action for auto_accept rows', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-mapping-grouped',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-mapping-grouped',
          runId: 'run-mapping-grouped',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-mapping-grouped:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/1. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Ingestion session', v: '889fca56-3ad8-432a-be92-27d4ab1ea1d5' },
                  { k: 'Validation status', v: 'needs_review' },
                  { k: 'Workbook confidence', v: '95.0%' },
                  { k: 'Approved items', v: '0/1' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Issue type', v: 'needs_review' },
                  { k: 'Table', v: 'resource_allocation' },
                  { k: 'Sheet', v: 'DS01' },
                  { k: 'Field', v: 'role' },
                  { k: 'Source column', v: 'Role' },
                  { k: 'Confidence', v: '75.0%' },
                  { k: 'Issue', v: 'needs_review <- Role (75.0%)' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'resource_allocation.member_id',
                    v: 'approved | auto_accept | Account_ID | 97.0% | - | DS01 | modify_only',
                  },
                  {
                    k: 'resource_allocation.role',
                    v: 'current review | needs_review | Role | 75.0% | - | DS01 | approve_and_modify',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/1',
              argsPatch: {
                decision: 'approve',
                approvedItemKey: 'resource_allocation|mapping|role|Role|needs_review',
                approvedItemKeys: [],
                mappingOverrides: [],
              },
            },
            alternates: [
              {
                label: 'Use DS01.AccountId for resource_allocation.member_id',
                argsPatch: {
                  decision: 'modify',
                  approvedItemKeys: [],
                  mappingOverride: {
                    tableId: 'resource_allocation',
                    field: 'member_id',
                    sourceColumn: 'AccountId',
                    confidence: 0.91,
                    blocked: false,
                  },
                  mappingOverrides: [
                    {
                      tableId: 'resource_allocation',
                      field: 'member_id',
                      sourceColumn: 'AccountId',
                      confidence: 0.91,
                      blocked: false,
                    },
                  ],
                },
              },
            ],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByText('Sheet: DS01')).toBeInTheDocument();
    });

    const autoRow = screen.getByText('Account_ID').closest('tr');
    expect(autoRow).not.toBeNull();
    if (!autoRow) throw new Error('Expected auto_accept row to exist');

    expect(within(autoRow).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(autoRow).getByRole('button', { name: 'Modify' })).toBeInTheDocument();
  });

  it('keeps selected run when another run has pending approvals', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-summary',
          status: 'running',
          startedAt: '2026-06-14T10:00:00.000Z',
          inputSummary: {
            ingestionSessionId: '11111111-1111-4111-8111-111111111111',
            fileKey: 'tenant/pmo/session/summary.xlsx',
            reportingPeriodKey: '2026-W24',
          },
          latestApprovalKind: null,
        }),
        makeRunRow({
          runId: 'run-pending',
          status: 'paused',
          startedAt: '2026-06-14T09:00:00.000Z',
          inputSummary: {
            ingestionSessionId: '22222222-2222-4222-8222-222222222222',
            fileKey: 'tenant/pmo/session/pending.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-pending-1',
          runId: 'run-pending',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-pending:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/1. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Ingestion session', v: '889fca56-3ad8-432a-be92-27d4ab1ea1d5' },
                  { k: 'Validation status', v: 'needs_review' },
                  { k: 'Workbook confidence', v: '95.0%' },
                  { k: 'Approved items', v: '0/1' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Issue type', v: 'needs_review' },
                  { k: 'Table', v: 'overbook_idle_config' },
                  { k: 'Field', v: 'overbook_threshold' },
                  { k: 'Source column', v: 'Overbook_threshold' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'current review | needs_review | Overbook_threshold | 94.0% | -',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/1',
              argsPatch: {
                decision: 'approve',
                approvedItemKey:
                  'overbook_idle_config|mapping|overbook_threshold|Overbook_threshold|needs_review',
                approvedItemKeys: [],
              },
            },
            alternates: [],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'View' }).length).toBeGreaterThanOrEqual(2);
    });

    const summaryRowCell = screen.getAllByText('summary.xlsx').find((node) => node.closest('tr'));
    expect(summaryRowCell).toBeTruthy();
    fireEvent.click(
      within(summaryRowCell?.closest('tr') as HTMLElement).getByRole('button', { name: 'View' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow execution')).toBeInTheDocument();
      expect(screen.queryByText('Review column mappings')).not.toBeInTheDocument();
    });
  });

  it('prioritizes db stage when run has both mapping and db approvals', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-db-priority',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-mapping-stale',
          runId: 'run-db-priority',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-db-priority:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/1. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [{ k: 'Approved items', v: '0/1' }],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Table', v: 'overbook_idle_config' },
                  { k: 'Field', v: 'overbook_threshold' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'current review | needs_review | Overbook_threshold | 94.0% | -',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/1',
              argsPatch: { decision: 'approve' },
            },
            alternates: [],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
        {
          approvalId: 'approval-db-current',
          runId: 'run-db-priority',
          stepId: 'pmo.ingest.reviewChanges',
          proposedPayload: {
            toolCallId: 'workflow:run-db-priority:pmo_confirmPublish',
            intent: 'Review staging changes before publish',
            riskBadge: 'write',
            summary: 'Ready to publish 1200 effective change(s).',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Rows to upsert', v: '11' },
                  { k: 'Rows to skip', v: '1' },
                  { k: 'New rows', v: '8' },
                  { k: 'Updated rows', v: '3' },
                  { k: 'Exact duplicates', v: '0' },
                  { k: 'Duplicates in upload', v: '1' },
                  { k: 'Blocking issues', v: '0' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'resource_allocation',
                    v: 'upsert=11 | skip=1 | new=8 | updated=3 | exact_dup=0 | dup_in_upload=1',
                  },
                ],
              },
            ],
            primary: { label: 'Approve publish', argsPatch: { decision: 'approve' } },
            alternates: [],
            decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmPublish',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:01.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getAllByText('Database comparison and change summary').length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByText('Review column mappings')).not.toBeInTheDocument();
    });
  });

  it('shows historical process details when viewing completed or canceled runs', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-success-history',
          status: 'success',
          startedAt: '2026-06-14T11:00:00.000Z',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/success.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
        makeRunRow({
          runId: 'run-canceled-history',
          status: 'canceled',
          startedAt: '2026-06-14T10:00:00.000Z',
          inputSummary: {
            ingestionSessionId: '62ad3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/canceled.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [],
      snapshotResponse: {
        context: {
          'pmo.ingest.confirmMapping': {
            output: {
              mappingReviewRows: [
                {
                  k: 'resource_allocation.member_id',
                  v: 'approved | auto_accept | Member ID | 98.0% | user-1 | DS01 | modify_only',
                },
              ],
            },
          },
          'pmo.ingest.normalizeToStaging': {
            output: {
              changeSummary: [
                {
                  tableId: 'resource_allocation',
                  counts: {
                    new_records: 8,
                    updated_records: 3,
                    exact_duplicates: 1,
                    duplicates_in_upload: 0,
                  },
                  sampleChanges: [],
                },
              ],
              blockingIssues: [],
            },
          },
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    const successRowCell = (await screen.findAllByText('success.xlsx')).find((node) =>
      node.closest('tr'),
    );
    expect(successRowCell).toBeTruthy();
    fireEvent.click(
      within(successRowCell?.closest('tr') as HTMLElement).getByRole('button', { name: 'View' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow execution')).toBeInTheDocument();
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    });

    const canceledRowCell = screen.getAllByText('canceled.xlsx').find((node) => node.closest('tr'));
    expect(canceledRowCell).toBeTruthy();
    fireEvent.click(
      within(canceledRowCell?.closest('tr') as HTMLElement).getByRole('button', { name: 'View' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow execution')).toBeInTheDocument();
      expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    });
  });

  it('requires explicit next step after all mapping items are approved', async () => {
    const itemId =
      'overbook_idle_config|mapping|overbook_threshold|Overbook_threshold|needs_review';
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-mapping-ready',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-mapping-next-step',
          runId: 'run-mapping-ready',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-mapping-ready:pmo_confirmMapping',
            intent: 'Proceed to DB changes review',
            riskBadge: 'write',
            summary:
              'All mapping items are approved. Click Next step to continue to DB changes review.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Ingestion session', v: '889fca56-3ad8-432a-be92-27d4ab1ea1d5' },
                  { k: 'Validation status', v: 'needs_review' },
                  { k: 'Workbook confidence', v: '95.0%' },
                  { k: 'Approved items', v: '1/1' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Status', v: 'All mapping items are approved' },
                  { k: 'Next action', v: 'Click Next step to continue workflow' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'approved | needs_review | Overbook_threshold | 94.0% | 22222222-2222-4222-8222-222222222222',
                  },
                ],
              },
            ],
            primary: {
              label: 'Next step',
              argsPatch: {
                decision: 'approve',
                approvedItemKeys: [itemId],
                approvedByByItemKey: { [itemId]: '22222222-2222-4222-8222-222222222222' },
                mappingOverrides: [],
                proceedToNextStep: true,
              },
            },
            alternates: [],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next step' })).toBeEnabled();
      expect(screen.getAllByText('Validation and normalization to staging').length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText('22222222').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((entry) =>
          /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(String(entry[0])),
        ),
      ).toBe(true);
    });

    const decideCall = findCall(fetchMock, (url) =>
      /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(url),
    );
    expect(decideCall[1]?.method).toBe('POST');
    expect(JSON.parse(String(decideCall[1]?.body))).toEqual({
      decision: 'approve',
    });
  });

  it('shows normalization findings and submits missing member master additions', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-normalization-review',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-normalization-1',
          runId: 'run-normalization-review',
          stepId: 'pmo.ingest.normalizeToStaging',
          proposedPayload: {
            toolCallId: 'workflow:run-normalization-review:pmo_reviewNormalization',
            intent: 'Review normalized data before staging',
            riskBadge: 'write',
            summary: 'Normalized data has blocking member master findings.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Rows to stage', v: '12' },
                  { k: 'Duplicates in upload', v: '0' },
                  { k: 'Blocking issues', v: '1' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'resource_allocation',
                    v: 'stage=12 | new=8 | updated=4 | duplicates=0',
                  },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'Blocking member_id issue',
                    v: "member_id 'M-404' not found in member_master or active database",
                  },
                ],
              },
            ],
            primary: { label: 'Resolve findings', argsPatch: { decision: 'approve' } },
            alternates: [],
            decline: { label: 'Reject normalization', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_reviewNormalization',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          status: 'pending',
          decisionPayload: null,
          decidedAt: null,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByText('Validate normalized data')).toBeInTheDocument();
      expect(screen.getByDisplayValue('M-404')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add members & continue' })).toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Missing Member' },
    });
    fireEvent.change(screen.getByLabelText('Department'), {
      target: { value: 'Delivery' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add members & continue' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((entry) =>
          /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(String(entry[0])),
        ),
      ).toBe(true);
    });

    const decideCall = findCall(fetchMock, (url) =>
      /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(url),
    );
    expect(JSON.parse(String(decideCall[1]?.body))).toEqual({
      decision: 'modify',
      payloadPatch: {
        decision: 'approve',
        memberMasterAdditions: [
          {
            member_id: 'M-404',
            full_name: 'Missing Member',
            department: 'Delivery',
          },
        ],
      },
    });
  });

  it('cancels workflow directly from mapping tab', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-cancel',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-cancel',
          runId: 'run-cancel',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-cancel:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/1. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [{ k: 'Approved items', v: '0/1' }],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Table', v: 'overbook_idle_config' },
                  { k: 'Field', v: 'overbook_threshold' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'current review | needs_review | Overbook_threshold | 94.0% | -',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/1',
              argsPatch: {
                decision: 'approve',
                approvedItemKey:
                  'overbook_idle_config|mapping|overbook_threshold|Overbook_threshold|needs_review',
                approvedItemKeys: [],
              },
            },
            alternates: [],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((entry) =>
          /^\/api\/agent\/v1\/workflows\/runs\/[^/]+\/cancel$/.test(String(entry[0])),
        ),
      ).toBe(true);
    });
  });

  it('submits inline modify decision in mapping tab without leaving PMO page', async () => {
    const fetchMock = createFetchMock({
      runRows: [
        makeRunRow({
          runId: 'run-mapping-modify',
          status: 'paused',
          inputSummary: {
            ingestionSessionId: '629d3033-67df-4d5b-a270-77d690c43c13',
            fileKey: 'tenant/pmo/session/pmo_2025-w35.xlsx',
            reportingPeriodKey: '2026-W24',
          },
        }),
      ],
      pendingApprovals: [
        {
          approvalId: 'approval-mapping-modify',
          runId: 'run-mapping-modify',
          stepId: 'confirmMapping',
          proposedPayload: {
            toolCallId: 'workflow:run-mapping-modify:pmo_confirmMapping',
            intent: 'Approve mapping item',
            riskBadge: 'write',
            summary: 'Review mapping item 1/1. Approve each item to continue.',
            details: [
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Ingestion session', v: '889fca56-3ad8-432a-be92-27d4ab1ea1d5' },
                  { k: 'Validation status', v: 'needs_review' },
                  { k: 'Workbook confidence', v: '95.0%' },
                  { k: 'Approved items', v: '0/1' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  { k: 'Issue type', v: 'needs_review' },
                  { k: 'Table', v: 'overbook_idle_config' },
                  { k: 'Sheet', v: 'DS03_Overbook_Idle_Config' },
                  { k: 'Field', v: 'overbook_threshold' },
                  { k: 'Source column', v: 'Overbook_threshold' },
                  { k: 'Confidence', v: '94.0%' },
                  { k: 'Issue', v: 'needs_review <- Overbook_threshold (94.0%)' },
                ],
              },
              {
                kind: 'kvTable',
                rows: [
                  {
                    k: 'overbook_idle_config.overbook_threshold',
                    v: 'current review | needs_review | Overbook_threshold | 94.0%',
                  },
                ],
              },
            ],
            primary: {
              label: 'Approve item 1/1',
              argsPatch: {
                decision: 'approve',
                approvedItemKey:
                  'overbook_idle_config|mapping|overbook_threshold|Overbook_threshold|needs_review',
                approvedItemKeys: [],
                mappingOverrides: [],
              },
            },
            alternates: [
              {
                label: 'Use Overbook_limit',
                argsPatch: {
                  decision: 'modify',
                  approvedItemKeys: [],
                  mappingOverride: {
                    tableId: 'overbook_idle_config',
                    field: 'overbook_threshold',
                    sourceColumn: 'Overbook_limit',
                    confidence: 0.82,
                    blocked: false,
                  },
                  mappingOverrides: [
                    {
                      tableId: 'overbook_idle_config',
                      field: 'overbook_threshold',
                      sourceColumn: 'Overbook_limit',
                      confidence: 0.82,
                      blocked: false,
                    },
                  ],
                },
              },
            ],
            decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
            meta: {
              tenantId: '11111111-1111-4111-8111-111111111111',
              userId: '22222222-2222-4222-8222-222222222222',
              agentPath: ['supervisor', 'work', 'pmo'],
              toolId: 'pmo_confirmMapping',
              ts: '2026-06-13T08:00:00.000Z',
            },
          },
          approverUserId: '22222222-2222-4222-8222-222222222222',
          surfaceCanvas: true,
          surfaceChatThreadId: null,
          agentic: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-06-13T08:00:00.000Z',
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    await waitFor(() => {
      expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByText('Review column mappings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));

    await waitFor(() => {
      expect(screen.getByText('Modify current mapping')).toBeInTheDocument();
      expect(
        screen.getByText(
          /modify only changes the source column from sheet data\. target db column stays/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /DS03_Overbook_Idle_Config\s*\.\s*Overbook_limit/i,
        }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /DS03_Overbook_Idle_Config\s*\.\s*Overbook_limit/i,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((entry) =>
          /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(String(entry[0])),
        ),
      ).toBe(true);
    });

    const decideCall = findCall(fetchMock, (url) =>
      /^\/api\/agent\/v1\/workflows\/approvals\/[^/]+\/decide$/.test(url),
    );
    expect(decideCall[1]?.method).toBe('POST');
    expect(JSON.parse(String(decideCall[1]?.body))).toEqual({
      decision: 'modify',
      alternateIndices: [0],
    });
  });
});
