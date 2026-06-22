import { describe, expect, it } from 'vitest';
import { buildMemberProjectAllocationFacts } from '../../../src/backend/analytics/member-project-facts.ts';
import type {
  AllocationRow,
  MemberRow,
  ProjectRow,
  TimesheetRow,
  WeekRow,
} from '../../../src/backend/analytics/types.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const weeks: WeekRow[] = [
  {
    week_id: 'W1',
    week_start: d('2026-06-29'),
    week_end: d('2026-07-03'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
  {
    week_id: 'W2',
    week_start: d('2026-07-06'),
    week_end: d('2026-07-10'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
];

const members: MemberRow[] = [
  { member_id: 'EMP-004', full_name: 'Alex', std_hours_week: 40, join_date: d('2020-01-01') },
];

const projects: ProjectRow[] = [
  {
    project_id: 'PRJ-001',
    project_name: 'Alpha',
    account_id: null,
    project_type: null,
    status: null,
    pm_id: null,
    start_date: null,
    end_date: null,
  },
  {
    project_id: 'PRJ-002',
    project_name: 'Beta',
    account_id: null,
    project_type: null,
    status: null,
    pm_id: null,
    start_date: null,
    end_date: null,
  },
];

const allocations: AllocationRow[] = [
  {
    member_id: 'EMP-004',
    project_id: 'PRJ-001',
    role: 'Dev',
    allocation_pct: 0.8,
    weekly_planned_hours: 32,
    start_date: d('2026-06-29'),
    end_date: d('2026-07-10'),
  },
  {
    member_id: 'EMP-004',
    project_id: 'PRJ-002',
    role: 'Dev',
    allocation_pct: 0.45,
    weekly_planned_hours: 18,
    start_date: d('2026-06-29'),
    end_date: d('2026-07-10'),
  },
];

describe('buildMemberProjectAllocationFacts', () => {
  it('builds one row per member × project with plan, logged, and capacity share', () => {
    const timesheets: TimesheetRow[] = [
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        work_date: d('2026-06-30'),
        logged_hours: 30,
      },
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-002',
        work_date: d('2026-07-07'),
        logged_hours: 12,
      },
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        work_date: d('2026-07-08'),
        logged_hours: 8,
      },
    ];

    const rows = buildMemberProjectAllocationFacts(
      projects,
      members,
      allocations,
      timesheets,
      weeks,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      memberId: 'EMP-004',
      projectId: 'PRJ-001',
      weeklyPlannedHours: 32,
      capacityShare: 0.8,
      loggedHours: 38,
      plannedHoursInWindow: 64,
      effortConsumption: 0.5938,
    });
    expect(rows[1]).toMatchObject({
      memberId: 'EMP-004',
      projectId: 'PRJ-002',
      weeklyPlannedHours: 18,
      capacityShare: 0.45,
      loggedHours: 12,
      plannedHoursInWindow: 36,
      effortConsumption: 0.3333,
    });
  });

  it('ignores timesheet rows without a project_id', () => {
    const timesheets: TimesheetRow[] = [
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        work_date: d('2026-06-30'),
        logged_hours: 10,
      },
      {
        member_id: 'EMP-004',
        work_date: d('2026-06-30'),
        logged_hours: 99,
      },
    ];

    const rows = buildMemberProjectAllocationFacts(
      projects,
      members,
      allocations,
      timesheets,
      weeks,
    );

    expect(rows.find((row) => row.projectId === 'PRJ-001')?.loggedHours).toBe(10);
    expect(rows.find((row) => row.projectId === 'PRJ-002')?.loggedHours).toBe(0);
  });
});
