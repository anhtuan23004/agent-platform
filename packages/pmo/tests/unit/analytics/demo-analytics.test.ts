import { describe, expect, it } from 'vitest';
import { buildDemoAnalyticsResult } from '../../../src/backend/analytics/demo-analytics.ts';
import { buildPmo02AnswerKeyFixture } from '../../../src/backend/demo/pmo-02.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function canonicalFromFixture(
  fixture: ReturnType<typeof buildPmo02AnswerKeyFixture>,
  weeks = fixture.weeks,
) {
  return {
    members: fixture.members,
    projects: fixture.projects,
    allocations: fixture.allocations,
    timesheets: fixture.timesheets,
    leaves: fixture.leaves,
    weeks,
    configRows: [],
  };
}

describe('buildDemoAnalyticsResult', () => {
  it('PMO_02 project-grain facts produce utilization findings', () => {
    const fixture = buildPmo02AnswerKeyFixture();

    const result = buildDemoAnalyticsResult(canonicalFromFixture(fixture));

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
    expect(
      result.projectMemberDependencies.some(
        (row) => row.projectStartDate != null && row.projectEndDate != null,
      ),
    ).toBe(true);
    expect(result.memberWeekProjectFacts.length).toBeGreaterThan(result.memberWeekFacts.length);
  });

  it('limits result facts and reporting window to the selected weeks', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const selectedWeek = fixture.weeks[0]!;

    const result = buildDemoAnalyticsResult(canonicalFromFixture(fixture, [selectedWeek]));

    expect(result.memberWeekFacts.length).toBeGreaterThan(0);
    expect(result.memberWeekFacts.every((f) => f.weekId === selectedWeek.week_id)).toBe(true);
    expect(result.reportingWindow).toEqual({
      start: selectedWeek.week_start.toISOString().slice(0, 10),
      end: selectedWeek.week_end.toISOString().slice(0, 10),
    });
  });

  it('uses the selected date range for reportingWindow metadata', () => {
    const fixture = buildPmo02AnswerKeyFixture();

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
      { dateRange: { from: d('2026-06-29'), to: d('2026-07-07') } },
    );

    expect(result.reportingWindow).toEqual({ start: '2026-06-29', end: '2026-07-07' });
  });

  it('applies temporary threshold overrides to findings', () => {
    const fixture = buildPmo02AnswerKeyFixture();

    const result = buildDemoAnalyticsResult(canonicalFromFixture(fixture), {
      thresholdOverrides: {
        overbookThreshold: 10,
        overbookRedThreshold: 11,
        idleThreshold: 0,
        mismatchPctThreshold: 10,
      },
    });

    expect(result.thresholds.overbookThreshold).toBe(10);
    expect(result.overbookIdleFindings).toHaveLength(0);
    expect(result.mismatchFindings).toHaveLength(0);
  });

  it('selects the threshold config active on the requested effective date', () => {
    const fixture = buildPmo02AnswerKeyFixture();

    const canonical = {
      ...canonicalFromFixture(fixture),
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

    const beforeChange = buildDemoAnalyticsResult(canonical, {
      configEffectiveDate: new Date('2026-06-28T00:00:00.000Z'),
    });
    const afterChange = buildDemoAnalyticsResult(canonical, {
      configEffectiveDate: new Date('2026-06-29T00:00:00.000Z'),
    });

    expect(beforeChange.thresholdConfig.effectiveDate).toBe('2026-01-01');
    expect(beforeChange.thresholds.overbookThreshold).toBe(1.2);
    expect(afterChange.thresholdConfig.effectiveDate).toBe('2026-06-29');
    expect(afterChange.thresholds.overbookThreshold).toBe(1.1);
    expect(afterChange.thresholds.idleThreshold).toBe(0.75);
  });

  it('rolls member-week totals up from member-week-project rows', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const result = buildDemoAnalyticsResult(canonicalFromFixture(fixture));

    for (const weekFact of result.memberWeekFacts) {
      const projectRows = result.memberWeekProjectFacts.filter(
        (row) =>
          row.memberId === weekFact.memberId &&
          row.weekId === weekFact.weekId &&
          row.scopeStatus === 'IN_SCOPE',
      );
      const planned = projectRows.reduce((sum, row) => sum + row.plannedHours, 0);
      expect(weekFact.plannedHours).toBeCloseTo(planned, 4);
    }
  });
});
