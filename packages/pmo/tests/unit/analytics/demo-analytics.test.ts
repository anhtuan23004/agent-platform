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
    expect(result.projectMemberDependencies.length).toBe(result.inputCounts.allocations);
    expect(result.projectMemberDependencies.every((row) => row.plannedHoursInWindow >= 0)).toBe(
      true,
    );
  });

  it('limits result facts and reporting window to the selected weeks', () => {
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
    const selectedWeek = fixture.weeks[0]!;

    const result = buildDemoAnalyticsResult(
      {
        members: fixture.members,
        projects: fixture.projects,
        allocations: fixture.allocations,
        timesheets: fixture.timesheets,
        leaves: fixture.leaves,
        weeks: [selectedWeek],
        configRows: [],
      },
      facts,
    );

    expect(result.memberWeekFacts.length).toBeGreaterThan(0);
    expect(result.memberWeekFacts.every((f) => f.weekId === selectedWeek.week_id)).toBe(true);
    expect(result.reportingWindow).toEqual({
      start: selectedWeek.week_start.toISOString().slice(0, 10),
      end: selectedWeek.week_end.toISOString().slice(0, 10),
    });
  });

  it('applies temporary threshold overrides to findings', () => {
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
      {
        thresholdOverrides: {
          overbookThreshold: 10,
          overbookRedThreshold: 11,
          idleThreshold: 0,
          mismatchPctThreshold: 10,
        },
      },
    );

    expect(result.thresholds.overbookThreshold).toBe(10);
    expect(result.overbookIdleFindings).toHaveLength(0);
    expect(result.mismatchFindings).toHaveLength(0);
  });

  it('selects the threshold config active on the requested effective date', () => {
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

    const canonical = {
      members: fixture.members,
      projects: fixture.projects,
      allocations: fixture.allocations,
      timesheets: fixture.timesheets,
      leaves: fixture.leaves,
      weeks: fixture.weeks,
      configRows: [
        {
          config_id: 'seta-08-sop-001-2026-01-01',
          rule_name: 'SETA-08-SOP-001 RAG thresholds',
          overbook_threshold: 1.2,
          overbook_red_threshold: 1.4,
          idle_threshold: 0.5,
          mismatch_pct_threshold: 0.2,
          ot_max_hours_per_week: 48,
          required_training_hours: 0,
          effective_date: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          config_id: 'seta-08-sop-001-2026-06-29',
          rule_name: 'SETA-08-SOP-001 RAG thresholds',
          overbook_threshold: 1.1,
          overbook_red_threshold: 1.2,
          idle_threshold: 0.75,
          mismatch_pct_threshold: 0.2,
          ot_max_hours_per_week: 48,
          required_training_hours: 0,
          effective_date: new Date('2026-06-29T00:00:00.000Z'),
        },
      ],
    };

    const beforeChange = buildDemoAnalyticsResult(canonical, facts, {
      configEffectiveDate: new Date('2026-06-28T00:00:00.000Z'),
    });
    const afterChange = buildDemoAnalyticsResult(canonical, facts, {
      configEffectiveDate: new Date('2026-06-29T00:00:00.000Z'),
    });

    expect(beforeChange.thresholdConfig.effectiveDate).toBe('2026-01-01');
    expect(beforeChange.thresholds.overbookThreshold).toBe(1.2);
    expect(afterChange.thresholdConfig.effectiveDate).toBe('2026-06-29');
    expect(afterChange.thresholds.overbookThreshold).toBe(1.1);
    expect(afterChange.thresholds.idleThreshold).toBe(0.75);
  });
});
