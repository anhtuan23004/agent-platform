import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratePmoReportOutput } from '../../../src/backend/analytics/report.ts';
import type { ReportRunEnvelope } from '../../../src/backend/reporting/contracts.ts';
import {
  type RenderPdfJobDeps,
  renderPdfReportJob,
} from '../../../src/backend/reporting/jobs/render-pdf.ts';
import type { ReportRunRecord } from '../../../src/backend/reporting/report-repository.ts';

const envelope: ReportRunEnvelope = {
  request: {
    sourceMode: 'canonical_db',
    dateRange: { from: '2026-06-29', to: '2026-08-07' },
    reportTypes: ['overbook', 'idle'],
    outputFormat: 'pdf',
  },
  ruleSnapshot: {
    ruleSetId: 'SETA-08-SOP-001',
    version: '2026-01-01',
    sha256: 'a'.repeat(64),
    rules: {},
  },
};

const report: GeneratePmoReportOutput = {
  dateRange: envelope.request.dateRange,
  sourceVersion: {
    factsVersion: 'facts-v1',
    canonicalDataVersion: 'canonical-v1',
    factsComputedAt: '2026-08-07T12:00:00.000Z',
  },
  summary: { memberCount: 0, idleCount: 0, overbookCount: 0, excludedWeekCount: 0 },
  members: [],
  findings: [],
  recommendations: [],
};

function run(status: ReportRunRecord['status']): ReportRunRecord {
  return {
    id: 'run-1',
    tenantId: 'tenant-1',
    ingestionSessionId: null,
    status,
    envelope,
    report: status === 'queued' || status === 'computing' ? null : report,
    htmlS3Key: null,
    htmlSha256: null,
    htmlSizeBytes: null,
    pdfS3Key: null,
    pdfSha256: null,
    pdfSizeBytes: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date('2026-06-21T00:00:00.000Z'),
    updatedAt: new Date('2026-06-21T00:00:00.000Z'),
    completedAt: status === 'completed' ? new Date('2026-06-21T00:01:00.000Z') : null,
  };
}

function deps(overrides: Partial<RenderPdfJobDeps> = {}): RenderPdfJobDeps {
  const html = '<!doctype html><title>PMO</title>';
  return {
    getRun: vi.fn(async () => run('rendering')),
    compute: vi.fn(async () => report),
    loadModel: vi.fn(async () => ({
      reportRunId: 'run-1',
      tenantName: 'tenant-1',
      generatedAt: '2026-08-07T12:00:00.000Z',
      sourceMode: 'canonical_db' as const,
      rule: envelope.ruleSnapshot,
      report,
    })),
    renderHtml: vi.fn(() => ({
      html,
      sha256: createHash('sha256').update(html).digest('hex'),
      sizeBytes: Buffer.byteLength(html),
    })),
    renderPdf: vi.fn(async () => ({
      bytes: Buffer.from('%PDF-1.7\nfixture'),
      sizeBytes: 16,
      pageCount: 1,
    })),
    upload: vi.fn(async (input) => ({
      s3Key: `tenants/${input.tenantId}/pmo/reports/${input.reportRunId}/${input.filename}`,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      sizeBytes: input.bytes.byteLength,
    })),
    saveArtifacts: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('PMO PDF worker', () => {
  it('resumes compute, uploads both artifacts, persists, then completes', async () => {
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(run('queued'))
      .mockResolvedValueOnce(run('rendering'));
    const subject = deps({ getRun });
    await renderPdfReportJob({ reportRunId: 'run-1', tenantId: 'tenant-1' }, {}, subject);

    expect(subject.compute).toHaveBeenCalledWith({ tenantId: 'tenant-1', reportRunId: 'run-1' });
    expect(subject.upload).toHaveBeenCalledTimes(2);
    expect(subject.saveArtifacts).toHaveBeenCalledBefore(
      subject.complete as ReturnType<typeof vi.fn>,
    );
    expect(subject.complete).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', reportRunId: 'run-1', report }),
    );
  });

  it('no-ops when completed artifacts and checksums already exist', async () => {
    const completed = {
      ...run('completed'),
      htmlS3Key: 'html',
      htmlSha256: 'a'.repeat(64),
      htmlSizeBytes: 10,
      pdfS3Key: 'pdf',
      pdfSha256: 'b'.repeat(64),
      pdfSizeBytes: 10,
    };
    const subject = deps({ getRun: vi.fn(async () => completed) });
    await renderPdfReportJob({ reportRunId: 'run-1', tenantId: 'tenant-1' }, {}, subject);
    expect(subject.renderPdf).not.toHaveBeenCalled();
    expect(subject.upload).not.toHaveBeenCalled();
  });

  it('finalizes persisted artifacts after a retry without rerendering', async () => {
    const rendering = {
      ...run('rendering'),
      htmlS3Key: 'html',
      htmlSha256: 'a'.repeat(64),
      htmlSizeBytes: 10,
      pdfS3Key: 'pdf',
      pdfSha256: 'b'.repeat(64),
      pdfSizeBytes: 10,
    };
    const subject = deps({ getRun: vi.fn(async () => rendering) });
    await renderPdfReportJob({ reportRunId: 'run-1', tenantId: 'tenant-1' }, {}, subject);
    expect(subject.renderPdf).not.toHaveBeenCalled();
    expect(subject.upload).not.toHaveBeenCalled();
    expect(subject.complete).toHaveBeenCalledOnce();
  });

  it('keeps rendering state for transient retry and marks failed only on last attempt', async () => {
    const failure = new Error('chromium_crashed');
    const transient = deps({ renderPdf: vi.fn(async () => Promise.reject(failure)) });
    await expect(
      renderPdfReportJob(
        { reportRunId: 'run-1', tenantId: 'tenant-1' },
        { job: { attempts: 1, max_attempts: 5 } },
        transient,
      ),
    ).rejects.toThrow('chromium_crashed');
    expect(transient.fail).not.toHaveBeenCalled();

    const final = deps({ renderPdf: vi.fn(async () => Promise.reject(failure)) });
    await expect(
      renderPdfReportJob(
        { reportRunId: 'run-1', tenantId: 'tenant-1' },
        { job: { attempts: 5, max_attempts: 5 } },
        final,
      ),
    ).rejects.toThrow('chromium_crashed');
    expect(final.fail).toHaveBeenCalledWith(
      'tenant-1',
      'run-1',
      expect.objectContaining({ code: 'chromium_crashed' }),
    );
  });
});
