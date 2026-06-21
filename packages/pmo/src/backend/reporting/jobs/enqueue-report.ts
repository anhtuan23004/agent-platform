import type { WorkerHandle } from '@seta/core';
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
