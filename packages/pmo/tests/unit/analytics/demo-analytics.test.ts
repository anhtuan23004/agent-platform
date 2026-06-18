import { describe, expect, it } from 'vitest';
import { buildDemoAnalyticsResult } from '../../../src/backend/analytics/demo-analytics.ts';
import { buildMemberWeekFacts } from '../../../src/backend/analytics/member-week-facts.ts';
import { splitPmoPopulations } from '../../../src/backend/analytics/populations.ts';
import { resolveThresholds } from '../../../src/backend/analytics/thresholds.ts';
import { buildPmo02AnswerKeyFixture } from '../../../src/backend/demo/pmo-02.ts';

describe('buildDemoAnalyticsResult', () => {
  it('PMO_02 persisted facts produce utilization findings', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const thresholds = resolveThresholds([]);
    const { deliveryMembers } = splitPmoPopulations(fixture.members, fixture.projects);
    const facts = buildMemberWeekFacts({
      members: deliveryMembers,
      allocations: fixture.allocations,
      timesheets: fixture.timesheets,
      leaves: fixture.leaves,
      weeks: fixture.weeks,
      thresholds,
    });

    const result = buildDemoAnalyticsResult(
      {
        members: fixture.members,
        projects: fixture.projects,
        allocations: fixture.allocations,
        timesheets: fixture.timesheets,
        leaves: fixture.leaves,
        weeks: fixture.weeks,
        configRows: [],
      },
      facts,
    );

    expect(result.overbookIdleFindings.length).toBeGreaterThan(0);
    expect(result.memberWeekFacts.length).toBeGreaterThan(0);
    expect(result.canonical.members.length).toBe(10);
    expect(result.populations.deliveryMembers.length).toBe(10);
    expect(result.populations.projectManagers.length).toBe(0);
    expect(result.projectMemberDependencies.length).toBeGreaterThan(0);
  });
});
