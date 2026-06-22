import { describe, expect, it } from 'vitest';
import {
  buildFallbackFindingExplanation,
  buildFallbackRecommendationExplanation,
} from '../../../src/backend/reporting/explanations/report-explanations.ts';

describe('report explanations', () => {
  it('builds deterministic fallback explanation for findings', () => {
    const value = buildFallbackFindingExplanation({
      issueType: 'overbook',
      busyRate: 1.25,
      effortConsumption: 1.1,
      detail: 'Overbooked allocation detected.',
    });

    expect(value.summary).toContain('Overbooked allocation detected.');
    expect(value.summary).toContain('125%');
    expect(value.riskTradeoffs).toContain(
      'High allocation can increase delivery risk if actual workload stays elevated.',
    );
  });

  it('builds deterministic fallback explanation for recommendation groups', () => {
    const value = buildFallbackRecommendationExplanation({
      status: 'partial_relief',
      requiredReductionHoursPerWeek: 6,
      recommendationCount: 3,
      topRecommendation: {
        targetMemberId: 'EMP-118',
        rationale: 'Move 15% allocation to the candidate with the strongest fit.',
      },
    });

    expect(value.summary).toContain('3 candidate options');
    expect(value.topChoiceReason).toBe(
      'Move 15% allocation to the candidate with the strongest fit.',
    );
    expect(value.alternativesComparison).toContain('Lower-ranked alternatives');
  });

  it('keeps fallback idle explanation tied to member metrics instead of generic advice', () => {
    const value = buildFallbackFindingExplanation({
      issueType: 'idle',
      busyRate: 0.6,
      effortConsumption: 0.95,
      detail: 'Idle allocation detected.',
    });

    expect(value.summary).toContain('60%');
    expect(value.summary).toContain('95%');
    expect(value.riskTradeoffs).toContain(
      'Spare RA does not automatically mean the member should receive more work.',
    );
  });
});
