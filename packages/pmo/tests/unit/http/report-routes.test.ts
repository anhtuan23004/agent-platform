import type { SessionScope, WorkerHandle } from '@seta/core';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  type PmoReportRouteDeps,
  registerPmoReportRoutes,
} from '../../../src/backend/http/report-routes.ts';
import type { ReportRunRecord } from '../../../src/backend/reporting/report-repository.ts';

const session = (permissions = ['pmo.data.read']): SessionScope => ({
  session_id: 'session-1',
  user_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  email: 'pmo@example.com',
  display_name: 'PMO User',
  role_summary: { roles: ['pmo.viewer'], cross_tenant_read: false },
  role_summary_hash: 'hash',
  permissions: new Set(permissions),
  accessible_group_ids: [],
  cross_tenant_read: false,
  built_at: new Date('2026-06-21T00:00:00.000Z'),
  invalidated_at: null,
});

function reportRun(status: ReportRunRecord['status'] = 'queued'): ReportRunRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: session().tenant_id,
    ingestionSessionId: null,
    status,
    envelope: {
      request: {
        reportFamily: 'workload',
        sourceMode: 'canonical_db',
        dateRange: { from: '2026-06-29', to: '2026-08-07' },
        reportTypes: ['overbook', 'idle'],
        outputFormat: 'pdf',
      },
      ruleSnapshot: { ruleSetId: 'rule', version: 'v1', sha256: 'a'.repeat(64), rules: {} },
    },
    report: null,
    htmlS3Key: null,
    htmlSha256: null,
    htmlSizeBytes: null,
    pdfS3Key: null,
    pdfSha256: null,
    pdfSizeBytes: null,
    failureCode: status === 'failed' ? 'chromium_crashed' : null,
    failureMessage: status === 'failed' ? 'Chromium crashed' : null,
    createdAt: new Date('2026-06-21T01:00:00.000Z'),
    updatedAt: new Date('2026-06-21T01:01:00.000Z'),
    completedAt: status === 'completed' ? new Date('2026-06-21T01:02:00.000Z') : null,
  };
}

function setup(overrides: Partial<PmoReportRouteDeps> = {}, scope = session()) {
  const app = new Hono<{ Variables: { user: SessionScope } }>();
  app.use('*', async (c, next) => {
    c.set('user', scope);
    await next();
  });
  const workers: WorkerHandle = {
    addJob: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
  const deps: PmoReportRouteDeps = {
    workers,
    createRun: vi.fn(async () => reportRun().id),
    enqueue: vi.fn(async () => undefined),
    getRun: vi.fn(async () => reportRun()),
    retry: vi.fn(async () => true),
    presign: vi.fn(async () => 'https://private.example/signed'),
    getDateBounds: vi.fn(async () => ({ min: '2026-06-29', max: '2026-08-07' })),
    bucket: 'private-reports',
    ...overrides,
  };
  registerPmoReportRoutes(app, deps);
  return { app, deps };
}

describe('PMO report routes', () => {
  it('creates tenant-scoped PDF run and enqueues worker without accepting tenantId', async () => {
    const { app, deps } = setup();
    const response = await app.request('/api/pmo/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRange: { from: '2026-06-29', to: '2026-08-07' },
        reportTypes: ['overbook', 'idle'],
      }),
    });
    expect(response.status).toBe(202);
    expect(deps.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: session().tenant_id,
        actorId: session().user_id,
        sourceMode: 'canonical_db',
        reportFamily: undefined,
        outputFormat: 'pdf',
      }),
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      deps.workers,
      session().tenant_id,
      reportRun().id,
      'pdf',
    );

    const injected = await app.request('/api/pmo/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'attacker-tenant',
        dateRange: { from: '2026-06-29', to: '2026-08-07' },
      }),
    });
    expect(injected.status).toBe(400);
  });

  it('requires pmo.data.read before DB access', async () => {
    const { app, deps } = setup({}, session([]));
    const response = await app.request(`/api/pmo/v1/reports/${reportRun().id}`);
    expect(response.status).toBe(403);
    expect(deps.getRun).not.toHaveBeenCalled();
  });

  it('rejects explicit range outside canonical bounds', async () => {
    const { app, deps } = setup();
    const response = await app.request('/api/pmo/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateRange: { from: '2026-06-01', to: '2026-08-07' } }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'report_date_range_outside_canonical_bounds',
      bounds: { min: '2026-06-29', max: '2026-08-07' },
    });
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it('accepts forward allocation report family for JSON runs', async () => {
    const getRun = vi.fn(async () => ({
      ...reportRun(),
      envelope: {
        ...reportRun().envelope,
        request: {
          ...reportRun().envelope.request,
          reportFamily: 'forward_allocation' as const,
          reportTypes: ['forward_allocation'] as Array<'forward_allocation'>,
          outputFormat: 'json' as const,
        },
      },
    }));
    const { app, deps } = setup({ getRun });
    const response = await app.request('/api/pmo/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reportFamily: 'forward_allocation',
        dateRange: { from: '2026-06-29', to: '2026-08-07' },
        reportTypes: ['forward_allocation'],
        outputFormat: 'json',
      }),
    });
    expect(response.status).toBe(202);
    expect(deps.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        reportFamily: 'forward_allocation',
        reportTypes: ['forward_allocation'],
        outputFormat: 'json',
      }),
    );
    expect(await response.json()).toMatchObject({
      reportFamily: 'forward_allocation',
      outputFormat: 'json',
    });
  });

  it('returns invalid_request when forward allocation asks for PDF', async () => {
    const createRun = vi.fn(async () => {
      throw new Error('forward_allocation_pdf_not_supported');
    });
    const { app } = setup({ createRun });
    const response = await app.request('/api/pmo/v1/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reportFamily: 'forward_allocation',
        dateRange: { from: '2026-06-29', to: '2026-08-07' },
        reportTypes: ['forward_allocation'],
        outputFormat: 'pdf',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'invalid_request',
      message: 'forward_allocation_pdf_not_supported',
    });
  });

  it('returns 404 for run outside session tenant', async () => {
    const getRun = vi.fn(async () => Promise.reject(new Error('report_run_not_found')));
    const { app } = setup({ getRun });
    const response = await app.request(`/api/pmo/v1/reports/${reportRun().id}`);
    expect(response.status).toBe(404);
    expect(getRun).toHaveBeenCalledWith(session().tenant_id, reportRun().id);
  });

  it('redirects completed artifact through short-lived signed URL with safe filename', async () => {
    const completed = {
      ...reportRun('completed'),
      pdfS3Key: `tenants/${session().tenant_id}/pmo/reports/${reportRun().id}/report.pdf`,
      pdfSha256: 'b'.repeat(64),
      pdfSizeBytes: 4096,
    };
    const presign = vi.fn(async () => 'https://private.example/signed');
    const { app } = setup({ getRun: vi.fn(async () => completed), presign });
    const response = await app.request(`/api/pmo/v1/reports/${reportRun().id}/download?format=pdf`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://private.example/signed');
    expect(presign).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'private-reports',
        expiresInSeconds: 300,
        responseContentDisposition:
          'attachment; filename="pmo-workload-report-2026-06-29-to-2026-08-07.pdf"',
      }),
    );
  });

  it('requeues only failed tenant-owned run', async () => {
    const failed = reportRun('failed');
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ ...failed, status: 'queued' });
    const { app, deps } = setup({ getRun });
    const response = await app.request(`/api/pmo/v1/reports/${failed.id}/retry`, {
      method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(deps.retry).toHaveBeenCalledWith(session().tenant_id, failed.id);
    expect(deps.enqueue).toHaveBeenCalledWith(deps.workers, session().tenant_id, failed.id, 'pdf');
  });
});
