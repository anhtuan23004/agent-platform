import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { FindingExplanation, RecommendationGroupExplanation } from '../explanation-types.ts';
import type { ExplainPmoReportInput, ExplainPmoReportOutput } from '../report-output.ts';

const issueTypeSchema = z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']);

const findingExplanationSchema = z.object({
  memberId: z.string().min(1),
  issueType: issueTypeSchema,
  explanation: z.object({
    summary: z.string().min(1),
    riskTradeoffs: z.array(z.string().min(1)).max(4),
  }),
});

const recommendationExplanationSchema = z.object({
  opportunityId: z.string().min(1),
  explanation: z.object({
    summary: z.string().min(1),
    riskTradeoffs: z.array(z.string().min(1)).max(4),
    topChoiceReason: z.string().min(1).nullable(),
    alternativesComparison: z.string().min(1).nullable(),
  }),
});

const reportExplanationSchema = z.object({
  findings: z.array(findingExplanationSchema),
  recommendations: z.array(recommendationExplanationSchema),
});

const REPORT_EXPLANATION_PROMPT = `You explain deterministic PMO report results.

You are writing explanation text for PMO managers and delivery leads.

You will receive findings and rebalance recommendations that were already decided by code, plus the classification and recommendation rules that were applied.

Rules:
- Do not change, override, soften, or reinterpret issue type, severity, rank, score, transfer amount, or candidate ordering.
- Do not invent new findings, new recommendations, or new evidence.
- Treat all metrics and recommendations as deterministic facts decided upstream.
- When explaining overbook, idle, or mismatch, explicitly anchor the explanation to the provided thresholds, formulas, and the member's own metrics.
- For overbook and idle findings, explain which rule band the member fell into and cite the most relevant values such as busy rate, utilization, effort consumption, overtime, bench, affected weeks, or exclusions when available.
- For recommendations, explain why the top-ranked option is stronger using only deterministic evidence such as skill match, history match, role context, capacity fit, risk flags, score breakdown, and planning period.
- If there are alternatives, explain briefly why they rank lower. If there is no valid candidate, explain the blocking gap honestly.
- Mention practical risk or tradeoff, but do not turn explanation into a new recommendation policy.
- Write concise, concrete, business-facing prose suitable for a PMO report.
- If a recommendation group has no candidates, explain the gap without pretending a solution exists.

Return structured output only.`;

function resolveExplanationModel(): string {
  const direct = process.env.PMO_PLAN_MODEL?.trim();
  if (direct) return direct;

  const defaultModel = process.env.AGENT_MODEL_DEFAULT?.trim();
  if (defaultModel && defaultModel !== 'auto') return defaultModel;

  const catalogRaw = process.env.AGENT_MODELS?.trim();
  if (catalogRaw) {
    const first = catalogRaw
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)[0];
    if (first) {
      const tierSuffixMatch = first.match(/:(fast|balanced|reasoning)$/);
      if (tierSuffixMatch) return first.slice(0, -tierSuffixMatch[0].length);
      return first;
    }
  }

  return 'openai/gpt-5.5';
}

export async function explainPmoReportWithLlm(
  input: ExplainPmoReportInput,
): Promise<ExplainPmoReportOutput | null> {
  if (input.findings.length === 0 && input.recommendations.length === 0) {
    return { findings: [], recommendations: [] };
  }

  const explainer = new Agent({
    id: 'pmo.reportExplainer',
    name: 'PMO Report Explainer',
    instructions: REPORT_EXPLANATION_PROMPT,
    model: resolveExplanationModel(),
  });

  const result = await explainer.generate(JSON.stringify(buildPromptPayload(input)), {
    structuredOutput: { schema: reportExplanationSchema },
    providerOptions: { openai: { reasoningSummary: 'auto' } },
  });

  return normalizeExplanationOutput(input, result.object ?? null);
}

function buildPromptPayload(input: ExplainPmoReportInput) {
  return {
    report_date_range: input.dateRange,
    summary: input.summary,
    rule_context: input.ruleContext,
    members: input.members,
    findings: input.findings.map((finding) => ({
      memberId: finding.memberId,
      memberProfile: input.members.find((member) => member.memberId === finding.memberId) ?? null,
      issueType: finding.issueType,
      ragColor: finding.ragColor,
      busyRate: finding.busyRate,
      effortConsumption: finding.effortConsumption,
      detail: finding.detail,
      issueWeeks: finding.issueWeeks ?? [],
      excludedWeeks: finding.excludedWeeks,
      annotations: finding.annotations,
      metricEvidence: finding.metricEvidence,
      suggestedActionCode: finding.suggestedActionCode,
      suggestedActions: finding.suggestedActions,
    })),
    recommendations: input.recommendations.map((group) => ({
      opportunityId: group.opportunityId,
      sourceMemberProfile:
        input.members.find((member) => member.memberId === group.sourceMemberId) ?? null,
      sourceMemberId: group.sourceMemberId,
      projectId: group.projectId,
      roleNeeded: group.roleNeeded,
      severity: group.severity,
      planningPeriod: group.planningPeriod,
      currentRaBusyRate: group.currentRaBusyRate,
      targetRaBusyRate: group.targetRaBusyRate,
      requiredReductionPct: group.requiredReductionPct,
      requiredReductionHoursPerWeek: group.requiredReductionHoursPerWeek,
      status: group.status,
      requiresRaConfirmation: group.requiresRaConfirmation,
      noResultReasons: group.noResultReasons,
      dataQualityFlags: group.dataQualityFlags,
      recommendations: group.recommendations.map((recommendation) => ({
        targetMemberProfile:
          input.members.find((member) => member.memberId === recommendation.targetMemberId) ?? null,
        targetMemberId: recommendation.targetMemberId,
        rankWithinOpportunity: recommendation.rankWithinOpportunity,
        transferPct: recommendation.transferPct,
        transferHoursPerWeek: recommendation.transferHoursPerWeek,
        score: recommendation.score,
        confidence: recommendation.confidence,
        portfolioSelected: recommendation.portfolioSelected,
        beforeAfter: recommendation.beforeAfter,
        scoreBreakdown: recommendation.scoreBreakdown,
        evidence: recommendation.evidence,
      })),
    })),
  };
}

function normalizeExplanationOutput(
  input: ExplainPmoReportInput,
  raw: z.infer<typeof reportExplanationSchema> | null,
): ExplainPmoReportOutput {
  if (!raw) return { findings: [], recommendations: [] };

  const validFindingKeys = new Set(
    input.findings.map((finding) => `${finding.memberId}:${finding.issueType}`),
  );
  const validOpportunityIds = new Set(input.recommendations.map((group) => group.opportunityId));

  return {
    findings: raw.findings.filter((item) =>
      validFindingKeys.has(`${item.memberId}:${item.issueType}`),
    ),
    recommendations: raw.recommendations.filter((item) =>
      validOpportunityIds.has(item.opportunityId),
    ),
  };
}

export function buildFallbackFindingExplanation(input: {
  issueType: string;
  busyRate: number | null;
  effortConsumption: number | null;
  detail: string;
}): FindingExplanation {
  const busy = input.busyRate === null ? 'N/A' : `${Math.round(input.busyRate * 1000) / 10}%`;
  const effort =
    input.effortConsumption === null
      ? 'N/A'
      : `${Math.round(input.effortConsumption * 1000) / 10}%`;
  return {
    summary: `${input.detail} Deterministic evidence shows busy rate ${busy} and effort consumption ${effort}.`,
    riskTradeoffs: fallbackFindingTradeoffs(input.issueType),
  };
}

export function buildFallbackRecommendationExplanation(input: {
  status: string;
  requiredReductionHoursPerWeek: number;
  recommendationCount: number;
  topRecommendation: {
    targetMemberId: string;
    rationale: string;
  } | null;
}): RecommendationGroupExplanation {
  return {
    summary:
      input.status === 'no_valid_rebalance_found'
        ? `No deterministic candidate cleared the hard filters for ${round2(input.requiredReductionHoursPerWeek)}h/week of relief.`
        : `Deterministic ranking found ${input.recommendationCount} candidate option${input.recommendationCount === 1 ? '' : 's'} for ${round2(input.requiredReductionHoursPerWeek)}h/week of relief.`,
    riskTradeoffs:
      input.status === 'no_valid_rebalance_found'
        ? ['Review future RA demand and candidate evidence before forcing a transfer.']
        : ['Apply only the ranked transfer amount and re-check future RA plus actual utilization.'],
    topChoiceReason: input.topRecommendation?.rationale ?? null,
    alternativesComparison:
      input.recommendationCount > 1
        ? 'Lower-ranked alternatives fit less cleanly on skill, history, capacity, or risk evidence.'
        : null,
  };
}

function fallbackFindingTradeoffs(issueType: string): string[] {
  if (issueType === 'overbook') {
    return [
      'High allocation can increase delivery risk if actual workload stays elevated.',
      'Transfer decisions should still respect role fit and future project demand.',
    ];
  }
  if (issueType === 'idle') {
    return [
      'Spare RA does not automatically mean the member should receive more work.',
      'Validate skill fit and actual utilization before assigning additional allocation.',
    ];
  }
  return [
    'Review the mismatch against RA and timesheet evidence before changing the staffing plan.',
  ];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
