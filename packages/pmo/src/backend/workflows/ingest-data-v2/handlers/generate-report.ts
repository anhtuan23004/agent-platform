import { getLatestApprovedCheckpoint } from '@seta/ingestion';
import {
  type GeneratePmoReportOutput,
  generatePmoReport,
  type PmoReportType,
} from '../../../analytics/report.ts';
import { pmoDb } from '../../../db/client.ts';
import { reportRuns } from '../../../db/schema.ts';
import type { ParsedSheet, WorkbookParseResult } from '../../../ingestion/parse-workbook.ts';
import { buildReportRangeCard } from '../cards.ts';
import type { DynamicIngestRuntimeContext, PmoDynamicStepHandler } from '../types.ts';
import type { DbChangeSummaryResult, DynamicHandlerDeps } from './common.ts';

type ReportDateRangeSource = 'goal_explicit' | 'user_confirmed' | 'sheet_suggested_pending';

interface ResolvedReportDateRange {
  from: string;
  to: string;
  source: ReportDateRangeSource;
}

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

function readDateRangeFromGoal(goal: string | null | undefined): ResolvedReportDateRange | null {
  if (!goal) return null;
  const dates = [...goal.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  if (dates.length < 2 || !dates[0] || !dates[1]) return null;
  const from = parseDateLike(dates[0]);
  const to = parseDateLike(dates[1]);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  return { from: isoDate(from), to: isoDate(to), source: 'goal_explicit' };
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

function resolveReportTypes(goal: string | null | undefined): PmoReportType[] {
  const text = (goal ?? '').toLowerCase();
  const wantsIdle = /idle|under-alloc|under\s*alloc/.test(text);
  const wantsOverbook = /overbook|over-book/.test(text);
  if (wantsIdle && !wantsOverbook) return ['idle_members'];
  if (wantsOverbook && !wantsIdle) return ['overbook_members'];
  return ['idle_members', 'overbook_members'];
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
  },
): PmoDynamicStepHandler {
  return {
    actionId: 'generate_report',
    execute: async (input) => {
      assertPublishedCheckpoint(input.runtimeContext);

      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });
      const reportTypes =
        input.runtimeContext.report_request?.reportTypes ?? resolveReportTypes(input.planningGoal);
      const persistedRange = input.runtimeContext.report_request?.dateRange;
      const explicitRange =
        persistedRange?.source === 'goal_explicit' || persistedRange?.source === 'user_confirmed'
          ? persistedRange
          : readDateRangeFromGoal(input.planningGoal);
      const resumedRange = readDateRangeFromResume(input.resumeData);
      const dateRange = resumedRange ?? explicitRange;

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

        const suggestedDateRange =
          input.runtimeContext.report_request?.suggestedDateRange ??
          (await resolveSuggestedRange({
            reportingPeriodStart: input.reportingPeriodStart,
            reportingPeriodEnd: input.reportingPeriodEnd,
            getWorkbookParseResult: () => deps.getWorkbookParseResult(input),
            runtimeContext: input.runtimeContext,
          }));

        return {
          kind: 'suspend',
          card: buildReportRangeCard({
            ingestionSessionId: input.ingestionSessionId,
            suggestedDateRange,
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
                source: 'sheet',
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

      const report = await generatePmoReport({
        tenantId: input.tenantId,
        ingestionSessionId: input.ingestionSessionId,
        dateRange: {
          from: dateRange.from,
          to: dateRange.to,
        },
        reportTypes,
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
