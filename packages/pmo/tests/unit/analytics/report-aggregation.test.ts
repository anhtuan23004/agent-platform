import { describe, expect, it } from 'vitest';
import {
  analyzeMembers,
  buildSuggestedActions,
  classifySupportingMetrics,
  detectOverbookIdle,
  type FindingsContext,
} from '../../../src/backend/analytics/findings.ts';
import type {
  LeaveRow,
  MemberWeekFact,
  Thresholds,
  WeekRow,
} from '../../../src/backend/analytics/types.ts';
import { loadPmoReportRuleCatalog } from '../../../src/backend/reporting/rules/load.ts';

const THRESHOLDS: Thresholds = {
  overbookThreshold: 1.1,
  overbookRedThreshold: 1.2,
  idleThreshold: 0.75,
  idleYellowThreshold: 0.85,
  mismatchPctThreshold: 0.2,
  otMaxHoursPerWeek: 48,
  requiredTrainingHours: 0,
};

function fact(weekId: string, availableHours: number, plannedHours: number): MemberWeekFact {
  return {
    memberId: 'EMP-001',
    weekId,
    scopeStatus: 'IN_SCOPE',
    availableHours,
    plannedHours,
    loggedHours: plannedHours,
    expectedLoggedHours: plannedHours,
    billableHours: plannedHours,
    benchHours: Math.max(0, availableHours - plannedHours),
    overtimeHours: 0,
    trainingHours: 0,
    busyRate: availableHours > 0 ? plannedHours / availableHours : null,
    utilization: availableHours > 0 ? plannedHours / availableHours : null,
    billableRate: 1,
    benchRate:
      availableHours > 0 ? Math.max(0, availableHours - plannedHours) / availableHours : null,
    overtimeRatio: 0,
    effortConsumption: plannedHours > 0 ? 1 : null,
    trainingCompliance: null,
    ragColor: 'green',
    issueType: 'ok',
  };
}

function week(id: string, start: string, holidayHours = 0): WeekRow {
  const weekStart = new Date(`${start}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return {
    week_id: id,
    week_start: weekStart,
    week_end: weekEnd,
    working_days: holidayHours > 0 ? 4 : 5,
    holiday_hours_ft: holidayHours,
  };
}

function context(weeks: WeekRow[], leaves: LeaveRow[] = []): FindingsContext {
  return {
    leaves,
    weeksById: new Map(weeks.map((item) => [item.week_id, item])),
    thresholds: THRESHOLDS,
  };
}

describe('member report aggregation', () => {
  it('uses ratio-of-sums instead of mean weekly ratios', () => {
    const weeks = [week('W1', '2026-06-29'), week('W2', '2026-07-06')];
    const analysis = analyzeMembers([fact('W1', 8, 8), fact('W2', 40, 32)], context(weeks))[0];

    expect(analysis?.busyRate).toBeCloseTo(40 / 48, 4);
    const finding = detectOverbookIdle([fact('W1', 8, 8), fact('W2', 40, 32)], context(weeks))[0];
    expect(finding).toMatchObject({ issueType: 'idle', ragColor: 'yellow' });
  });

  it('keeps partial-holiday, approved-OT, and training weeks with annotations', () => {
    const weeks = [week('W1', '2026-06-29', 8), week('W2', '2026-07-06')];
    const leaves: LeaveRow[] = [
      {
        member_id: 'EMP-001',
        leave_date: new Date('2026-06-30T00:00:00.000Z'),
        leave_type: 'Training',
        approved: true,
        duration_days: 0.5,
      },
      {
        member_id: 'EMP-001',
        leave_date: new Date('2026-07-07T00:00:00.000Z'),
        leave_type: 'Approved OT Comp',
        approved: true,
        duration_days: 0.5,
      },
    ];
    const analysis = analyzeMembers(
      [fact('W1', 32, 32), fact('W2', 40, 40)],
      context(weeks, leaves),
    )[0];

    expect(analysis?.excludedWeeks).toEqual([]);
    expect(analysis?.annotations).toEqual([
      { weekId: 'W1', reason: 'training' },
      { weekId: 'W2', reason: 'approved_ot' },
    ]);
    expect(analysis?.busyRate).toBe(1);
  });

  it('excludes zero-capacity full holiday or leave weeks', () => {
    const weeks = [week('W1', '2026-06-29', 40), week('W2', '2026-07-06')];
    const analysis = analyzeMembers([fact('W1', 0, 0), fact('W2', 40, 40)], context(weeks))[0];

    expect(analysis?.excludedWeeks).toEqual([{ weekId: 'W1', reason: 'holiday_week' }]);
    expect(analysis?.busyRate).toBe(1);
  });

  it('classifies supporting metrics and absolute weekly OT cap from rule config', () => {
    const rules = loadPmoReportRuleCatalog()[0];
    if (!rules) throw new Error('missing_test_report_rules');

    const signals = classifySupportingMetrics(
      {
        N02: 0.8,
        N03: 0.75,
        N04: 0.05,
        N05: 0.04,
        N06: 0.75,
        N12: 1,
        workedHours: 49,
      },
      rules,
    );

    expect(signals.find((signal) => signal.metricId === 'N05')).toMatchObject({
      ragColor: 'red',
      reviewRequired: true,
    });
    expect(signals.find((signal) => signal.metricId === 'N06')).toMatchObject({
      ragColor: 'red',
      reviewRequired: true,
    });
  });

  it('builds unique stable action codes', () => {
    expect(buildSuggestedActions(['overbook', 'overbook', 'mismatch_under'])).toEqual([
      'REBALANCE_ALLOCATION',
      'CHECK_MISSING_TIMESHEET',
    ]);
  });
});
