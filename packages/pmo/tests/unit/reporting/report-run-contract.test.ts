import { describe, expect, it, vi } from 'vitest';
import { enqueueReportRun } from '../../../src/backend/reporting/jobs/enqueue-report.ts';
import {
  reportJobKey,
  sanitizeFailureCode,
  sanitizeFailureMessage,
} from '../../../src/backend/reporting/report-repository.ts';
import { PMO_EVENTS } from '../../../src/events.ts';

describe('report run durability contract', () => {
  it('uses one deterministic graphile job key per explicit run', async () => {
    const addJob = vi.fn(async () => undefined);
    await enqueueReportRun({ addJob, shutdown: async () => undefined }, 'tenant-123', 'run-123');
    expect(reportJobKey('run-123')).toBe('pmo-report:run-123');
    expect(addJob).toHaveBeenCalledWith(
      'pmo.report.render_pdf',
      { reportRunId: 'run-123', tenantId: 'tenant-123' },
      { jobKey: 'pmo-report:run-123', maxAttempts: 5, queueName: 'pmo-report-pdf' },
    );
  });

  it('sanitizes persisted failures', () => {
    expect(sanitizeFailureCode('PDF Render: Failed!')).toBe('pdf_render__failed_');
    expect(sanitizeFailureMessage('secret\n\t details   here')).toBe('secret details here');
    expect(sanitizeFailureMessage('x'.repeat(600))).toHaveLength(500);
  });

  it('report event schemas contain IDs, counts, hashes, and status only', () => {
    expect(
      PMO_EVENTS['pmo.report.requested'].parse({
        report_run_id: '44444444-4444-4444-8444-444444444444',
        status: 'queued',
        source_mode: 'canonical_db',
        rule_sha256: 'a'.repeat(64),
      }),
    ).toEqual({
      report_run_id: '44444444-4444-4444-8444-444444444444',
      status: 'queued',
      source_mode: 'canonical_db',
      rule_sha256: 'a'.repeat(64),
    });
  });
});
