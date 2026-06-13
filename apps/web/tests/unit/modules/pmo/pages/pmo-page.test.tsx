import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    workflowId: 'pmo.ingestData',
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

function createFetchMock(opts?: {
  runRows?: unknown[];
  pendingApprovals?: unknown[];
  snapshotResponse?: unknown;
  uploadResponse?: unknown;
  uploadStatus?: number;
  startResponse?: unknown;
  startStatus?: number;
}) {
  const runRows = opts?.runRows ?? [];
  const pendingApprovals = opts?.pendingApprovals ?? [];
  const uploadStatus = opts?.uploadStatus ?? 200;
  const startStatus = opts?.startStatus ?? 200;

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('/api/agent/v1/workflows/runs?')) {
      return mockJsonResponse({ rows: runRows, nextCursor: null });
    }
    if (/^\/api\/agent\/v1\/workflows\/runs\/[^/]+\/snapshot$/.test(url)) {
      return mockJsonResponse(opts?.snapshotResponse ?? {});
    }
    if (url === '/api/agent/v1/workflows/my-pending-approvals') {
      return mockJsonResponse(pendingApprovals);
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
    if (url === '/api/agent/v1/workflows/runs/pmo.ingestData/start') {
      return mockJsonResponse(opts?.startResponse ?? { runId: 'run-123' }, startStatus);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads workbook, starts pmo.ingestData workflow, and keeps session trace on PMO page', async () => {
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
      expect(
        fetchMock.mock.calls.some(
          (entry) => String(entry[0]) === '/api/agent/v1/workflows/runs/pmo.ingestData/start',
        ),
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

    const startCall = findCall(
      fetchMock,
      (url) => url === '/api/agent/v1/workflows/runs/pmo.ingestData/start',
    );
    expect(startCall[0]).toBe('/api/agent/v1/workflows/runs/pmo.ingestData/start');
    expect(startCall[1]?.method).toBe('POST');
    expect(startCall[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(startCall[1]?.body))).toEqual({
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
      fileKey: 'tenant/pmo/session/workbook.xlsx',
      reportingPeriodKey: '2026-W24',
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
        (entry) => String(entry[0]) === '/api/agent/v1/workflows/runs/pmo.ingestData/start',
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

    fireEvent.click(screen.getByRole('button', { name: 'Review now' }));

    await waitFor(() => {
      expect(screen.getAllByText('Review changes').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Approve publish' })).toBeInTheDocument();
    });
  });
});
