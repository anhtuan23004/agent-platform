import { resetCoreDb } from '@seta/core/testing';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import type { GeneratePmoReportOutput } from '../../src/backend/analytics/report.ts';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import type { ReportRunEnvelope } from '../../src/backend/reporting/contracts.ts';
import {
  completeReportRun,
  failReportRun,
  insertQueuedReportRun,
  retryReportRun,
  setReportRunComputing,
} from '../../src/backend/reporting/report-repository.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

const envelope: ReportRunEnvelope = {
  request: {
    sourceMode: 'canonical_db',
    dateRange: { from: '2026-06-29', to: '2026-07-05' },
    reportTypes: ['overbook', 'idle'],
    outputFormat: 'json',
  },
  ruleSnapshot: {
    ruleSetId: 'SETA-08-SOP-001',
    version: '2026-01-01',
    sha256: 'a'.repeat(64),
    rules: { recommendation: { enabled: true } },
  },
};

function report(): GeneratePmoReportOutput {
  return {
    dateRange: envelope.request.dateRange,
    sourceVersion: {
      factsVersion: 'facts-v1',
      canonicalDataVersion: 'canonical-v1',
      factsComputedAt: '2026-07-05T12:00:00.000Z',
    },
    summary: { memberCount: 2, overbookCount: 1, idleCount: 1, excludedWeekCount: 0 },
    members: [],
    projectionFreshness: {
      skillsCount: 0,
      taskHistoryCount: 0,
      lastSyncedAt: null,
      degraded: true,
    },
    dataQuality: { recommendationDegraded: true, flags: ['candidate_data_unavailable'] },
    findings: [],
    recommendations: [],
  };
}

describe('report run repository durability', () => {
  it('uses CAS transitions and emits sanitized transactional events', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetCoreDb();
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const tenantId = crypto.randomUUID();
        const actorId = crypto.randomUUID();
        const reportRunId = await insertQueuedReportRun({
          tenantId,
          actorId,
          ingestionSessionId: null,
          reportTypes: ['overbook', 'idle'],
          dateRange: {
            from: new Date('2026-06-29T00:00:00.000Z'),
            to: new Date('2026-07-05T00:00:00.000Z'),
          },
          envelope,
        });

        const requested = await pool.query(
          `SELECT payload FROM core.events
           WHERE aggregate_id = $1 AND event_type = 'pmo.report.requested'`,
          [reportRunId],
        );
        expect(requested.rows[0]?.payload).toEqual({
          report_run_id: reportRunId,
          status: 'queued',
          source_mode: 'canonical_db',
          rule_sha256: 'a'.repeat(64),
        });

        await setReportRunComputing(tenantId, reportRunId);
        await completeReportRun({ tenantId, reportRunId, report: report(), envelope });
        expect(await retryReportRun(tenantId, reportRunId)).toBe(false);
        await expect(setReportRunComputing(tenantId, reportRunId)).rejects.toThrow(
          'report_run_transition_conflict:computing',
        );

        const completed = await pool.query(
          `SELECT status, facts_version, canonical_data_version, completed_at
           FROM pmo.report_runs WHERE id = $1`,
          [reportRunId],
        );
        expect(completed.rows[0]).toMatchObject({
          status: 'completed',
          facts_version: 'facts-v1',
          canonical_data_version: 'canonical-v1',
        });
        expect(completed.rows[0]?.completed_at).not.toBeNull();

        const failedRunId = await insertQueuedReportRun({
          tenantId,
          actorId,
          ingestionSessionId: null,
          reportTypes: ['overbook'],
          dateRange: {
            from: new Date('2026-06-29T00:00:00.000Z'),
            to: new Date('2026-07-05T00:00:00.000Z'),
          },
          envelope,
        });
        await setReportRunComputing(tenantId, failedRunId);
        await failReportRun(tenantId, failedRunId, {
          code: 'PDF Render Failed!',
          message: 'private\nstack\tmessage',
        });
        const failed = await pool.query(
          `SELECT status, failure_code, failure_message FROM pmo.report_runs WHERE id = $1`,
          [failedRunId],
        );
        expect(failed.rows[0]).toEqual({
          status: 'failed',
          failure_code: 'pdf_render_failed_',
          failure_message: 'private stack message',
        });
        expect(await retryReportRun(tenantId, failedRunId)).toBe(true);
      } finally {
        resetCoreDb();
        resetPmoDb();
        await closePools();
      }
    });
  });
});
