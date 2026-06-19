import type { PmoPlanningSession } from '../api/client';
import type { DemoAnalyticsSettings } from '../api/demo-analytics';

export interface SourceUploadOption {
  id: string;
  label: string;
  statusLabel: string;
  uploadedAtLabel: string;
  reportingPeriodLabel: string;
  reportingPeriodStart: string | null;
  reportingPeriodEnd: string | null;
  disabled: boolean;
}

export type UtilizationEmptyState = 'none' | 'no_uploads' | 'unpublished_uploads' | 'filter_empty';

function isoDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function formatDisplayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatReportingPeriod(session: PmoPlanningSession): string {
  const start = isoDate(session.reporting_period_start);
  const end = isoDate(session.reporting_period_end);
  if (start && end) return `${start} to ${end}`;
  return session.reporting_period_key ?? 'No reporting period';
}

export function hasCustomDateRange(settings: DemoAnalyticsSettings | undefined): boolean {
  return Boolean(settings?.from || settings?.to);
}

export function buildSourceUploadOptions(sessions: PmoPlanningSession[]): SourceUploadOption[] {
  return sessions.map((session) => ({
    id: session.ingestion_session_id,
    label: session.workbook_name,
    statusLabel: session.is_published ? 'Published' : session.status_label,
    uploadedAtLabel: formatDisplayDate(session.uploaded_at),
    reportingPeriodLabel: formatReportingPeriod(session),
    reportingPeriodStart: isoDate(session.reporting_period_start),
    reportingPeriodEnd: isoDate(session.reporting_period_end),
    disabled: !session.is_selectable,
  }));
}

export function utilizationEmptyState(params: {
  hasAnalyticsData: boolean;
  hasNoDataError: boolean;
  hasActiveDataFilters: boolean;
  sessions: PmoPlanningSession[];
}): UtilizationEmptyState {
  if (params.hasAnalyticsData || !params.hasNoDataError) return 'none';
  if (params.hasActiveDataFilters && params.sessions.some((session) => session.is_published)) {
    return 'filter_empty';
  }
  if (params.sessions.length > 0 && params.sessions.every((session) => !session.is_published)) {
    return 'unpublished_uploads';
  }
  return 'no_uploads';
}
