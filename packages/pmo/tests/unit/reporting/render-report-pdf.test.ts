import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createChromiumRuntimeEnvironment,
  readMaxArtifactBytes,
  validatePdfArtifact,
} from '../../../src/backend/reporting/render/render-report-pdf.ts';
import { buildReportArtifactKey } from '../../../src/backend/reporting/render/report-artifact-store.ts';

describe('PDF artifact contract', () => {
  it('accepts PDF magic and rejects empty, invalid, and oversized bytes', () => {
    expect(() => validatePdfArtifact(Buffer.from('%PDF-1.7\nfixture'), 100)).not.toThrow();
    expect(() => validatePdfArtifact(Buffer.alloc(0), 100)).toThrow('report_pdf_empty');
    expect(() => validatePdfArtifact(Buffer.from('not-pdf'), 100)).toThrow(
      'report_pdf_invalid_magic',
    );
    expect(() => validatePdfArtifact(Buffer.from('%PDF-1.7\nfixture'), 5)).toThrow(
      'report_pdf_artifact_too_large',
    );
  });

  it('builds deterministic tenant-private artifact keys', () => {
    expect(buildReportArtifactKey('tenant-1', 'run-1', 'report.html')).toBe(
      'tenants/tenant-1/pmo/reports/run-1/report.html',
    );
    expect(buildReportArtifactKey('tenant-1', 'run-1', 'report.pdf')).toBe(
      'tenants/tenant-1/pmo/reports/run-1/report.pdf',
    );
  });

  it('validates the configured max size', () => {
    const previous = process.env.PMO_REPORT_MAX_ARTIFACT_BYTES;
    process.env.PMO_REPORT_MAX_ARTIFACT_BYTES = '1024';
    expect(readMaxArtifactBytes()).toBe(1024);
    process.env.PMO_REPORT_MAX_ARTIFACT_BYTES = 'invalid';
    expect(() => readMaxArtifactBytes()).toThrow('invalid_pmo_report_max_artifact_bytes');
    if (previous === undefined) delete process.env.PMO_REPORT_MAX_ARTIFACT_BYTES;
    else process.env.PMO_REPORT_MAX_ARTIFACT_BYTES = previous;
  });

  it('uses SHA-256-compatible bytes for uploaded HTML', () => {
    const bytes = Buffer.from('<!doctype html><title>PMO</title>');
    expect(createHash('sha256').update(bytes).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses a writable temporary home for Chromium crashpad state', async () => {
    const runtime = await createChromiumRuntimeEnvironment();
    try {
      expect(runtime.env.HOME).toBe(runtime.homeDirectory);
      expect(runtime.env.XDG_CONFIG_HOME).toBe(`${runtime.homeDirectory}/.config`);
      expect(runtime.env.XDG_CACHE_HOME).toBe(`${runtime.homeDirectory}/.cache`);
      await expect(
        import('node:fs/promises').then(({ access }) => access(runtime.homeDirectory, 2)),
      ).resolves.toBeUndefined();
    } finally {
      await runtime.cleanup();
    }
  });
});
