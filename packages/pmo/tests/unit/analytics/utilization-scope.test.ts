import { describe, expect, it } from 'vitest';
import type {
  AllocationRow,
  ProjectRow,
  TimesheetRow,
} from '../../../src/backend/analytics/types.ts';
import {
  filterAllocationsForTrace,
  filterAllocationsForUtilization,
  filterTimesheetsForTrace,
  filterTimesheetsForUtilization,
  isActiveUtilizationProject,
} from '../../../src/backend/analytics/utilization-scope.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const projects: ProjectRow[] = [
  {
    project_id: 'PRJ-ACTIVE',
    project_name: 'Active',
    account_id: null,
    project_type: null,
    status: 'Active',
    pm_id: null,
    start_date: null,
    end_date: null,
  },
  {
    project_id: 'PRJ-DONE',
    project_name: 'Done',
    account_id: null,
    project_type: null,
    status: 'Completed',
    pm_id: null,
    start_date: null,
    end_date: null,
  },
];

describe('utilization-scope', () => {
  it('treats only Active projects as utilization-eligible', () => {
    expect(isActiveUtilizationProject('Active')).toBe(true);
    expect(isActiveUtilizationProject('Completed')).toBe(false);
    expect(isActiveUtilizationProject(null)).toBe(true);
  });

  it('drops allocations and timesheets on completed projects for planning scope', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-ACTIVE',
        role: null,
        allocation_pct: 1,
        weekly_planned_hours: 40,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-DONE',
        role: null,
        allocation_pct: 1,
        weekly_planned_hours: 40,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
    ];
    const timesheets: TimesheetRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-DONE',
        work_date: d('2026-06-30'),
        logged_hours: 8,
      },
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-ACTIVE',
        work_date: d('2026-06-30'),
        logged_hours: 6,
      },
    ];

    expect(filterAllocationsForUtilization(allocations, projects).map((a) => a.project_id)).toEqual(
      ['PRJ-ACTIVE'],
    );
    expect(filterTimesheetsForUtilization(timesheets, projects).map((t) => t.project_id)).toEqual([
      'PRJ-ACTIVE',
    ]);
  });

  it('keeps completed project rows in trace scope for member × week × project drill-down', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-DONE',
        role: null,
        allocation_pct: 1,
        weekly_planned_hours: 40,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
    ];
    const timesheets: TimesheetRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-DONE',
        work_date: d('2026-06-30'),
        logged_hours: 8,
      },
    ];

    expect(filterAllocationsForTrace(allocations, projects).map((a) => a.project_id)).toEqual([
      'PRJ-DONE',
    ]);
    expect(filterTimesheetsForTrace(timesheets, projects).map((t) => t.project_id)).toEqual([
      'PRJ-DONE',
    ]);
  });
});
