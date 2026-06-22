import { describe, expect, it } from 'vitest';
import { weekCoverageFraction } from '../../../src/backend/analytics/dates.ts';
import { buildDemoAnalyticsResult } from '../../../src/backend/analytics/demo-analytics.ts';
import { detectMismatch } from '../../../src/backend/analytics/findings.ts';
import { buildMemberWeekFacts } from '../../../src/backend/analytics/member-week-facts.ts';
import { DEFAULT_THRESHOLDS } from '../../../src/backend/analytics/types.ts';
import { buildPmo02AnswerKeyFixture } from '../../../src/backend/demo/pmo-02.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('weekCoverageFraction', () => {
  it('returns 1 for a week fully inside the range', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const w1 = fixture.weeks[0]!;
    expect(weekCoverageFraction(w1, { from: d('2026-06-29'), to: d('2026-07-07') })).toBe(1);
  });

  it('returns partial coverage when the range ends mid-week', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const w2 = fixture.weeks[1]!;
    expect(weekCoverageFraction(w2, { from: d('2026-06-29'), to: d('2026-07-07') })).toBe(0.4);
  });
});

describe('date-range proration', () => {
  const range = { from: d('2026-06-29'), to: d('2026-07-07') };

  function dailyEmp001Timesheets() {
    const rows = [];
    for (const day of [
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-06',
      '2026-07-07',
    ]) {
      rows.push({
        member_id: 'EMP-001',
        work_date: d(day),
        logged_hours: 4.5,
        project_id: 'PRJ-001',
      });
      rows.push({
        member_id: 'EMP-001',
        work_date: d(day),
        logged_hours: 4.5,
        project_id: 'PRJ-003',
      });
    }
    return rows;
  }

  it('keeps effort consumption stable when daily logs only cover days inside the range', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const timesheets = fixture.timesheets
      .filter((row) => row.member_id !== 'EMP-001')
      .concat(dailyEmp001Timesheets())
      .filter((row) => row.work_date >= range.from && row.work_date <= range.to);
    const weeks = fixture.weeks.filter(
      (week) => week.week_start <= range.to && week.week_end >= range.from,
    );

    const facts = buildMemberWeekFacts({
      members: fixture.members.filter((member) => member.member_id === 'EMP-001'),
      allocations: fixture.allocations.filter((allocation) => allocation.member_id === 'EMP-001'),
      timesheets,
      leaves: fixture.leaves,
      weeks,
      thresholds: DEFAULT_THRESHOLDS,
      projects: fixture.projects,
      dateRange: range,
    });

    const w1 = facts.find((fact) => fact.weekId === 'W1');
    const w2 = facts.find((fact) => fact.weekId === 'W2');
    expect(w1?.effortConsumption).toBeCloseTo(0.9783, 3);
    expect(w2?.effortConsumption).toBeCloseTo(0.9783, 3);
    expect(
      detectMismatch(facts, {
        leaves: [],
        weeksById: new Map(weeks.map((w) => [w.week_id, w])),
        thresholds: DEFAULT_THRESHOLDS,
      }),
    ).toHaveLength(0);
  });

  it('prorates boundary-week plan when the range ends mid-week', () => {
    const fixture = buildPmo02AnswerKeyFixture();
    const timesheets = dailyEmp001Timesheets().filter(
      (row) => row.work_date >= range.from && row.work_date <= range.to,
    );
    const result = buildDemoAnalyticsResult(
      {
        members: fixture.members,
        projects: fixture.projects,
        allocations: fixture.allocations,
        timesheets,
        leaves: fixture.leaves.filter(
          (row) => row.leave_date >= range.from && row.leave_date <= range.to,
        ),
        weeks: fixture.weeks.filter(
          (week) => week.week_start <= range.to && week.week_end >= range.from,
        ),
        configRows: [],
      },
      { dateRange: range },
    );

    const w2 = result.memberWeekFacts.find(
      (fact) => fact.memberId === 'EMP-001' && fact.weekId === 'W2',
    );
    expect(w2?.plannedHours).toBeCloseTo(18.4, 1);
    expect(w2?.loggedHours).toBe(18);
    expect(result.mismatchFindings.some((finding) => finding.memberId === 'EMP-001')).toBe(false);
  });
});
