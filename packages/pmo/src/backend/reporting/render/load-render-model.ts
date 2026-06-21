import { and, eq, inArray } from 'drizzle-orm';
import type { GeneratePmoReportOutput } from '../../analytics/report.ts';
import { pmoDb } from '../../db/client.ts';
import { reportRuns } from '../../db/schema.ts';
import type { ReportRunEnvelope, ReportSourceMode } from '../contracts.ts';
import type { PmoReportRenderModel } from './contracts.ts';

export async function loadReportRenderModel(input: {
  tenantId: string;
  reportRunId: string;
  tenantName: string;
}): Promise<PmoReportRenderModel> {
  const rows = await pmoDb()
    .select()
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.tenant_id, input.tenantId),
        eq(reportRuns.id, input.reportRunId),
        inArray(reportRuns.status, ['rendering', 'completed']),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('report_render_source_not_found');
  const payload = row.result_payload as ReportRunEnvelope & { report?: GeneratePmoReportOutput };
  if (!payload.report) throw new Error('report_render_payload_unavailable');
  if (!row.rule_set_id || !row.rule_version || !row.rule_sha256) {
    throw new Error('report_render_rule_snapshot_unavailable');
  }
  return {
    reportRunId: row.id,
    tenantName: input.tenantName,
    generatedAt: (row.completed_at ?? row.updated_at).toISOString(),
    sourceMode: row.source_mode as ReportSourceMode,
    rule: {
      ruleSetId: row.rule_set_id,
      version: row.rule_version,
      sha256: row.rule_sha256,
    },
    report: payload.report,
  };
}
