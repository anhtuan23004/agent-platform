import type { SessionEnv, WorkerHandle } from '@seta/core';
import { can } from '@seta/shared-rbac';
import { presignedDownloadUrl } from '@seta/shared-storage';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { getPmoReportDateBounds } from '../analytics/report-date-bounds.ts';
import type { ReportStatusResponse } from '../reporting/contracts.ts';
import { createReportRun } from '../reporting/generate-report.ts';
import { enqueueReportRun } from '../reporting/jobs/enqueue-report.ts';
import {
  getReportRun,
  type ReportRunRecord,
  retryReportRun,
} from '../reporting/report-repository.ts';

const CreateReportSchema = z
  .object({
    dateRange: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    reportFamily: z.enum(['workload', 'forward_allocation']).optional(),
    reportTypes: z
      .array(z.enum(['idle', 'overbook', 'idle_members', 'overbook_members', 'forward_allocation']))
      .min(1)
      .default(['idle', 'overbook']),
    recommendationCandidateCount: z.number().int().min(1).max(5).optional(),
    outputFormat: z.enum(['json', 'pdf']).default('pdf'),
  })
  .strict();

const DownloadQuerySchema = z.object({ format: z.enum(['html', 'pdf']) });
const ReportRunIdSchema = z.string().uuid();

export interface PmoReportRouteDeps {
  workers: WorkerHandle;
  createRun?: typeof createReportRun;
  enqueue?: typeof enqueueReportRun;
  getRun?: typeof getReportRun;
  retry?: typeof retryReportRun;
  presign?: typeof presignedDownloadUrl;
  bucket?: string;
  getDateBounds?: typeof getPmoReportDateBounds;
}

export function registerPmoReportRoutes(app: Hono<SessionEnv>, deps: PmoReportRouteDeps): void {
  const createRun = deps.createRun ?? createReportRun;
  const enqueue = deps.enqueue ?? enqueueReportRun;
  const getRun = deps.getRun ?? getReportRun;
  const retry = deps.retry ?? retryReportRun;
  const presign = deps.presign ?? presignedDownloadUrl;
  const getDateBounds = deps.getDateBounds ?? getPmoReportDateBounds;

  app.post('/api/pmo/v1/reports', async (c) => {
    const session = c.get('user');
    if (!can(session, 'pmo.data.read')) return forbidden(c);
    const parsed = CreateReportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }
    try {
      const bounds = await getDateBounds(session.tenant_id);
      if (!bounds) throw new Error('report_canonical_date_bounds_unavailable');
      if (parsed.data.dateRange.from < bounds.min || parsed.data.dateRange.to > bounds.max) {
        return c.json(
          {
            error: 'report_date_range_outside_canonical_bounds',
            bounds,
          },
          400,
        );
      }
      const reportRunId = await createRun({
        tenantId: session.tenant_id,
        actorId: session.user_id,
        sourceMode: 'canonical_db',
        reportFamily: parsed.data.reportFamily,
        dateRange: parsed.data.dateRange,
        reportTypes: parsed.data.reportTypes,
        recommendationCandidateCount: parsed.data.recommendationCandidateCount,
        outputFormat: parsed.data.outputFormat,
      });
      await enqueue(deps.workers, session.tenant_id, reportRunId, parsed.data.outputFormat);
      const run = await getRun(session.tenant_id, reportRunId);
      return c.json(toReportStatusResponse(run), 202);
    } catch (error) {
      return reportError(c, error);
    }
  });

  app.get('/api/pmo/v1/reports/:id', async (c) => {
    const session = c.get('user');
    if (!can(session, 'pmo.data.read')) return forbidden(c);
    const reportRunId = ReportRunIdSchema.safeParse(c.req.param('id'));
    if (!reportRunId.success) return c.json({ error: 'invalid_report_run_id' }, 400);
    try {
      const run = await getRun(session.tenant_id, reportRunId.data);
      return c.json(toReportStatusResponse(run));
    } catch (error) {
      return reportError(c, error);
    }
  });

  app.post('/api/pmo/v1/reports/:id/retry', async (c) => {
    const session = c.get('user');
    if (!can(session, 'pmo.data.read')) return forbidden(c);
    const parsedId = ReportRunIdSchema.safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'invalid_report_run_id' }, 400);
    try {
      const reportRunId = parsedId.data;
      const run = await getRun(session.tenant_id, reportRunId);
      if (run.status !== 'failed') {
        return c.json({ error: 'report_retry_not_allowed', status: run.status }, 409);
      }
      await retry(session.tenant_id, reportRunId);
      await enqueue(
        deps.workers,
        session.tenant_id,
        reportRunId,
        run.envelope.request.outputFormat,
      );
      const queued = await getRun(session.tenant_id, reportRunId);
      return c.json(toReportStatusResponse(queued), 202);
    } catch (error) {
      return reportError(c, error);
    }
  });

  app.get('/api/pmo/v1/reports/:id/download', async (c) => {
    const session = c.get('user');
    if (!can(session, 'pmo.data.read')) return forbidden(c);
    const query = DownloadQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'invalid_download_format' }, 400);
    const reportRunId = ReportRunIdSchema.safeParse(c.req.param('id'));
    if (!reportRunId.success) return c.json({ error: 'invalid_report_run_id' }, 400);
    try {
      const run = await getRun(session.tenant_id, reportRunId.data);
      if (run.status !== 'completed') {
        return c.json({ error: 'report_not_completed', status: run.status }, 409);
      }
      const artifact = readArtifact(run, query.data.format);
      if (!artifact) return c.json({ error: 'report_artifact_unavailable' }, 409);
      const filename = reportDownloadFilename(run, query.data.format);
      const bucket = deps.bucket ?? process.env.PMO_REPORT_S3_BUCKET ?? process.env.S3_BUCKET;
      if (!bucket) throw new Error('pmo_report_s3_bucket_required');
      const url = await presign({
        bucket,
        key: artifact.s3Key,
        expiresInSeconds: 5 * 60,
        responseContentDisposition: `attachment; filename="${filename}"`,
        responseContentType:
          query.data.format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
      });
      return c.redirect(url, 302);
    } catch (error) {
      return reportError(c, error);
    }
  });
}

export function toReportStatusResponse(run: ReportRunRecord): ReportStatusResponse {
  const report = run.report;
  const findingCounts =
    report && report.reportFamily === 'workload'
      ? {
          red: report.findings.filter((finding) => finding.ragColor === 'red').length,
          yellow: report.findings.filter((finding) => finding.ragColor === 'yellow').length,
          idle: report.summary.idleCount,
          overbook: report.summary.overbookCount,
          mismatch: report.findings.filter((finding) => finding.issueType.startsWith('mismatch_'))
            .length,
        }
      : null;
  const html = readArtifact(run, 'html');
  const pdf = readArtifact(run, 'pdf');
  return {
    reportRunId: run.id,
    status: run.status,
    reportFamily: run.envelope.request.reportFamily,
    dateRange: run.envelope.request.dateRange,
    outputFormat: run.envelope.request.outputFormat,
    summary: report?.summary ?? null,
    findingCounts,
    artifacts: {
      html: {
        available: Boolean(html),
        sizeBytes: html?.sizeBytes ?? null,
        sha256: html?.sha256 ?? null,
        downloadUrl: html ? `/api/pmo/v1/reports/${run.id}/download?format=html` : null,
      },
      pdf: {
        available: Boolean(pdf),
        sizeBytes: pdf?.sizeBytes ?? null,
        sha256: pdf?.sha256 ?? null,
        downloadUrl: pdf ? `/api/pmo/v1/reports/${run.id}/download?format=pdf` : null,
      },
    },
    failure:
      run.status === 'failed' ? { code: run.failureCode, message: run.failureMessage } : null,
    retryAllowed: run.status === 'failed',
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function readArtifact(run: ReportRunRecord, format: 'html' | 'pdf') {
  const artifact =
    format === 'html'
      ? { s3Key: run.htmlS3Key, sha256: run.htmlSha256, sizeBytes: run.htmlSizeBytes }
      : { s3Key: run.pdfS3Key, sha256: run.pdfSha256, sizeBytes: run.pdfSizeBytes };
  if (!artifact.s3Key || !artifact.sha256 || !artifact.sizeBytes) return null;
  return artifact as { s3Key: string; sha256: string; sizeBytes: number };
}

export function reportDownloadFilename(run: ReportRunRecord, format: 'html' | 'pdf'): string {
  const { from, to } = run.envelope.request.dateRange;
  return `pmo-workload-report-${from}-to-${to}.${format}`;
}

function forbidden(c: Context<SessionEnv>) {
  return c.json({ error: 'FORBIDDEN', message: 'Missing permission: pmo.data.read' }, 403);
}

function reportError(c: Context<SessionEnv>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'report_run_not_found') {
    return c.json({ error: 'not_found', message: 'report run not found' }, 404);
  }
  if (
    message.startsWith('invalid_report_') ||
    message.startsWith('forward_allocation_') ||
    message.startsWith('report_date_range_') ||
    message.startsWith('report_canonical_date_bounds_') ||
    message.startsWith('recommendation_candidate_count_')
  ) {
    return c.json({ error: 'invalid_request', message }, 400);
  }
  return c.json({ error: 'report_request_failed', message: 'Report request failed' }, 500);
}
