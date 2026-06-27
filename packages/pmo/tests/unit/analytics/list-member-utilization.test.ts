import { describe, expect, it } from 'vitest';
import type { FindingsContext } from '../../../src/backend/analytics/findings.ts';
import { listFlaggedMembersFromDetectors } from '../../../src/backend/analytics/list-member-utilization.ts';
import { buildMemberWeekFacts } from '../../../src/backend/analytics/member-week-facts.ts';
import type {
  AllocationRow,
  MemberRow,
  TimesheetRow,
  WeekRow,
} from '../../../src/backend/analytics/types.ts';
import { DEFAULT_THRESHOLDS } from '../../../src/backend/analytics/types.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const WEEKS: WeekRow[] = [
  {
    week_id: 'W1',
    week_start: d('2026-06-29'),
    week_end: d('2026-07-03'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
];

const ctx: FindingsContext = {
  leaves: [],
  weeksById: new Map(WEEKS.map((week) => [week.week_id, week])),
  thresholds: DEFAULT_THRESHOLDS,
};

function ftMember(id: string): MemberRow {
  return { member_id: id, full_name: id, std_hours_week: 40, join_date: d('2020-01-01') };
}

function alloc(member: string, project: string, hours: number): AllocationRow {
  return {
    member_id: member,
    project_id: project,
    allocation_pct: hours / 40,
    weekly_planned_hours: hours,
    start_date: d('2026-06-29'),
    end_date: d('2026-08-07'),
  };
}

function flatLogs(member: string, hours: number): TimesheetRow[] {
  return WEEKS.map((week) => ({
    member_id: member,
    work_date: week.week_start,
    logged_hours: hours,
  }));
}

describe('listFlaggedMembersFromDetectors', () => {
  it('includes deterministic detail and explanation for overbook findings', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-004')],
      allocations: [alloc('EMP-004', 'PRJ-001', 32), alloc('EMP-004', 'PRJ-002', 18)],
      timesheets: flatLogs('EMP-004', 48),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const [row] = listFlaggedMembersFromDetectors(facts, ctx, ['overbook']);
    expect(row?.memberId).toBe('EMP-004');
    expect(row?.detail).toContain('125%');
    expect(row?.explanation?.summary).toContain('125%');
    expect(row?.explanation?.riskTradeoffs.length).toBeGreaterThan(0);
  });
});
