import { getLatestApprovedCheckpoint } from '@seta/ingestion';
import {
  type GeneratePmoReportOutput,
  generatePmoReport,
  type PmoReportSource,
  type PmoReportType,
} from '../../../analytics/report.ts';
import {
  getPmoReportDateBounds,
  type PmoReportDateBounds,
} from '../../../analytics/report-date-bounds.ts';
import { pmoDb } from '../../../db/client.ts';
import { reportRuns } from '../../../db/schema.ts';
import type { ParsedSheet, WorkbookParseResult } from '../../../ingestion/parse-workbook.ts';
import { buildReportRangeCard } from '../cards.ts';
import type { DynamicIngestRuntimeContext, PmoDynamicStepHandler } from '../types.ts';
import type { DbChangeSummaryResult, DynamicHandlerDeps } from './common.ts';

const REPORT_DATE_FIELDS_BY_TABLE = new Map<string, string[]>([
  ['timesheet', ['work_date']],
  ['resource_allocation', ['start_date', 'end_date']],
  ['calendar_weeks', ['week_start', 'week_end']],
]);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateLike(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readDateRangeFromResume(resumeData: Record<string, unknown> | undefined) {
  const raw = resumeData?.dateRange;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const range = raw as { from?: unknown; to?: unknown };
  const from = parseDateLike(range.from);
  const to = parseDateLike(range.to);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  return { from: isoDate(from), to: isoDate(to), source: 'user_confirmed' as const };
}

interface IntentReportRequest {
  dateRange: { from: string; to: string } | null;
  reportTypes: PmoReportType[];
}

function readIntentReportRequest(plan: unknown): IntentReportRequest | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const analysis = (plan as { intent_analysis?: unknown }).intent_analysis;
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return null;
  const actionMode = (analysis as { actionMode?: unknown }).actionMode;
  if (actionMode !== 'generate_report' && actionMode !== 'publish_then_report') {
    return null;
  }

  const raw = analysis as Record<string, unknown>;
  const rawRange = raw.extractedDateRange;
  const dateRange =
    rawRange && typeof rawRange === 'object' && !Array.isArray(rawRange)
      ? {
          from: String((rawRange as Record<string, unknown>).from ?? ''),
          to: String((rawRange as Record<string, unknown>).to ?? ''),
        }
      : null;
  const reportTypes = Array.isArray(raw.extractedReportTypes)
    ? raw.extractedReportTypes.filter(
        (type): type is PmoReportType => type === 'idle_members' || type === 'overbook_members',
      )
    : [];

  return {
    dateRange,
    reportTypes: reportTypes.length > 0 ? reportTypes : ['idle_members', 'overbook_members'],
  };
}

function assertRangeWithinBounds(
  range: { from: string; to: string },
  bounds: PmoReportDateBounds,
): void {
  if (range.from < bounds.min || range.to > bounds.max) {
    throw new Error('report_date_range_outside_database_bounds');
  }
}

function dateRangeFromDates(dates: Date[]): { from: string; to: string } | null {
  if (dates.length === 0) return null;
  const sorted = dates.slice().sort((a, b) => a.getTime() - b.getTime());
  const from = sorted[0];
  const to = sorted.at(-1);
  if (!from || !to) return null;
  return { from: isoDate(from), to: isoDate(to) };
}

function sheetByName(workbook: WorkbookParseResult, name: string): ParsedSheet | null {
  return workbook.sheets.find((sheet) => sheet.name === name) ?? null;
}

function collectMappedWorkbookDates(params: {
  workbook: WorkbookParseResult;
  runtimeContext: DynamicIngestRuntimeContext;
}): Date[] {
  const confirmedMappings = params.runtimeContext.confirmed_mapping?.confirmedMappings;
  if (!Array.isArray(confirmedMappings)) return [];

  const dates: Date[] = [];
  for (const table of confirmedMappings) {
    if (!table || typeof table !== 'object' || Array.isArray(table)) continue;
    const tableRecord = table as {
      tableId?: unknown;
      sourceSheet?: unknown;
      mappings?: unknown;
    };
    if (typeof tableRecord.tableId !== 'string' || typeof tableRecord.sourceSheet !== 'string') {
      continue;
    }
    const dateFields = REPORT_DATE_FIELDS_BY_TABLE.get(tableRecord.tableId);
    if (!dateFields || !Array.isArray(tableRecord.mappings)) continue;
    const sheet = sheetByName(params.workbook, tableRecord.sourceSheet);
    if (!sheet) continue;

    const dateSourceColumns = tableRecord.mappings
      .map((mapping) => {
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return null;
        const m = mapping as { canonicalField?: unknown; sourceColumn?: unknown };
        return typeof m.canonicalField === 'string' &&
          dateFields.includes(m.canonicalField) &&
          typeof m.sourceColumn === 'string'
          ? m.sourceColumn
          : null;
      })
      .filter((value): value is string => Boolean(value));

    for (const row of sheet.rows) {
      for (const column of dateSourceColumns) {
        const parsed = parseDateLike(row[column]);
        if (parsed) dates.push(parsed);
      }
    }
  }

  return dates;
}

async function resolveSuggestedRange(input: {
  reportingPeriodStart?: Date | null;
  reportingPeriodEnd?: Date | null;
  getWorkbookParseResult: () => Promise<WorkbookParseResult>;
  runtimeContext: DynamicIngestRuntimeContext;
}): Promise<{ from: string; to: string }> {
  if (input.reportingPeriodStart && input.reportingPeriodEnd) {
    return {
      from: isoDate(input.reportingPeriodStart),
      to: isoDate(input.reportingPeriodEnd),
    };
  }

  const workbook = await input.getWorkbookParseResult();
  const workbookRange = dateRangeFromDates(
    collectMappedWorkbookDates({ workbook, runtimeContext: input.runtimeContext }),
  );
  if (workbookRange) return workbookRange;

  throw new Error('report_date_range_missing');
}

function assertPublishedCheckpoint(runtimeContext: DynamicIngestRuntimeContext): void {
  if (!runtimeContext.staging_result) {
    throw new Error('report_requires_staging_result');
  }
  const checkpoint = getLatestApprovedCheckpoint<DbChangeSummaryResult>(
    runtimeContext.staging_result,
    'database_change_summary',
  );
  if (!checkpoint) {
    throw new Error('report_requires_published_db_change_summary');
  }
}

async function persistReportRun(input: {
  tenantId: string;
  userId: string;
  ingestionSessionId: string;
  reportTypes: PmoReportType[];
  report: GeneratePmoReportOutput;
}): Promise<string | null> {
  const dateRangeStart = parseDateLike(input.report.dateRange.from);
  const dateRangeEnd = parseDateLike(input.report.dateRange.to);
  if (!dateRangeStart || !dateRangeEnd) {
    throw new Error('invalid_report_run_date_range');
  }

  const [row] = await pmoDb()
    .insert(reportRuns)
    .values({
      tenant_id: input.tenantId,
      ingestion_session_id: input.ingestionSessionId,
      report_types: input.reportTypes,
      date_range_start: dateRangeStart,
      date_range_end: dateRangeEnd,
      status: 'completed',
      result_summary: input.report.summary,
      result_payload: input.report,
      created_by: input.userId,
    })
    .returning({ id: reportRuns.id });
  return row?.id ?? null;
}

export function createGenerateReportHandler(
  deps: Pick<
    DynamicHandlerDeps,
    'resolveCardIdentity' | 'readPlannerStepMeta' | 'getWorkbookParseResult'
  > & {
    persistReportRun?: typeof persistReportRun;
    getReportDateBounds?: typeof getPmoReportDateBounds;
  },
): PmoDynamicStepHandler {
  return {
    actionId: 'generate_report',
    execute: async (input) => {
      const intentRequest = readIntentReportRequest(input.planningPlan);
      const reportSource: PmoReportSource =
        (input.reportSource as PmoReportSource) ?? 'canonical_db';
      const databaseOnly = reportSource === 'canonical_db';
      if (reportSource === 'published_batch') assertPublishedCheckpoint(input.runtimeContext);

      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });
      const reportTypes = input.runtimeContext.report_request?.reportTypes ??
        intentRequest?.reportTypes ?? ['idle_members', 'overbook_members'];
      const persistedRange = input.runtimeContext.report_request?.dateRange;
      const explicitRange =
        persistedRange?.source === 'goal_explicit' ||
        persistedRange?.source === 'user_confirmed' ||
        persistedRange?.source === 'sheet_derived'
          ? persistedRange
          : intentRequest?.dateRange
            ? { ...intentRequest.dateRange, source: 'goal_explicit' as const }
            : null;
      const resumedRange = readDateRangeFromResume(input.resumeData);
      let dateRange = resumedRange ?? explicitRange;
      const databaseBounds = await (deps.getReportDateBounds ?? getPmoReportDateBounds)(
        input.tenantId,
      );
      if (!databaseBounds) throw new Error('report_date_bounds_unavailable');

      if (
        !dateRange &&
        (reportSource === 'published_batch' || reportSource === 'staging_preview')
      ) {
        try {
          const sheetRange = await resolveSuggestedRange({
            reportingPeriodStart: input.reportingPeriodStart,
            reportingPeriodEnd: input.reportingPeriodEnd,
            getWorkbookParseResult: () => deps.getWorkbookParseResult(input),
            runtimeContext: input.runtimeContext,
          });
          dateRange = { ...sheetRange, source: 'sheet_derived' };
        } catch {
          // For staging_preview, sheet-derived range is best-effort; fall through to ask user.
        }
      }

      if (!dateRange) {
        if (input.resumeData?.decision === 'reject') {
          return {
            kind: 'completed',
            sessionStatus: 'published',
            runtimeContextPatch: {
              report_request: {
                reportTypes,
                suggestedDateRange: input.runtimeContext.report_request?.suggestedDateRange,
              },
            },
            outputSummary: {
              status: 'skipped',
              reason: 'report_range_rejected',
            },
          };
        }

        let suggestedDateRange: { from: string; to: string };
        if (databaseOnly) {
          suggestedDateRange = { from: databaseBounds.min, to: databaseBounds.max };
        } else {
          const cached = input.runtimeContext.report_request?.suggestedDateRange;
          if (cached) {
            suggestedDateRange = cached;
          } else {
            try {
              suggestedDateRange = await resolveSuggestedRange({
                reportingPeriodStart: input.reportingPeriodStart,
                reportingPeriodEnd: input.reportingPeriodEnd,
                getWorkbookParseResult: () => deps.getWorkbookParseResult(input),
                runtimeContext: input.runtimeContext,
              });
            } catch {
              // Fallback to database bounds when sheet range is unavailable.
              suggestedDateRange = { from: databaseBounds.min, to: databaseBounds.max };
            }
          }
        }

        return {
          kind: 'suspend',
          card: buildReportRangeCard({
            ingestionSessionId: input.ingestionSessionId,
            suggestedDateRange,
            databaseDateBounds: databaseBounds,
            rangeSource: databaseOnly ? 'database' : 'sheet_or_database',
            reportTypes,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmReportRange`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_report_range',
          runtimeContextPatch: {
            report_request: {
              reportTypes,
              dateRange: {
                ...suggestedDateRange,
                source: 'sheet_suggested_pending',
              },
              suggestedDateRange: {
                ...suggestedDateRange,
                source: databaseOnly ? 'database' : 'sheet',
              },
            },
          },
          outputSummary: {
            status: 'needs_range_confirmation',
            suggested_from: suggestedDateRange.from,
            suggested_to: suggestedDateRange.to,
          },
        };
      }

      // Skip bounds check for staging_preview — staged data may extend beyond canonical DB range.
      if (reportSource !== 'staging_preview') {
        assertRangeWithinBounds(dateRange, databaseBounds);
      }

      const report = await generatePmoReport({
        tenantId: input.tenantId,
        ingestionSessionId: input.ingestionSessionId,
        dateRange: {
          from: dateRange.from,
          to: dateRange.to,
        },
        reportTypes,
        reportSource,
      });
      const reportRunId = await (deps.persistReportRun ?? persistReportRun)({
        tenantId: input.tenantId,
        userId: input.userId,
        ingestionSessionId: input.ingestionSessionId,
        reportTypes,
        report,
      });

      return {
        kind: 'completed',
        sessionStatus: 'report_generated',
        runtimeContextPatch: {
          report_request: {
            reportTypes,
            dateRange,
            suggestedDateRange: input.runtimeContext.report_request?.suggestedDateRange,
          },
          report_result: report,
        },
        outputSummary: {
          status: 'generated',
          report_run_id: reportRunId,
          from: report.dateRange.from,
          to: report.dateRange.to,
          member_count: report.summary.memberCount,
          overbook_count: report.summary.overbookCount,
          idle_count: report.summary.idleCount,
          finding_count: report.findings.length,
        },
        terminalOutput: {
          ingestionSessionId: input.ingestionSessionId,
          status: 'completed',
          reportRunId,
          report,
        },
      };
    },
  };
}
