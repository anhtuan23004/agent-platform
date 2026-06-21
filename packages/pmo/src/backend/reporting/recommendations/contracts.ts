import type { AllocationRow, Finding, MemberWeekFact, WeekRow } from '../../analytics/types.ts';
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
}

export interface RebalanceEvidence {
  facts: MemberWeekFact[];
  weeks: WeekRow[];
  allocations: AllocationRow[];
  members: RecommendationMember[];
  skills: MemberSkillEvidence[];
  taskHistory: TaskHistoryEvidence[];
}

export interface ScoreBreakdown {
  skillCoverage: number;
  taskHistorySimilarity: number;
  capacityFit: number;
  projectContext: number;
}

export interface RebalanceRecommendation {
  type: 'rebalance';
  sourceMemberId: string;
  targetMemberId: string;
  weekId: string;
  projectId: string;
  transferHours: number;
  score: number;
  confidence: RecommendationConfidence;
  rankWithinSource: number;
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
    capacityReason: string;
  };
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
}

export interface RebalanceRecommendationGroup {
  sourceMemberId: string;
  weekId: string;
  severity: 'yellow' | 'red';
  requiredReductionHours: number;
  status: RecommendationStatus;
  recommendations: RebalanceRecommendation[];
  noResultReasons: string[];
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
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
