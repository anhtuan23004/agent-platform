import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderReportPdf } from '../../src/backend/reporting/render/render-report-pdf.ts';

const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

describe.skipIf(!existsSync(executablePath))('PMO Chromium PDF runtime', () => {
  it('renders a valid A4 PDF from standalone HTML with network disabled', async () => {
    const result = await renderReportPdf(
      '<!doctype html><html><body><h1>PMO report</h1><p>offline fixture</p></body></html>',
      { executablePath, maxArtifactBytes: 2 * 1024 * 1024 },
    );
    expect(result.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(result.sizeBytes).toBeGreaterThan(100);
  });
});
