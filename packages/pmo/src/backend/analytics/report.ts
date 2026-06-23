import {
  buildFallbackFindingExplanation,
  buildFallbackRecommendationExplanation,
  explainPmoReportWithLlm,
} from '../reporting/explanations/report-explanations.ts';
import {
  generateRebalanceRecommendations,
  loadRecommendationEvidence,
  type RebalanceEvidence,
  type RebalanceRecommendationGroup,
} from '../reporting/recommendations/index.ts';
import type {
  ExplainPmoReportInput,
  ExplainPmoReportOutput,
  ExplainPmoReportRuleContext,
  GeneratePmoReportOutput,
  PmoReportDateRange,
  ReportMetricEvidence,
} from '../reporting/report-output.ts';
import { type EnsureFactsComputedResult, ensureFactsComputed } from './ensure-facts-computed.ts';
import { detectMismatch, detectOverbookIdle } from './findings.ts';
import {
  type LoadReportEvidenceOptions,
  loadReportEvidence,
  type ReportEvidence,
} from './load-report-evidence.ts';
import type { Finding } from './types.ts';

export type {
  ExplainPmoReportInput,
  ExplainPmoReportOutput,
  ExplainPmoReportRuleContext,
  GeneratePmoReportOutput,
  PmoReportDateRange,
  ReportMetricEvidence,
} from '../reporting/report-output.ts';

export type PmoReportType = 'idle_members' | 'overbook_members';
export type PmoReportSource = 'canonical_db' | 'staging_preview' | 'published_batch';

export interface GeneratePmoReportInput {
  tenantId: string;
  ingestionSessionId?: string;
  dateRange: PmoReportDateRange;
  reportTypes: PmoReportType[];
  reportSource?: PmoReportSource;
  recommendationCandidateCount?: number;
}

export interface GeneratePmoReportDeps {
  ensureFacts: (
    tenantId: string,
    options: { force: false; sessionId?: string },
  ) => Promise<EnsureFactsComputedResult>;
  loadEvidence: (tenantId: string, options: LoadReportEvidenceOptions) => Promise<ReportEvidence>;
  loadRecommendationEvidence?: (input: {
    tenantId: string;
    from: Date;
    to: Date;
    reportEvidence: ReportEvidence;
    historyWindowDays: number;
  }) => Promise<RebalanceEvidence>;
  explainReport?: (input: ExplainPmoReportInput) => Promise<ExplainPmoReportOutput | null>;
}

const DEFAULT_DEPS: GeneratePmoReportDeps = {
  ensureFacts: ensureFactsComputed,
  loadEvidence: loadReportEvidence,
  loadRecommendationEvidence,
  explainReport: explainPmoReportWithLlm,
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

  const freshness = await deps.ensureFacts(input.tenantId, {
    force: false,
    ...(input.ingestionSessionId ? { sessionId: input.ingestionSessionId } : {}),
  });
  const evidence = await deps.loadEvidence(input.tenantId, {
    dateRange: { from, to },
    ...(input.ingestionSessionId ? { ingestionSessionId: input.ingestionSessionId } : {}),
  });
  const capacityFindings = detectOverbookIdle(evidence.facts, evidence.ctx).filter((finding) =>
    reportTypeAllows(input.reportTypes, finding.issueType),
  );
  const findings = [...capacityFindings, ...detectMismatch(evidence.facts, evidence.ctx)];
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
  const findingPayload = findings.map((finding) => ({
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
  }));
  const explanations = await maybeExplainReport(deps.explainReport, {
    dateRange: { from: input.dateRange.from.slice(0, 10), to: input.dateRange.to.slice(0, 10) },
    summary: {
      memberCount,
      overbookCount: findings.filter((finding) => finding.issueType === 'overbook').length,
      idleCount: findings.filter((finding) => finding.issueType === 'idle').length,
      excludedWeekCount: findings.reduce((sum, finding) => sum + finding.excludedWeeks.length, 0),
    },
    members,
    findings: findingPayload,
    recommendations,
    ruleContext: buildExplanationRuleContext(evidence),
  });
  const findingExplanations = new Map(
    (explanations?.findings ?? []).map((item) => [
      `${item.memberId}:${item.issueType}`,
      item.explanation,
    ]),
  );
  const recommendationExplanations = new Map(
    (explanations?.recommendations ?? []).map((item) => [item.opportunityId, item.explanation]),
  );

  return {
    reportFamily: 'workload',
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
    findings: findingPayload.map((finding) => ({
      ...finding,
      explanation:
        findingExplanations.get(`${finding.memberId}:${finding.issueType}`) ??
        buildFallbackFindingExplanation({
          issueType: finding.issueType,
          busyRate: finding.busyRate,
          effortConsumption: finding.effortConsumption,
          detail: finding.detail,
        }),
    })),
    recommendations: recommendations.map((group) => ({
      ...group,
      explanation:
        recommendationExplanations.get(group.opportunityId) ??
        buildFallbackRecommendationExplanation({
          status: group.status,
          requiredReductionHoursPerWeek: group.requiredReductionHoursPerWeek,
          recommendationCount: group.recommendations.length,
          topRecommendation: group.recommendations[0]
            ? {
                targetMemberId: group.recommendations[0].targetMemberId,
                rationale: group.recommendations[0].evidence.rationale,
              }
            : null,
        }),
    })),
  };
}

async function maybeExplainReport(
  explainReport: GeneratePmoReportDeps['explainReport'],
  input: ExplainPmoReportInput,
): Promise<ExplainPmoReportOutput | null> {
  if (!explainReport) return null;
  try {
    return await explainReport(input);
  } catch (error) {
    console.warn('[pmo/report] explanation skipped:', error);
    return null;
  }
}

function buildExplanationRuleContext(evidence: ReportEvidence): ExplainPmoReportRuleContext {
  return {
    classification: {
      primaryMetric: 'N01',
      overbook: {
        warningAbove: evidence.ctx.thresholds.overbookThreshold,
        redAtOrAbove: evidence.ctx.thresholds.overbookRedThreshold,
      },
      idle: {
        redBelow: evidence.ctx.thresholds.idleThreshold,
        warningBelow: evidence.ctx.thresholds.idleYellowThreshold,
      },
      mismatchPctThreshold: evidence.ctx.thresholds.mismatchPctThreshold,
      otMaxHoursPerWeek: evidence.ctx.thresholds.otMaxHoursPerWeek,
    },
    metrics: {
      N01: 'planned_h / available_h',
      N02: evidence.reportRules?.metrics.N02.formula ?? 'worked_h / available_h',
      N03: evidence.reportRules?.metrics.N03.formula ?? 'billable_h / worked_h',
      N04: evidence.reportRules?.metrics.N04.formula ?? 'bench_h / available_h',
      N05: evidence.reportRules?.metrics.N05.formula ?? 'ot_h / standard_h',
      N06: evidence.reportRules?.metrics.N06.formula ?? 'actual_h / planned_h',
      N12: evidence.reportRules?.metrics.N12.formula ?? 'done / required',
    },
    recommendation: {
      enabled: evidence.reportRules?.recommendation.enabled ?? false,
      historyWindowDays: evidence.reportRules?.recommendation.historyWindowDays ?? null,
      transferStepHours: evidence.reportRules?.recommendation.transferStepHours ?? null,
      minimumSkillCoverage: evidence.reportRules?.recommendation.minimumSkillCoverage ?? null,
      idealTargetBusyRate: evidence.reportRules?.recommendation.idealTargetBusyRate ?? null,
      capacityFitTolerance: evidence.reportRules?.recommendation.capacityFitTolerance ?? null,
      candidateCountDefault: evidence.reportRules?.recommendation.candidateCount.default ?? null,
      candidateCountMin: evidence.reportRules?.recommendation.candidateCount.min ?? null,
      candidateCountMax: evidence.reportRules?.recommendation.candidateCount.max ?? null,
      scoring: evidence.reportRules?.recommendation.scoring ?? null,
    },
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
