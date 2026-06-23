import type { Finding } from '../analytics/types.ts';
import type { FindingExplanation, RecommendationGroupExplanation } from './explanation-types.ts';
import type { ForwardAllocationRecommendationRow } from './forward-allocation/contracts.ts';
import type { RebalanceRecommendationGroup } from './recommendations/contracts.ts';

export interface PmoReportDateRange {
  from: string;
  to: string;
}

export interface ExplainPmoReportRuleContext {
  classification: {
    primaryMetric: 'N01';
    overbook: {
      warningAbove: number;
      redAtOrAbove: number;
    };
    idle: {
      redBelow: number;
      warningBelow: number;
    };
    mismatchPctThreshold: number;
    otMaxHoursPerWeek: number;
  };
  metrics: {
    N01: string;
    N02: string;
    N03: string;
    N04: string;
    N05: string;
    N06: string;
    N12: string;
  };
  recommendation: {
    enabled: boolean;
    historyWindowDays: number | null;
    transferStepHours: number | null;
    minimumSkillCoverage: number | null;
    idealTargetBusyRate: number | null;
    capacityFitTolerance: number | null;
    candidateCountDefault: number | null;
    candidateCountMin: number | null;
    candidateCountMax: number | null;
    scoring: {
      skillMatch: number;
      historyMatch: number;
      roleContextMatch: number;
      capacityFit: number;
      riskAdjustment: number;
    } | null;
  };
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

export interface PmoReportMemberSummary {
  memberId: string;
  fullName: string;
  department: string | null;
  roleTitle: string | null;
}

export interface ReportSourceVersion {
  factsVersion: string;
  canonicalDataVersion: string;
  factsComputedAt: string;
}

export type PmoReportFinding = Pick<
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
  explanation?: FindingExplanation;
};

export interface WorkloadReportOutput {
  reportFamily: 'workload';
  dateRange: PmoReportDateRange;
  sourceVersion: ReportSourceVersion;
  summary: {
    memberCount: number;
    overbookCount: number;
    idleCount: number;
    excludedWeekCount: number;
  };
  members: PmoReportMemberSummary[];
  findings: PmoReportFinding[];
  recommendations: RebalanceRecommendationGroup[];
}

export interface ForwardAllocationReportMemberSummary extends PmoReportMemberSummary {}

export interface ForwardAllocationReportOutput {
  reportFamily: 'forward_allocation';
  dateRange: PmoReportDateRange;
  planningHorizon: PmoReportDateRange;
  sourceVersion: ReportSourceVersion;
  recommendationModeSummary: {
    demandBacked: number;
    inferred: number;
  };
  summary: {
    memberAvailabilityCount: number;
    activeDemandWindowCount: number;
    demandBackedRecommendationCount: number;
    inferredRecommendationCount: number;
    releaseWarningCount: number;
  };
  members: ForwardAllocationReportMemberSummary[];
  rows: ForwardAllocationRecommendationRow[];
}

export type GeneratePmoReportOutput = WorkloadReportOutput | ForwardAllocationReportOutput;

export interface ExplainPmoReportInput {
  dateRange: PmoReportDateRange;
  summary: WorkloadReportOutput['summary'];
  members: WorkloadReportOutput['members'];
  findings: WorkloadReportOutput['findings'];
  recommendations: RebalanceRecommendationGroup[];
  ruleContext: ExplainPmoReportRuleContext;
}

export interface ExplainPmoReportOutput {
  findings: Array<{
    memberId: string;
    issueType: Finding['issueType'];
    explanation: FindingExplanation;
  }>;
  recommendations: Array<{
    opportunityId: string;
    explanation: RecommendationGroupExplanation;
  }>;
}
