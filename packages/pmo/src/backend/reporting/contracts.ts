import type { GeneratePmoReportOutput } from './report-output.ts';

export const CANONICAL_REPORT_TYPES = ['idle', 'overbook'] as const;
export type CanonicalReportType = (typeof CANONICAL_REPORT_TYPES)[number];
export type LegacyReportType = 'idle_members' | 'overbook_members';
export type ReportSourceMode = 'canonical_db' | 'after_upload_publish';
export type ReportOutputFormat = 'json' | 'pdf';

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface CreateReportRunInput {
  tenantId: string;
  actorId: string;
  sourceMode: ReportSourceMode;
  ingestionSessionId?: string;
  dateRange: ReportDateRange;
  reportTypes: Array<CanonicalReportType | LegacyReportType>;
  recommendationCandidateCount?: number;
  outputFormat?: ReportOutputFormat;
}

export interface PersistedReportRequest {
  sourceMode: ReportSourceMode;
  dateRange: ReportDateRange;
  reportTypes: CanonicalReportType[];
  recommendationCandidateCount?: number;
  outputFormat: ReportOutputFormat;
}

export interface ReportRuleSnapshot {
  ruleSetId: string;
  version: string;
  sha256: string;
  rules: unknown;
}

export interface ReportRunEnvelope {
  request: PersistedReportRequest;
  ruleSnapshot: ReportRuleSnapshot;
}

export interface GenerateReportResult {
  reportRunId: string;
  report: GeneratePmoReportOutput;
}

export interface ReportArtifactStatus {
  available: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  downloadUrl: string | null;
}

export interface ReportStatusResponse {
  reportRunId: string;
  status: 'queued' | 'computing' | 'rendering' | 'completed' | 'failed';
  dateRange: ReportDateRange;
  outputFormat: ReportOutputFormat;
  summary: GeneratePmoReportOutput['summary'] | null;
  findingCounts: {
    red: number;
    yellow: number;
    idle: number;
    overbook: number;
    mismatch: number;
  } | null;
  artifacts: { html: ReportArtifactStatus; pdf: ReportArtifactStatus };
  failure: { code: string | null; message: string | null } | null;
  retryAllowed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function normalizeReportTypes(
  values: Array<CanonicalReportType | LegacyReportType>,
): CanonicalReportType[] {
  const mapped = values.map((value) => {
    if (value === 'idle_members') return 'idle';
    if (value === 'overbook_members') return 'overbook';
    return value;
  });
  return [...new Set(mapped)].sort((left, right) => {
    const order: Record<CanonicalReportType, number> = { overbook: 0, idle: 1 };
    return order[left] - order[right];
  });
}

export function toLegacyReportTypes(values: CanonicalReportType[]): LegacyReportType[] {
  return values.map((value) => (value === 'idle' ? 'idle_members' : 'overbook_members'));
}
