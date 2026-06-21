import pino from 'pino';
import { computeReportPayload } from '../generate-report.ts';
import { loadReportRenderModel } from '../render/load-render-model.ts';
import { renderReportHtml } from '../render/render-report-html.ts';
import { renderReportPdf } from '../render/render-report-pdf.ts';
import { uploadPrivateReportArtifact } from '../render/report-artifact-store.ts';
import {
  completeReportRun,
  failReportRun,
  getReportRun,
  saveReportArtifacts,
} from '../report-repository.ts';

const log = pino({ name: 'pmo/report-pdf' });

interface RenderPdfPayload {
  reportRunId: string;
  tenantId: string;
}

interface RenderJobHelpers {
  job?: { attempts?: number; max_attempts?: number };
}

export interface RenderPdfJobDeps {
  getRun: typeof getReportRun;
  compute: typeof computeReportPayload;
  loadModel: typeof loadReportRenderModel;
  renderHtml: typeof renderReportHtml;
  renderPdf: typeof renderReportPdf;
  upload: typeof uploadPrivateReportArtifact;
  saveArtifacts: typeof saveReportArtifacts;
  complete: typeof completeReportRun;
  fail: typeof failReportRun;
}

const DEFAULT_DEPS: RenderPdfJobDeps = {
  getRun: getReportRun,
  compute: computeReportPayload,
  loadModel: loadReportRenderModel,
  renderHtml: renderReportHtml,
  renderPdf: renderReportPdf,
  upload: uploadPrivateReportArtifact,
  saveArtifacts: saveReportArtifacts,
  complete: completeReportRun,
  fail: failReportRun,
};

export async function renderPdfReportJob(
  rawPayload: unknown,
  helpers: RenderJobHelpers = {},
  deps: RenderPdfJobDeps = DEFAULT_DEPS,
): Promise<void> {
  const payload = parsePayload(rawPayload);
  const ctx = { reportRunId: payload.reportRunId, tenantId: payload.tenantId };
  const startMs = Date.now();
  log.info(ctx, 'render-pdf job started');
  try {
    let run = await deps.getRun(payload.tenantId, payload.reportRunId);
    if (hasCompleteArtifacts(run)) {
      log.info(ctx, 'render-pdf job skipped: already completed with artifacts');
      return;
    }

    if (run.status === 'queued' || run.status === 'computing') {
      log.info({ ...ctx, status: run.status }, 'render-pdf computing payload');
      await deps.compute({ tenantId: payload.tenantId, reportRunId: payload.reportRunId });
      run = await deps.getRun(payload.tenantId, payload.reportRunId);
    }

    if (run.envelope.request.outputFormat !== 'pdf') return;
    if (run.status !== 'rendering' || !run.report) {
      throw new Error(`report_run_not_renderable:${run.status}`);
    }
    if (hasPersistedArtifacts(run)) {
      log.info(ctx, 'render-pdf completing from persisted artifacts');
      await deps.complete({
        tenantId: payload.tenantId,
        reportRunId: payload.reportRunId,
        report: run.report,
        envelope: run.envelope,
      });
      return;
    }

    const model = await deps.loadModel({
      tenantId: payload.tenantId,
      reportRunId: payload.reportRunId,
      tenantName: payload.tenantId,
    });
    const html = deps.renderHtml(model);
    log.info({ ...ctx, htmlSizeBytes: html.sizeBytes }, 'render-pdf HTML rendered');
    const pdf = await deps.renderPdf(html.html);
    log.info(
      { ...ctx, pdfSizeBytes: pdf.bytes.byteLength, pageCount: pdf.pageCount },
      'render-pdf PDF rendered via Chromium',
    );
    const [htmlArtifact, pdfArtifact] = await Promise.all([
      deps.upload({
        tenantId: payload.tenantId,
        reportRunId: payload.reportRunId,
        filename: 'report.html',
        contentType: 'text/html; charset=utf-8',
        bytes: Buffer.from(html.html, 'utf8'),
      }),
      deps.upload({
        tenantId: payload.tenantId,
        reportRunId: payload.reportRunId,
        filename: 'report.pdf',
        contentType: 'application/pdf',
        bytes: pdf.bytes,
      }),
    ]);
    if (htmlArtifact.sha256 !== html.sha256) throw new Error('report_html_checksum_mismatch');
    await deps.saveArtifacts(payload.tenantId, payload.reportRunId, {
      html: htmlArtifact,
      pdf: { ...pdfArtifact, pageCount: pdf.pageCount },
    });
    await deps.complete({
      tenantId: payload.tenantId,
      reportRunId: payload.reportRunId,
      report: run.report,
      envelope: run.envelope,
    });
    log.info({ ...ctx, durationMs: Date.now() - startMs }, 'render-pdf job completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { ...ctx, durationMs: Date.now() - startMs, error: message },
      'render-pdf job failed',
    );
    if (isFinalAttempt(helpers)) {
      const run = await deps.getRun(payload.tenantId, payload.reportRunId).catch(() => null);
      if (run?.status === 'computing' || run?.status === 'rendering') {
        await deps.fail(payload.tenantId, payload.reportRunId, {
          code: message.split(':', 1)[0] || 'report_pdf_render_failed',
          message,
        });
      }
    }
    throw error;
  }
}

function parsePayload(raw: unknown): RenderPdfPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid_pmo_report_render_pdf_payload');
  }
  const payload = raw as Partial<RenderPdfPayload>;
  if (!payload.tenantId || !payload.reportRunId) {
    throw new Error('invalid_pmo_report_render_pdf_payload');
  }
  return { tenantId: payload.tenantId, reportRunId: payload.reportRunId };
}

function hasCompleteArtifacts(run: Awaited<ReturnType<typeof getReportRun>>): boolean {
  return run.status === 'completed' && hasPersistedArtifacts(run);
}

function hasPersistedArtifacts(run: Awaited<ReturnType<typeof getReportRun>>): boolean {
  return Boolean(
    run.htmlS3Key &&
      run.htmlSha256 &&
      run.htmlSizeBytes &&
      run.pdfS3Key &&
      run.pdfSha256 &&
      run.pdfSizeBytes,
  );
}

function isFinalAttempt(helpers: RenderJobHelpers): boolean {
  const attempts = helpers.job?.attempts;
  const maxAttempts = helpers.job?.max_attempts;
  return attempts !== undefined && maxAttempts !== undefined && attempts >= maxAttempts;
}
