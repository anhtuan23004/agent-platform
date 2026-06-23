import type { AgentToolContext } from '@seta/agent-sdk';
import { analyticsIngestionSessionIdFromContext } from './context.ts';

export interface ResolvedDateRange {
  from: string;
  to: string;
}

export interface ResolvedAnalyticsScope {
  ingestionSessionId?: string;
  dateRange?: ResolvedDateRange;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readContextString(ctx: AgentToolContext, key: string): string | undefined {
  const requestContext = ctx.requestContext as { get?: (k: string) => unknown } | undefined;
  const value = requestContext?.get?.(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function analyticsReportingDateRangeFromContext(
  ctx: AgentToolContext,
): ResolvedDateRange | undefined {
  const from = readContextString(ctx, 'pmo.analytics.reporting_date_from');
  const to = readContextString(ctx, 'pmo.analytics.reporting_date_to');
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return undefined;
  return { from, to };
}

export function resolveAnalyticsScope(
  ctx: AgentToolContext,
  input: {
    ingestionSessionId?: string;
    dateRange?: ResolvedDateRange;
  },
): ResolvedAnalyticsScope {
  const ingestionSessionId =
    input.ingestionSessionId ?? analyticsIngestionSessionIdFromContext(ctx);
  const dateRange = input.dateRange ?? analyticsReportingDateRangeFromContext(ctx);
  return {
    ...(ingestionSessionId ? { ingestionSessionId } : {}),
    ...(dateRange ? { dateRange } : {}),
  };
}

export function toLoadFactsDateRange(
  dateRange: ResolvedDateRange | undefined,
): { from: Date; to: Date } | undefined {
  if (!dateRange) return undefined;
  return {
    from: new Date(`${dateRange.from}T00:00:00.000Z`),
    to: new Date(`${dateRange.to}T00:00:00.000Z`),
  };
}
