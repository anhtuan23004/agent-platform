import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { generatePmoReport } from '../analytics/report.ts';
import type { GeneratePmoReportOutput } from './report-output.ts';

const log = pino({ name: 'pmo/reporting' });

import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import {
  type CreateReportRunInput,
  type GenerateReportResult,
  normalizeReportTypes,
  type ReportRunEnvelope,
  toLegacyReportTypes,
} from './contracts.ts';
import { validateReportDateRange } from './date-range.ts';
import { validateCandidateCount } from './recommendations/contracts.ts';
import {
  completeReportRun,
  failReportRun,
  getReportRun,
  insertQueuedReportRun,
  saveComputedReportRun,
  setReportRunComputing,
} from './report-repository.ts';
import type { ResolvedReportRules } from './rules/resolve.ts';
import { resolveReportRules } from './rules/resolve.ts';
import type { PmoReportRuleSet } from './rules/schema.ts';

export interface ReportApplicationDeps {
  resolveRules: typeof resolveReportRules;
  insertQueued: typeof insertQueuedReportRun;
  getRun: typeof getReportRun;
  setComputing: typeof setReportRunComputing;
  complete: typeof completeReportRun;
  saveComputed: typeof saveComputedReportRun;
  fail: typeof failReportRun;
  computeAnalytics: typeof generatePmoReport;
  verifyPublishedSession: typeof verifyPublishedSession;
}

const DEFAULT_DEPS: ReportApplicationDeps = {
  resolveRules: resolveReportRules,
  insertQueued: insertQueuedReportRun,
  getRun: getReportRun,
  setComputing: setReportRunComputing,
  complete: completeReportRun,
  saveComputed: saveComputedReportRun,
  fail: failReportRun,
  computeAnalytics: generatePmoReport,
  verifyPublishedSession,
};

export async function verifyPublishedSession(
  tenantId: string,
  ingestionSessionId: string,
): Promise<void> {
  const rows = await pmoDb()
    .select({ id: ingestionSessions.id })
    .from(ingestionSessions)
    .where(
      and(
        eq(ingestionSessions.id, ingestionSessionId),
        eq(ingestionSessions.tenant_id, tenantId),
        eq(ingestionSessions.publish_decision, 'approved'),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error('report_requires_published_tenant_session');
}

export async function createReportRun(
  input: CreateReportRunInput,
  deps: ReportApplicationDeps = DEFAULT_DEPS,
): Promise<string> {
  if (input.sourceMode !== 'canonical_db' && input.sourceMode !== 'after_upload_publish') {
    throw new Error('invalid_report_source_mode');
  }
  if (input.sourceMode === 'after_upload_publish') {
    if (!input.ingestionSessionId) throw new Error('report_ingestion_session_required');
    await deps.verifyPublishedSession(input.tenantId, input.ingestionSessionId);
  }
  const preliminary = validateReportDateRange(input.dateRange, Number.MAX_SAFE_INTEGER);
  const rules = await deps.resolveRules({ tenantId: input.tenantId, effectiveAt: preliminary.to });
  const dateRange = validateReportDateRange(input.dateRange, rules.reportLimits.maxWeeks);
  validateCandidateCount(input.recommendationCandidateCount, rules);
  const reportTypes = normalizeReportTypes(input.reportTypes);
  if (reportTypes.length === 0) throw new Error('report_types_required');
  log.info(
    {
      tenantId: input.tenantId,
      sourceMode: input.sourceMode,
      dateRange: dateRange.normalized,
      reportTypes,
    },
    'creating report run',
  );
  const envelope: ReportRunEnvelope = {
    request: {
      sourceMode: input.sourceMode,
      dateRange: dateRange.normalized,
      reportTypes,
      ...(input.recommendationCandidateCount === undefined
        ? {}
        : { recommendationCandidateCount: input.recommendationCandidateCount }),
      outputFormat: input.outputFormat ?? 'json',
    },
    ruleSnapshot: buildRuleSnapshot(rules),
  };
  return deps.insertQueued({
    tenantId: input.tenantId,
    actorId: input.actorId,
    ingestionSessionId:
      input.sourceMode === 'after_upload_publish' ? (input.ingestionSessionId ?? null) : null,
    reportTypes,
    dateRange,
    envelope,
  });
}

export async function computeReportPayload(
  input: { tenantId: string; reportRunId: string },
  deps: ReportApplicationDeps = DEFAULT_DEPS,
): Promise<GeneratePmoReportOutput> {
  const run = await deps.getRun(input.tenantId, input.reportRunId);
  if (run.status !== 'queued' && run.status !== 'computing') {
    throw new Error(`report_run_not_computable:${run.status}`);
  }
  if (run.status === 'queued') await deps.setComputing(input.tenantId, input.reportRunId);
  const computeStartMs = Date.now();
  try {
    const request = run.envelope.request;
    const report = sortReportPayload(
      await deps.computeAnalytics({
        tenantId: input.tenantId,
        ingestionSessionId: run.ingestionSessionId ?? undefined,
        dateRange: request.dateRange,
        reportTypes: toLegacyReportTypes(request.reportTypes),
        reportSource:
          request.sourceMode === 'after_upload_publish' ? 'published_batch' : 'canonical_db',
        recommendationCandidateCount: request.recommendationCandidateCount,
      }),
    );
    const limits = run.envelope.ruleSnapshot.rules as PmoReportRuleSet;
    if (
      request.outputFormat === 'pdf' &&
      (report.summary.memberCount > limits.reportLimits.maxMembersForPdf ||
        report.findings.length > limits.reportLimits.maxFindingsForPdf)
    ) {
      throw new Error('report_pdf_limits_exceeded');
    }
    log.info(
      {
        reportRunId: input.reportRunId,
        tenantId: input.tenantId,
        memberCount: report.summary.memberCount,
        findingCount: report.findings.length,
        durationMs: Date.now() - computeStartMs,
      },
      'report payload computed',
    );
    const persist = request.outputFormat === 'pdf' ? deps.saveComputed : deps.complete;
    await persist({
      tenantId: input.tenantId,
      reportRunId: input.reportRunId,
      report,
      envelope: run.envelope,
    });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.fail(input.tenantId, input.reportRunId, {
      code: message.split(':', 1)[0] || 'report_generation_failed',
      message,
    });
    throw error;
  }
}

export async function generateReport(
  input: CreateReportRunInput,
  deps: ReportApplicationDeps = DEFAULT_DEPS,
): Promise<GenerateReportResult> {
  const reportRunId = await createReportRun(input, deps);
  const report = await computeReportPayload({ tenantId: input.tenantId, reportRunId }, deps);
  return { reportRunId, report };
}

function buildRuleSnapshot(rules: ResolvedReportRules): ReportRunEnvelope['ruleSnapshot'] {
  const { canonicalJson: _canonicalJson, sha256, ...ruleSet } = rules;
  return {
    ruleSetId: rules.ruleSetId,
    version: rules.version,
    sha256,
    rules: structuredClone(ruleSet),
  };
}

export function sortReportPayload(report: GeneratePmoReportOutput): GeneratePmoReportOutput {
  const severity = { red: 0, yellow: 1, green: 2, none: 3 } as const;
  const issue = { overbook: 0, idle: 1, mismatch_under: 2, mismatch_over: 3, ok: 4 } as const;
  return {
    ...report,
    findings: [...report.findings].sort(
      (left, right) =>
        severity[left.ragColor] - severity[right.ragColor] ||
        issue[left.issueType] - issue[right.issueType] ||
        (right.busyRate ?? 0) - (left.busyRate ?? 0) ||
        left.memberId.localeCompare(right.memberId),
    ),
    recommendations: [...report.recommendations].sort(
      (left, right) =>
        Number(right.severity === 'red') - Number(left.severity === 'red') ||
        right.requiredReductionHoursPerWeek - left.requiredReductionHoursPerWeek ||
        left.sourceMemberId.localeCompare(right.sourceMemberId) ||
        left.opportunityId.localeCompare(right.opportunityId),
    ),
  };
}
