import { describe, expect, it } from 'vitest';
import { buildDemoAnalyticsResult } from '../../../src/backend/analytics/demo-analytics.ts';
import { buildPmo02AnswerKeyFixture } from '../../../src/backend/demo/pmo-02.ts';

describe('buildDemoAnalyticsResult', () => {
  it('PMO_02 inputs pass all Answer Key rows', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const result = buildDemoAnalyticsResult(
      fixture.members,
      fixture.projects,
      fixture.allocations,
      fixture.timesheets,
      fixture.leaves,
      fixture.weeks,
      [],
    );

    expect(result.totalAnswerKey).toBe(10);
    expect(result.passCount).toBe(10);
    expect(result.overbookIdleFindings.length).toBeGreaterThan(0);
    expect(result.memberWeekFacts.length).toBeGreaterThan(0);
    expect(result.canonical.members.length).toBe(10);
    expect(result.populations.deliveryMembers.length).toBe(10);
    expect(result.populations.projectManagers.length).toBe(0);
    expect(result.projectMemberDependencies.length).toBeGreaterThan(0);
    expect(result.answerKey.every((r) => r.match)).toBe(true);
  });
});
