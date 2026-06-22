import { describe, expect, it } from 'vitest';
import { detectOverbookIdle } from '../../../src/backend/analytics/findings.ts';
import type { CanonicalInputs } from '../../../src/backend/analytics/load-canonical.ts';
import { buildSessionScopedMemberWeekFacts } from '../../../src/backend/analytics/session-scoped-facts.ts';
import type { MemberRow, WeekRow } from '../../../src/backend/analytics/types.ts';

function week(id: string, start: string, end: string): WeekRow {
  return {
    week_id: id,
    week_start: new Date(`${start}T00:00:00.000Z`),
    week_end: new Date(`${end}T00:00:00.000Z`),
    working_days: 5,
    holiday_hours_ft: 0,
  };
}

function member(id: string): MemberRow {
  return {
    member_id: id,
    full_name: id,
    role_title: 'Dev',
    std_hours_week: 40,
    join_date: new Date('2020-01-01T00:00:00.000Z'),
  };
}

describe('buildSessionScopedMemberWeekFacts', () => {
  it('detects idle members from session canonical rows without persisted facts', () => {
    const canonical: CanonicalInputs = {
      members: [member('EMP-005')],
      projects: [
        {
          project_id: 'PRJ-1',
          project_name: 'P1',
          account_id: null,
          project_type: 'delivery',
          status: 'active',
          pm_id: null,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
          end_date: new Date('2026-12-31T00:00:00.000Z'),
        },
      ],
      allocations: [
        {
          member_id: 'EMP-005',
          project_id: 'PRJ-1',
          role: 'Dev',
          allocation_pct: 0.6,
          weekly_planned_hours: null,
          start_date: new Date('2026-06-29T00:00:00.000Z'),
          end_date: new Date('2026-07-26T00:00:00.000Z'),
        },
      ],
      timesheets: [],
      leaves: [],
      weeks: [week('W1', '2026-06-29', '2026-07-05')],
      configRows: [
        {
          config_id: 'cfg-1',
          rule_name: 'default',
          overbook_threshold: 1.1,
          overbook_red_threshold: 1.2,
          idle_threshold: 0.75,
          mismatch_pct_threshold: 0.2,
          ot_max_hours_per_week: 10,
          required_training_hours: 0,
          effective_date: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    };

    const facts = buildSessionScopedMemberWeekFacts(canonical);
    const ctx = {
      leaves: canonical.leaves,
      weeksById: new Map(canonical.weeks.map((w) => [w.week_id, w])),
      thresholds: {
        overbookThreshold: 1.1,
        overbookRedThreshold: 1.2,
        idleThreshold: 0.75,
        idleYellowThreshold: 0.85,
        mismatchPctThreshold: 0.2,
        otMaxHoursPerWeek: 10,
        requiredTrainingHours: 0,
      },
    };

    const idle = detectOverbookIdle(facts, ctx).filter((row) => row.issueType === 'idle');
    expect(idle).toHaveLength(1);
    expect(idle[0]?.memberId).toBe('EMP-005');
  });
});
