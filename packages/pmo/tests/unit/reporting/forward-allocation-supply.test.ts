import { describe, expect, it } from 'vitest';
import type { ForwardAllocationEvidence } from '../../../src/backend/reporting/forward-allocation/contracts.ts';
import { buildMemberAvailabilityWindows } from '../../../src/backend/reporting/forward-allocation/supply.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseEvidence(): ForwardAllocationEvidence {
  return {
    window: {
      evidenceFrom: d('2026-06-29'),
      evidenceTo: d('2026-08-07'),
      planningStart: d('2026-08-10'),
      planningEnd: d('2026-10-04'),
    },
    modeSummary: {
      demandBackedCount: 0,
      inferredCount: 0,
    },
    facts: [],
    weeks: [],
    leaves: [],
    members: [
      {
        memberId: 'EMP-101',
        fullName: 'Member 101',
        department: 'Backend',
        roleTitle: 'Backend Developer',
        level: 'L3',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
      {
        memberId: 'EMP-102',
        fullName: 'Member 102',
        department: 'QA',
        roleTitle: 'QA Engineer',
        level: 'L3',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
      {
        memberId: 'EMP-103',
        fullName: 'Member 103',
        department: 'Design',
        roleTitle: 'Designer',
        level: 'L3',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
    ],
    projects: [],
    allocations: [],
    demandWindows: [],
    demandGaps: [],
    riskByMember: new Map([
      [
        'EMP-101',
        {
          memberId: 'EMP-101',
          availableHours: 232,
          plannedHours: 180,
          loggedHours: 170,
          utilization: 0.73,
          effortConsumption: 0.94,
          overtimeRatio: 0,
          trainingHours: 0,
          benchHours: 24,
        },
      ],
      [
        'EMP-102',
        {
          memberId: 'EMP-102',
          availableHours: 232,
          plannedHours: 220,
          loggedHours: 246,
          utilization: 1.0603,
          effortConsumption: 1.1181,
          overtimeRatio: 0.12,
          trainingHours: 0,
          benchHours: 0,
        },
      ],
    ]),
    skills: [],
    taskHistory: [],
  };
}

describe('forward allocation supply builder', () => {
  it('creates assignment-end availability from the next working day', () => {
    const evidence = baseEvidence();
    evidence.allocations = [
      {
        member_id: 'EMP-101',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 1,
        weekly_planned_hours: 40,
        start_date: d('2026-08-10'),
        end_date: d('2026-08-29'),
      },
    ];

    const windows = buildMemberAvailabilityWindows(evidence);
    const member = windows.find(
      (row) => row.memberId === 'EMP-101' && row.availabilityKind === 'assignment_end',
    );

    expect(member?.availableFrom.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(member?.availableTo?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(member?.availableCapacityPct).toBe(1);
    expect(member?.availableCapacityHoursPerWeek).toBe(40);
  });

  it('creates partial-capacity availability within the planning window', () => {
    const evidence = baseEvidence();
    evidence.allocations = [
      {
        member_id: 'EMP-102',
        project_id: 'PRJ-002',
        role: 'QA',
        allocation_pct: 0.6,
        weekly_planned_hours: 24,
        start_date: d('2026-08-10'),
        end_date: d('2026-09-12'),
      },
    ];
    evidence.leaves = [
      {
        member_id: 'EMP-102',
        leave_date: d('2026-08-20'),
        leave_type: 'Annual Leave',
        approved: true,
        duration_days: 1,
      },
    ];

    const windows = buildMemberAvailabilityWindows(evidence);
    const member = windows.find(
      (row) => row.memberId === 'EMP-102' && row.availabilityKind === 'partial_capacity',
    );

    expect(member?.availableFrom.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(member?.availableTo?.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(member?.availableCapacityPct).toBeCloseTo(0.4, 4);
    expect(member?.availableCapacityHoursPerWeek).toBeCloseTo(16, 4);
    expect(member?.leaveConflicts).toHaveLength(1);
    expect(member?.riskFlags).toEqual(
      expect.arrayContaining(['actual_utilization_above_100', 'overtime_present']),
    );
  });

  it('marks members without future RA as fully available from planning start', () => {
    const evidence = baseEvidence();

    const windows = buildMemberAvailabilityWindows(evidence);
    const member = windows.find((row) => row.memberId === 'EMP-103');

    expect(member?.availabilityKind).toBe('assignment_end');
    expect(member?.availableFrom.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(member?.availableTo?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(member?.evidenceFlags).toEqual(['no_future_ra']);
    expect(member?.availableCapacityPct).toBe(1);
  });
});
