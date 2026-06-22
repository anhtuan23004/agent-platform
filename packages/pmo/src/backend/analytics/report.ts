import {
  generateRebalanceRecommendations,
  getRecommendationProjectionFreshness,
  loadRecommendationEvidence,
  type RebalanceEvidence,
  type RebalanceRecommendationGroup,
} from '../reporting/recommendations/index.ts';
import { type EnsureFactsComputedResult, ensureFactsComputed } from './ensure-facts-computed.ts';
import { detectOverbookIdle } from './findings.ts';
import {
  type LoadReportEvidenceOptions,
  loadReportEvidence,
  type ReportEvidence,
} from './load-report-evidence.ts';
import type { Finding } from './types.ts';

export type PmoReportType = 'idle_members' | 'overbook_members';
export type PmoReportSource = 'canonical_db' | 'staging_preview' | 'published_batch';

export interface PmoReportDateRange {
  from: string;
  to: string;
}

export interface GeneratePmoReportInput {
  tenantId: string;
  ingestionSessionId?: string;
  dateRange: PmoReportDateRange;
  reportTypes: PmoReportType[];
  reportSource?: PmoReportSource;
  recommendationCandidateCount?: number;
}

export interface GeneratePmoReportDeps {
  ensureFacts: (tenantId: string, options: { force: false }) => Promise<EnsureFactsComputedResult>;
  loadEvidence: (tenantId: string, options: LoadReportEvidenceOptions) => Promise<ReportEvidence>;
  getRecommendationProjectionFreshness?: typeof getRecommendationProjectionFreshness;
  loadRecommendationEvidence?: (input: {
    tenantId: string;
    from: Date;
    to: Date;
    reportEvidence: ReportEvidence;
    historyWindowDays: number;
  }) => Promise<RebalanceEvidence>;
}

export interface GeneratePmoReportOutput {
  dateRange: PmoReportDateRange;
  sourceVersion: {
    factsVersion: string;
    canonicalDataVersion: string;
    factsComputedAt: string;
  };
  summary: {
    memberCount: number;
    overbookCount: number;
    idleCount: number;
    excludedWeekCount: number;
  };
  members: Array<{
    memberId: string;
    fullName: string;
    department: string | null;
    roleTitle: string | null;
  }>;
  projectionFreshness: RecommendationProjectionFreshness;
  dataQuality: {
    recommendationDegraded: boolean;
    flags: string[];
  };
  findings: Array<
    Pick<
      Finding,
      | 'memberId'
      | 'issueType'
      | 'ragColor'
      | 'busyRate'
      | 'effortConsumption'
      | 'detail'
      | 'annotations'
      | 'reviewRequired'
      | 'suggestedActionCode'
      | 'suggestedActions'
    > & {
      excludedWeeks: Array<{ weekId: string; reason: string }>;
      metricEvidence: ReportMetricEvidence;
    }
  >;
  recommendations: RebalanceRecommendationGroup[];
}

export interface ReportMetricEvidence {
  N01: number | null;
  N02: number | null;
  N03: number | null;
  N04: number | null;
  N05: number | null;
  N06: number | null;
  N12: number | null;
}

export interface RecommendationProjectionFreshness {
  skillsCount: number;
  taskHistoryCount: number;
  lastSyncedAt: string | null;
  degraded: boolean;
}

const DEFAULT_DEPS: GeneratePmoReportDeps = {
  ensureFacts: ensureFactsComputed,
  loadEvidence: loadReportEvidence,
  getRecommendationProjectionFreshness,
  loadRecommendationEvidence,
};

function parseReportDate(value: string, label: 'from' | 'to'): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) || Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid_report_date:${label}`);
  }
  return parsed;
}

function reportTypeAllows(types: PmoReportType[], issueType: Finding['issueType']): boolean {
  if (issueType === 'idle') return types.includes('idle_members');
  if (issueType === 'overbook') return types.includes('overbook_members');
  return false;
}

export async function generatePmoReport(
  input: GeneratePmoReportInput,
  deps: GeneratePmoReportDeps = DEFAULT_DEPS,
): Promise<GeneratePmoReportOutput> {
  if (input.reportSource === 'staging_preview') {
    throw new Error('report_staging_preview_not_supported');
  }
  const from = parseReportDate(input.dateRange.from, 'from');
  const to = parseReportDate(input.dateRange.to, 'to');
  if (from.getTime() > to.getTime()) throw new Error('invalid_report_date_range');

  const freshness = await deps.ensureFacts(input.tenantId, { force: false });
  const projectionFreshness = await loadProjectionFreshness(input.tenantId, deps);
  const evidence = await deps.loadEvidence(input.tenantId, { dateRange: { from, to } });
  const findings = detectOverbookIdle(evidence.facts, evidence.ctx).filter((finding) =>
    reportTypeAllows(input.reportTypes, finding.issueType),
  );
  const memberCount = new Set(
    evidence.facts.filter((fact) => fact.scopeStatus === 'IN_SCOPE').map((fact) => fact.memberId),
  ).size;
  let recommendations: RebalanceRecommendationGroup[] = [];
  if (
    evidence.reportRules?.recommendation.enabled &&
    deps.loadRecommendationEvidence &&
    findings.some((finding) => finding.issueType === 'overbook')
  ) {
    const recommendationEvidence = await deps.loadRecommendationEvidence({
      tenantId: input.tenantId,
      from,
      to,
      reportEvidence: evidence,
      historyWindowDays: evidence.reportRules.recommendation.historyWindowDays,
    });
    recommendations = generateRebalanceRecommendations({
      findings,
      evidence: recommendationEvidence,
      rules: evidence.reportRules,
      effectiveAt: to,
      candidateCount: input.recommendationCandidateCount,
    });
  }
  const displayMemberIds = new Set([
    ...findings.map((finding) => finding.memberId),
    ...recommendations.flatMap((group) => [
      group.sourceMemberId,
      ...group.recommendations.map((recommendation) => recommendation.targetMemberId),
    ]),
  ]);
  const members = (evidence.members ?? [])
    .filter((member) => displayMemberIds.has(member.memberId))
    .map((member) => ({
      memberId: member.memberId,
      fullName: member.fullName,
      department: member.department,
      roleTitle: member.roleTitle,
    }))
    .sort((left, right) => left.memberId.localeCompare(right.memberId));
  const dataQualityFlags = [
    ...new Set([
      ...recommendations.flatMap((group) => group.dataQualityFlags),
      ...(projectionFreshness.degraded ? ['candidate_data_unavailable'] : []),
    ]),
  ].sort();

  return {
    dateRange: { from: input.dateRange.from.slice(0, 10), to: input.dateRange.to.slice(0, 10) },
    sourceVersion: {
      factsVersion: freshness.factsVersion,
      canonicalDataVersion: freshness.canonicalDataVersion,
      factsComputedAt: freshness.computedAt.toISOString(),
    },
    summary: {
      memberCount,
      overbookCount: findings.filter((finding) => finding.issueType === 'overbook').length,
      idleCount: findings.filter((finding) => finding.issueType === 'idle').length,
      excludedWeekCount: findings.reduce((sum, finding) => sum + finding.excludedWeeks.length, 0),
    },
    members,
    projectionFreshness,
    dataQuality: {
      recommendationDegraded:
        projectionFreshness.degraded ||
        recommendations.some((group) => group.recommendationDegraded),
      flags: dataQualityFlags,
    },
    findings: findings.map((finding) => ({
      memberId: finding.memberId,
      issueType: finding.issueType,
      ragColor: finding.ragColor,
      busyRate: finding.busyRate,
      effortConsumption: finding.effortConsumption,
      detail: finding.detail,
      excludedWeeks: finding.excludedWeeks,
      annotations: finding.annotations,
      reviewRequired: finding.reviewRequired,
      suggestedActionCode: finding.suggestedActionCode,
      suggestedActions: finding.suggestedActions,
      metricEvidence: aggregateMetricEvidence(
        evidence.facts.filter((fact) => fact.memberId === finding.memberId),
      ),
    })),
    recommendations,
  };
}

async function loadProjectionFreshness(
  tenantId: string,
  deps: GeneratePmoReportDeps,
): Promise<RecommendationProjectionFreshness> {
  const raw = await deps.getRecommendationProjectionFreshness?.(tenantId);
  if (!raw) {
    return {
      skillsCount: 0,
      taskHistoryCount: 0,
      lastSyncedAt: null,
      degraded: true,
    };
  }
  const latestTimes = [raw.latestSkillSyncAt, raw.latestTaskSyncAt].filter(
    (value): value is Date => value !== null,
  );
  const lastSyncedAt =
    latestTimes.length === 0
      ? null
      : new Date(Math.max(...latestTimes.map((value) => value.getTime()))).toISOString();
  return {
    skillsCount: raw.skillCount,
    taskHistoryCount: raw.taskCount,
    lastSyncedAt,
    degraded: raw.skillCount === 0 || raw.taskCount === 0,
  };
}

function aggregateMetricEvidence(facts: ReportEvidence['facts']): ReportMetricEvidence {
  const included = facts.filter(
    (fact) => fact.scopeStatus === 'IN_SCOPE' && fact.availableHours > 0,
  );
  const sum = (read: (fact: (typeof included)[number]) => number) =>
    included.reduce((total, fact) => total + read(fact), 0);
  const available = sum((fact) => fact.availableHours);
  const planned = sum((fact) => fact.plannedHours);
  const logged = sum((fact) => fact.loggedHours);
  const trainingValues = included
    .map((fact) => fact.trainingCompliance)
    .filter((value): value is number => value !== null);
  const overtimeValues = included
    .map((fact) => fact.overtimeRatio)
    .filter((value): value is number => value !== null);
  const ratio = (numerator: number, denominator: number) =>
    denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
  return {
    N01: ratio(planned, available),
    N02: ratio(logged, available),
    N03: ratio(
      sum((fact) => fact.billableHours),
      logged,
    ),
    N04: ratio(
      sum((fact) => fact.benchHours),
      available,
    ),
    N05:
      overtimeValues.length > 0
        ? ratio(
            overtimeValues.reduce((total, value) => total + value, 0),
            overtimeValues.length,
          )
        : null,
    N06: ratio(logged, planned),
    N12:
      trainingValues.length > 0
        ? ratio(
            trainingValues.reduce((total, value) => total + value, 0),
            trainingValues.length,
          )
        : null,
  };
}
