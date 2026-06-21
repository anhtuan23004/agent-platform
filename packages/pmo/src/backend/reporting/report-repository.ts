import { emit, withEmit } from '@seta/core/events';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { GeneratePmoReportOutput } from '../analytics/report.ts';
import { pmoDb } from '../db/client.ts';
import { reportRuns } from '../db/schema.ts';
import type { ReportRunEnvelope } from './contracts.ts';

export type ReportRunStatus = 'queued' | 'computing' | 'rendering' | 'completed' | 'failed';

export interface ReportRunRecord {
  id: string;
  tenantId: string;
  ingestionSessionId: string | null;
  status: ReportRunStatus;
  envelope: ReportRunEnvelope;
  report: GeneratePmoReportOutput | null;
  htmlS3Key: string | null;
  htmlSha256: string | null;
  htmlSizeBytes: number | null;
  pdfS3Key: string | null;
  pdfSha256: string | null;
  pdfSizeBytes: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export async function insertQueuedReportRun(input: {
  tenantId: string;
  actorId: string;
  ingestionSessionId: string | null;
  reportTypes: string[];
  dateRange: { from: Date; to: Date };
  envelope: ReportRunEnvelope;
}): Promise<string> {
  let reportRunId: string | null = null;
  await withEmit({ actor: { userId: input.actorId, tenantId: input.tenantId } }, async (tx) => {
    const [row] = await tx
      .insert(reportRuns)
      .values({
        tenant_id: input.tenantId,
        ingestion_session_id: input.ingestionSessionId,
        source_mode: input.envelope.request.sourceMode,
        granularity: 'member_week',
        filters: {},
        report_types: input.reportTypes,
        date_range_start: input.dateRange.from,
        date_range_end: input.dateRange.to,
        status: 'queued',
        rule_set_id: input.envelope.ruleSnapshot.ruleSetId,
        rule_version: input.envelope.ruleSnapshot.version,
        rule_sha256: input.envelope.ruleSnapshot.sha256,
        rule_snapshot: input.envelope.ruleSnapshot.rules,
        recommendation_config_snapshot: readRecommendationConfig(input.envelope),
        result_payload: input.envelope,
        created_by: input.actorId,
      })
      .returning({ id: reportRuns.id });
    if (!row) throw new Error('report_run_insert_failed');
    reportRunId = row.id;
    await emit({
      tenantId: input.tenantId,
      aggregateType: 'pmo.report_run',
      aggregateId: row.id,
      eventType: 'pmo.report.requested',
      eventVersion: 1,
      causedByUserId: input.actorId,
      payload: {
        report_run_id: row.id,
        status: 'queued',
        source_mode: input.envelope.request.sourceMode,
        rule_sha256: input.envelope.ruleSnapshot.sha256,
      },
    });
  });
  if (!reportRunId) throw new Error('report_run_insert_failed');
  return reportRunId;
}

export async function getReportRun(
  tenantId: string,
  reportRunId: string,
): Promise<ReportRunRecord> {
  const rows = await pmoDb()
    .select()
    .from(reportRuns)
    .where(and(eq(reportRuns.tenant_id, tenantId), eq(reportRuns.id, reportRunId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('report_run_not_found');
  const payload = row.result_payload as
    | ReportRunEnvelope
    | (ReportRunEnvelope & { report: GeneratePmoReportOutput });
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ingestionSessionId: row.ingestion_session_id,
    status: row.status as ReportRunStatus,
    envelope: { request: payload.request, ruleSnapshot: payload.ruleSnapshot },
    report: 'report' in payload ? (payload.report ?? null) : null,
    htmlS3Key: row.html_s3_key,
    htmlSha256: row.html_sha256,
    htmlSizeBytes: row.html_size_bytes,
    pdfS3Key: row.pdf_s3_key,
    pdfSha256: row.pdf_sha256,
    pdfSizeBytes: row.pdf_size_bytes,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function setReportRunComputing(tenantId: string, reportRunId: string): Promise<void> {
  await requireCasTransition({
    tenantId,
    reportRunId,
    from: ['queued'],
    to: 'computing',
    values: { started_at: new Date(), failure_code: null, failure_message: null },
  });
}

export async function setReportRunRendering(tenantId: string, reportRunId: string): Promise<void> {
  await requireCasTransition({
    tenantId,
    reportRunId,
    from: ['computing'],
    to: 'rendering',
  });
}

export async function saveComputedReportRun(input: {
  tenantId: string;
  reportRunId: string;
  report: GeneratePmoReportOutput;
  envelope: ReportRunEnvelope;
}): Promise<void> {
  const now = new Date();
  const embedding = readEmbeddingVersions(input.report);
  const rows = await pmoDb()
    .update(reportRuns)
    .set({
      status: 'rendering',
      result_summary: input.report.summary,
      result_payload: { ...input.envelope, report: input.report },
      facts_computed_at: new Date(input.report.sourceVersion.factsComputedAt),
      facts_version: input.report.sourceVersion.factsVersion,
      canonical_data_version: input.report.sourceVersion.canonicalDataVersion,
      embedding_model_id: embedding.modelIds.join(',') || null,
      embedding_source_version: embedding.sourceVersions.join(',') || null,
      failure_code: null,
      failure_message: null,
      updated_at: now,
    })
    .where(
      and(
        eq(reportRuns.tenant_id, input.tenantId),
        eq(reportRuns.id, input.reportRunId),
        eq(reportRuns.status, 'computing'),
      ),
    )
    .returning({ id: reportRuns.id });
  if (!rows[0]) throw new Error('report_run_transition_conflict:rendering');
}

export async function retryReportRun(tenantId: string, reportRunId: string): Promise<boolean> {
  const run = await getReportRun(tenantId, reportRunId);
  if (run.status === 'completed') return false;
  if (run.status === 'queued') return true;
  await requireCasTransition({
    tenantId,
    reportRunId,
    from: ['failed', 'rendering'],
    to: 'queued',
    values: {
      failure_code: null,
      failure_message: null,
      started_at: null,
      completed_at: null,
    },
  });
  return true;
}

export interface ReportArtifactUpdate {
  html?: { s3Key: string; sha256: string; sizeBytes: number };
  pdf?: { s3Key: string; sha256: string; sizeBytes: number; pageCount?: number };
}

export async function saveReportArtifacts(
  tenantId: string,
  reportRunId: string,
  artifacts: ReportArtifactUpdate,
): Promise<boolean> {
  const run = await getReportRun(tenantId, reportRunId);
  assertArtifactIdentity(run, artifacts);
  if (run.status === 'completed') return false;
  if (run.status !== 'rendering') throw new Error(`report_run_not_rendering:${run.status}`);
  const rows = await pmoDb()
    .update(reportRuns)
    .set({
      ...(artifacts.html
        ? {
            html_s3_key: artifacts.html.s3Key,
            html_sha256: artifacts.html.sha256,
            html_size_bytes: artifacts.html.sizeBytes,
          }
        : {}),
      ...(artifacts.pdf
        ? {
            pdf_s3_key: artifacts.pdf.s3Key,
            pdf_sha256: artifacts.pdf.sha256,
            pdf_size_bytes: artifacts.pdf.sizeBytes,
            pdf_page_count: artifacts.pdf.pageCount ?? null,
          }
        : {}),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(reportRuns.tenant_id, tenantId),
        eq(reportRuns.id, reportRunId),
        eq(reportRuns.status, 'rendering'),
      ),
    )
    .returning({ id: reportRuns.id });
  if (!rows[0]) throw new Error('report_run_transition_conflict:artifacts');
  return true;
}

export async function completeReportRun(input: {
  tenantId: string;
  reportRunId: string;
  report: GeneratePmoReportOutput;
  envelope: ReportRunEnvelope;
}): Promise<void> {
  await withEmit({ actor: { userId: 'system', tenantId: input.tenantId } }, async (tx) => {
    const now = new Date();
    const embedding = readEmbeddingVersions(input.report);
    const rows = await tx
      .update(reportRuns)
      .set({
        status: 'completed',
        result_summary: input.report.summary,
        result_payload: { ...input.envelope, report: input.report },
        facts_computed_at: new Date(input.report.sourceVersion.factsComputedAt),
        facts_version: input.report.sourceVersion.factsVersion,
        canonical_data_version: input.report.sourceVersion.canonicalDataVersion,
        embedding_model_id: embedding.modelIds.join(',') || null,
        embedding_source_version: embedding.sourceVersions.join(',') || null,
        failure_code: null,
        failure_message: null,
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(reportRuns.tenant_id, input.tenantId),
          eq(reportRuns.id, input.reportRunId),
          inArray(reportRuns.status, ['computing', 'rendering']),
          ...(input.envelope.request.outputFormat === 'pdf'
            ? [
                isNotNull(reportRuns.html_s3_key),
                isNotNull(reportRuns.html_sha256),
                isNotNull(reportRuns.pdf_s3_key),
                isNotNull(reportRuns.pdf_sha256),
              ]
            : []),
        ),
      )
      .returning({ id: reportRuns.id });
    if (!rows[0]) throw new Error('report_run_transition_conflict:completed');
    await emit({
      tenantId: input.tenantId,
      aggregateType: 'pmo.report_run',
      aggregateId: input.reportRunId,
      eventType: 'pmo.report.completed',
      eventVersion: 1,
      payload: {
        report_run_id: input.reportRunId,
        status: 'completed',
        member_count: input.report.summary.memberCount,
        finding_count: input.report.findings.length,
        facts_version: input.report.sourceVersion.factsVersion,
      },
    });
  });
}

export async function failReportRun(
  tenantId: string,
  reportRunId: string,
  failure?: { code?: string; message?: string },
): Promise<void> {
  const code = sanitizeFailureCode(failure?.code ?? 'report_generation_failed');
  const message = sanitizeFailureMessage(failure?.message ?? 'Report generation failed');
  await withEmit({ actor: { userId: 'system', tenantId } }, async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(reportRuns)
      .set({
        status: 'failed',
        failure_code: code,
        failure_message: message,
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(reportRuns.tenant_id, tenantId),
          eq(reportRuns.id, reportRunId),
          inArray(reportRuns.status, ['computing', 'rendering']),
        ),
      )
      .returning({ id: reportRuns.id });
    if (!rows[0]) throw new Error('report_run_transition_conflict:failed');
    await emit({
      tenantId,
      aggregateType: 'pmo.report_run',
      aggregateId: reportRunId,
      eventType: 'pmo.report.failed',
      eventVersion: 1,
      payload: { report_run_id: reportRunId, status: 'failed', failure_code: code },
    });
  });
}

async function requireCasTransition(input: {
  tenantId: string;
  reportRunId: string;
  from: ReportRunStatus[];
  to: ReportRunStatus;
  values?: Partial<typeof reportRuns.$inferInsert>;
}): Promise<void> {
  const rows = await pmoDb()
    .update(reportRuns)
    .set({ ...input.values, status: input.to, updated_at: new Date() })
    .where(
      and(
        eq(reportRuns.tenant_id, input.tenantId),
        eq(reportRuns.id, input.reportRunId),
        inArray(reportRuns.status, input.from),
      ),
    )
    .returning({ id: reportRuns.id });
  if (!rows[0]) throw new Error(`report_run_transition_conflict:${input.to}`);
}

function readRecommendationConfig(envelope: ReportRunEnvelope): unknown {
  const rules = envelope.ruleSnapshot.rules as { recommendation?: unknown };
  return rules.recommendation ?? null;
}

function readEmbeddingVersions(report: GeneratePmoReportOutput): {
  modelIds: string[];
  sourceVersions: string[];
} {
  return {
    modelIds: [
      ...new Set(
        report.recommendations.flatMap((group) => group.evidenceVersions.embeddingModelIds),
      ),
    ].sort(),
    sourceVersions: [
      ...new Set(report.recommendations.flatMap((group) => group.evidenceVersions.sourceVersions)),
    ].sort(),
  };
}

export function sanitizeFailureCode(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 80);
  return sanitized || 'report_generation_failed';
}

export function sanitizeFailureMessage(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function reportJobKey(reportRunId: string): string {
  return `pmo-report:${reportRunId}`;
}

function assertArtifactIdentity(run: ReportRunRecord, artifacts: ReportArtifactUpdate): void {
  if (
    artifacts.html &&
    ((run.htmlS3Key && run.htmlS3Key !== artifacts.html.s3Key) ||
      (run.htmlSha256 && run.htmlSha256 !== artifacts.html.sha256))
  ) {
    throw new Error('report_html_artifact_identity_conflict');
  }
  if (
    artifacts.pdf &&
    ((run.pdfS3Key && run.pdfS3Key !== artifacts.pdf.s3Key) ||
      (run.pdfSha256 && run.pdfSha256 !== artifacts.pdf.sha256))
  ) {
    throw new Error('report_pdf_artifact_identity_conflict');
  }
}
