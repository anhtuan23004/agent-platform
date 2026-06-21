import type { WorkerHandle } from '@seta/core';
import { getPool } from '@seta/shared-db';
import type { Pool } from 'pg';
import type { ReportOutputFormat } from '../contracts.ts';
import { reportJobKey } from '../report-repository.ts';

export async function enqueueReportRun(
  workers: WorkerHandle,
  tenantId: string,
  reportRunId: string,
  outputFormat: ReportOutputFormat = 'pdf',
): Promise<void> {
  const task = outputFormat === 'pdf' ? 'pmo.report.render_pdf' : 'pmo.report.compute';
  await workers.addJob(
    task,
    outputFormat === 'pdf'
      ? { reportRunId, tenantId }
      : { tenant_id: tenantId, report_run_id: reportRunId },
    {
      jobKey: reportJobKey(reportRunId),
      maxAttempts: 5,
      queueName: outputFormat === 'pdf' ? 'pmo-report-pdf' : 'pmo-report',
    },
  );
}

/** Enqueue from workflow code where a composition-layer WorkerHandle is unavailable. */
export async function enqueueReportRunFromPool(
  tenantId: string,
  reportRunId: string,
  outputFormat: ReportOutputFormat = 'pdf',
  pool: Pick<Pool, 'query'> = getPool('web'),
): Promise<void> {
  const task = outputFormat === 'pdf' ? 'pmo.report.render_pdf' : 'pmo.report.compute';
  const payload =
    outputFormat === 'pdf'
      ? { reportRunId, tenantId }
      : { tenant_id: tenantId, report_run_id: reportRunId };
  await pool.query(
    `SELECT graphile_worker.add_job(
       identifier => $1,
       payload => $2::json,
       queue_name => $3,
       max_attempts => $4,
       job_key => $5
     )`,
    [
      task,
      JSON.stringify(payload),
      outputFormat === 'pdf' ? 'pmo-report-pdf' : 'pmo-report',
      5,
      reportJobKey(reportRunId),
    ],
  );
}
