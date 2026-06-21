import type { PmoReportRuleSet } from '../rules/schema.ts';
import type {
  RebalanceRecommendation,
  RecommendationConfidence,
  ScoreBreakdown,
} from './contracts.ts';

function contains(
  value: number,
  range: { gt?: number; gte?: number; lt?: number; lte?: number },
): boolean {
  return !(
    (range.gt !== undefined && value <= range.gt) ||
    (range.gte !== undefined && value < range.gte) ||
    (range.lt !== undefined && value >= range.lt) ||
    (range.lte !== undefined && value > range.lte)
  );
}

export function calculateCandidateScore(
  breakdown: ScoreBreakdown,
  rules: PmoReportRuleSet,
): number {
  const weights = rules.recommendation.scoring;
  return (
    breakdown.skillCoverage * weights.skillCoverage +
    breakdown.taskHistorySimilarity * weights.taskHistorySimilarity +
    breakdown.capacityFit * weights.capacityFit +
    breakdown.projectContext * weights.projectContext
  );
}

export function confidenceForScore(
  score: number,
  rules: PmoReportRuleSet,
): RecommendationConfidence {
  for (const confidence of ['high', 'medium', 'low'] as const) {
    if (contains(score, rules.recommendation.confidence[confidence])) return confidence;
  }
  return 'low';
}

export function stableRank(candidates: RebalanceRecommendation[]): RebalanceRecommendation[] {
  return candidates
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.scoreBreakdown.skillCoverage - a.scoreBreakdown.skillCoverage ||
        b.scoreBreakdown.taskHistorySimilarity - a.scoreBreakdown.taskHistorySimilarity ||
        a.targetMemberId.localeCompare(b.targetMemberId),
    )
    .map((candidate, index) => ({ ...candidate, rankWithinSource: index + 1 }));
}
