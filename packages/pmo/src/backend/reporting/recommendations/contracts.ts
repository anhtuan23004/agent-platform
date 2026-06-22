import type { AllocationRow, Finding, MemberWeekFact, WeekRow } from '../../analytics/types.ts';
import type { RecommendationGroupExplanation } from '../explanation-types.ts';
import type { PmoReportRuleSet } from '../rules/schema.ts';

export type RecommendationStatus = 'full_solution' | 'partial_relief' | 'no_valid_rebalance_found';
export type RecommendationConfidence = 'high' | 'medium' | 'low';

export interface MemberSkillEvidence {
  memberId: string;
  skillKey: string;
  proficiencyLevel: number | null;
  evidenceConfidence: number;
  sourceVersion: string;
}

export interface TaskHistoryEvidence {
  historyId: string;
  memberId: string;
  projectId: string | null;
  allocationRole: string | null;
  taskTitle: string;
  taskSummary: string | null;
  skillTags: string[];
  completedAt: Date;
  evidenceConfidence: number;
  embedding: number[] | null;
  embeddingModelId: string | null;
  embeddingSourceHash: string | null;
  sourceVersion: string;
}

export interface RecommendationMember {
  memberId: string;
  department: string | null;
  roleTitle: string | null;
  level: string | null;
  lineManagerId: string | null;
  employmentStatus: string | null;
  employmentType: string | null;
  stdHoursWeek: number | null;
  joinDate: Date | null;
}

export interface RecommendationProject {
  projectId: string;
  projectName: string;
  accountId: string | null;
  projectType: string | null;
  projectDomain: string | null;
  status: string | null;
  pmId: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export interface RecommendationWindow {
  evidenceFrom: Date;
  evidenceTo: Date;
  planningStart: Date;
  planningEnd: Date | null;
}

export interface RebalanceEvidence {
  window: RecommendationWindow;
  facts: MemberWeekFact[];
  weeks: WeekRow[];
  allocations: AllocationRow[];
  members: RecommendationMember[];
  projects: RecommendationProject[];
  skills: MemberSkillEvidence[];
  taskHistory: TaskHistoryEvidence[];
}

export interface RecommendationRiskSummary {
  memberId: string;
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  utilization: number | null;
  effortConsumption: number | null;
  overtimeRatio: number | null;
  trainingHours: number;
  benchHours: number;
}

export interface AllocationSegment {
  memberId: string;
  projectId: string;
  role: string | null;
  from: Date;
  to: Date;
  allocationPct: number;
  weeklyPlannedHours: number | null;
}

export interface MemberAllocationPeriod {
  memberId: string;
  from: Date;
  to: Date;
  totalAllocationPct: number;
  projects: Array<{
    projectId: string;
    role: string | null;
    allocationPct: number;
    weeklyPlannedHours: number | null;
  }>;
}

export interface RebalanceOpportunity {
  opportunityId: string;
  sourceMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  severity: 'warning' | 'red';
  activePeriod: {
    from: Date;
    to: Date;
  };
  planningPeriod: {
    from: Date;
    to: Date | null;
  };
  currentRaBusyRate: number;
  sourceTargetBusyRate: number;
  candidateSoftCeiling: number;
  candidateHardCeiling: number;
  allowPartialRelief: boolean;
  reliefNeededPct: number;
  reliefNeededHoursPerWeek: number;
  sourceRiskFlags: string[];
  sourceValidation: {
    utilization: number | null;
    effortConsumption: number | null;
    overtimeRatio: number | null;
  };
  requiresRaConfirmation: boolean;
}

export type CandidateRejectionReason =
  | 'inactive_member'
  | 'no_planning_overlap'
  | 'no_spare_capacity'
  | 'leave_conflict'
  | 'training_conflict'
  | 'actual_utilization_too_high'
  | 'ot_risk_too_high'
  | 'role_mismatch'
  | 'skill_coverage_below_threshold';

export interface CandidateSlot {
  opportunityId?: string;
  memberId: string;
  roleTitle: string | null;
  allocationRoleSet: string[];
  activePeriod: {
    from: Date;
    to: Date;
  };
  planningOverlap: {
    from: Date;
    to: Date;
  } | null;
  currentRaBusyRate: number;
  targetRaBusyRate: number;
  availableCapacityPct: number;
  availableCapacityHoursPerWeek: number;
  actualUtilization: number | null;
  effortConsumption: number | null;
  overtimeRatio: number | null;
  leaveConflict: boolean;
  trainingConflict: boolean;
  candidateRiskFlags: string[];
  rejectionReasons: CandidateRejectionReason[];
}

export interface ScoreBreakdown {
  skillMatch: number;
  historyMatch: number;
  roleContextMatch: number;
  capacityFit: number;
  riskAdjustment: number;
}

export interface RebalanceRecommendation {
  type: 'rebalance';
  sourceMemberId: string;
  targetMemberId: string;
  opportunityId: string;
  projectId: string;
  roleNeeded: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  transferPct: number;
  transferHoursPerWeek: number;
  score: number;
  confidence: RecommendationConfidence;
  rankWithinOpportunity: number;
  portfolioSelected: boolean;
  mutuallyExclusiveAlternative: boolean;
  beforeAfter: {
    sourceBeforeBusyRate: number;
    sourceAfterBusyRate: number;
    targetBeforeBusyRate: number;
    targetAfterBusyRate: number;
  };
  scoreBreakdown: ScoreBreakdown;
  evidence: {
    matchedSkills: string[];
    missingSkills: string[];
    similarPastTasks: string[];
    sourceRiskFlags: string[];
    candidateRiskFlags: string[];
    rationale: string;
  };
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
}

export interface RebalanceRecommendationGroup {
  opportunityId: string;
  sourceMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  severity: 'warning' | 'red';
  evidenceWindow: {
    from: string;
    to: string;
  };
  planningPeriod: {
    from: string;
    to: string | null;
  };
  currentRaBusyRate: number;
  targetRaBusyRate: number;
  requiredReductionPct: number;
  requiredReductionHoursPerWeek: number;
  status: RecommendationStatus;
  requiresRaConfirmation: boolean;
  recommendations: RebalanceRecommendation[];
  noResultReasons: string[];
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
  explanation?: RecommendationGroupExplanation;
  evidenceVersions: {
    sourceVersions: string[];
    embeddingModelIds: string[];
    embeddingSourceHashes: string[];
  };
}

export interface GenerateRecommendationsInput {
  findings: Finding[];
  evidence: RebalanceEvidence;
  rules: PmoReportRuleSet;
  effectiveAt: Date;
  candidateCount?: number;
}

export function validateCandidateCount(
  requested: number | undefined,
  rules: PmoReportRuleSet,
): number {
  const config = rules.recommendation.candidateCount;
  const value = requested ?? config.default;
  if (!Number.isInteger(value) || value < config.min || value > config.max) {
    throw new Error(`invalid_recommendation_candidate_count:${value}`);
  }
  return value;
}
