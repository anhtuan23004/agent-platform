import { describe, expect, it } from 'vitest';
import { buildMemberWeekProjectFacts } from '../../../src/backend/analytics/member-week-project-facts.ts';
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
    status: 'Active',
    pm_id: null,
    start_date: d('2026-01-01'),
    end_date: d('2026-12-31'),
  },
  {
    project_id: 'PRJ-002',
    project_name: 'Beta',
    account_id: null,
    project_type: null,
    status: 'Active',
    pm_id: null,
    start_date: d('2026-03-01'),
    end_date: d('2026-09-30'),
  },
];

const allocations: AllocationRow[] = [
  {
    member_id: 'EMP-004',
    project_id: 'PRJ-001',
    role: 'BE',
    allocation_pct: 0.8,
    weekly_planned_hours: 32,
    start_date: d('2026-06-29'),
    end_date: d('2026-07-10'),
  },
  {
    member_id: 'EMP-004',
    project_id: 'PRJ-002',
    role: 'BE',
    allocation_pct: 0.45,
    weekly_planned_hours: 18,
    start_date: d('2026-06-29'),
    end_date: d('2026-07-10'),
  },
];

describe('buildMemberWeekProjectFacts', () => {
  it('emits one row per member × week × active project with plan and log split', () => {
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
        work_date: d('2026-07-01'),
        logged_hours: 12,
      },
    ];

    const rows = buildMemberWeekProjectFacts(projects, members, allocations, timesheets, weeks);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 'EMP-004',
          weekId: 'W1',
          projectId: 'PRJ-001',
          plannedHours: 32,
          loggedHours: 30,
          capacityShare: 0.8,
          allocationStartDate: '2026-06-29',
          allocationEndDate: '2026-07-10',
          projectStartDate: '2026-01-01',
          projectEndDate: '2026-12-31',
          projectStatus: 'Active',
        }),
        expect.objectContaining({
          memberId: 'EMP-004',
          weekId: 'W1',
          projectId: 'PRJ-002',
          plannedHours: 18,
          loggedHours: 12,
          capacityShare: 0.45,
        }),
      ]),
    );
  });

  it('includes completed projects when RA and timesheet exist in the week', () => {
    const completedProject: ProjectRow = {
      project_id: 'PRJ-DONE',
      project_name: 'Legacy',
      account_id: null,
      project_type: null,
      status: 'Completed',
      pm_id: null,
      start_date: d('2025-01-01'),
      end_date: d('2026-07-31'),
    };
    const rows = buildMemberWeekProjectFacts(
      [...projects, completedProject],
      members,
      [
        ...allocations,
        {
          member_id: 'EMP-004',
          project_id: 'PRJ-DONE',
          role: 'BE',
          allocation_pct: 0.25,
          weekly_planned_hours: 10,
          start_date: d('2026-06-29'),
          end_date: d('2026-07-10'),
        },
      ],
      [
        {
          member_id: 'EMP-004',
          project_id: 'PRJ-DONE',
          work_date: d('2026-06-30'),
          logged_hours: 8,
        },
      ],
      weeks,
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 'EMP-004',
          weekId: 'W1',
          projectId: 'PRJ-DONE',
          plannedHours: 10,
          loggedHours: 8,
          projectStatus: 'Completed',
        }),
      ]),
    );
  });
});
