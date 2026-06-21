import { runPlanGenerationJob } from '../../planning/jobs/generate-plan.ts';
import { computeReportPayload } from '../generate-report.ts';
import { renderPdfReportJob } from './render-pdf.ts';

interface ComputeReportPayload {
  tenant_id: string;
  report_run_id: string;
}

export const pmoReportJobs = {
  'pmo.plan.generate': async (rawPayload: unknown) => {
    await runPlanGenerationJob(rawPayload);
  },
  'pmo.report.compute': async (rawPayload: unknown) => {
    const payload = rawPayload as ComputeReportPayload;
    if (!payload.tenant_id || !payload.report_run_id) {
      throw new Error('invalid_pmo_report_compute_payload');
    }
    await computeReportPayload({
      tenantId: payload.tenant_id,
      reportRunId: payload.report_run_id,
    });
  },
  'pmo.report.render_pdf': renderPdfReportJob,
} as const;
