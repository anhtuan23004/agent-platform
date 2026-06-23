import { describe, expect, it } from 'vitest';
import type { AllocationRow, ProjectRow } from '../../../src/backend/analytics/types.ts';
import type { ForwardAllocationDemandWindow } from '../../../src/backend/reporting/forward-allocation/contracts.ts';
import { buildProjectDemandGapWindows } from '../../../src/backend/reporting/forward-allocation/demand.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function project(
  input: Partial<ProjectRow> & Pick<ProjectRow, 'project_id' | 'project_name'>,
): ProjectRow {
  return {
    project_id: input.project_id,
    project_name: input.project_name,
    account_id: input.account_id ?? null,
    project_type: input.project_type ?? null,
    status: input.status ?? 'active',
    pm_id: input.pm_id ?? null,
    start_date: input.start_date ?? d('2026-01-01'),
    end_date: input.end_date ?? d('2026-12-31'),
  };
}

function demand(
  input: Partial<ForwardAllocationDemandWindow> &
    Pick<
      ForwardAllocationDemandWindow,
      'demandId' | 'projectId' | 'roleNeeded' | 'demandStart' | 'demandEnd'
    >,
): ForwardAllocationDemandWindow {
  return {
    demandId: input.demandId,
    projectId: input.projectId,
    roleNeeded: input.roleNeeded,
    requiredSkills: input.requiredSkills ?? [],
    demandStart: input.demandStart,
    demandEnd: input.demandEnd,
    demandPct: input.demandPct ?? null,
    demandHoursPerWeek: input.demandHoursPerWeek ?? null,
    urgency: input.urgency ?? 'medium',
    priorityScore: input.priorityScore ?? null,
    confirmed: input.confirmed ?? false,
    demandSource: input.demandSource ?? 'seeded_mock',
    note: input.note ?? null,
    evidenceFlags: input.evidenceFlags ?? [],
  };
}

function allocation(input: AllocationRow): AllocationRow {
  return input;
}

describe('forward allocation demand builder', () => {
  it('subtracts overlapping future RA from confirmed demand and marks demand-backed extend', () => {
    const gaps = buildProjectDemandGapWindows({
      projects: [project({ project_id: 'PRJ-001', project_name: 'Alpha' })],
      allocations: [
        allocation({
          member_id: 'EMP-001',
          project_id: 'PRJ-001',
          role: 'BE',
          allocation_pct: 0.4,
          weekly_planned_hours: 16,
          start_date: d('2026-08-10'),
          end_date: d('2026-09-12'),
        }),
      ],
      demandWindows: [
        demand({
          demandId: 'DEM-001',
          projectId: 'PRJ-001',
          roleNeeded: 'BE',
          requiredSkills: ['nodejs'],
          demandStart: d('2026-08-10'),
          demandEnd: d('2026-09-12'),
          demandPct: 0.8,
          demandHoursPerWeek: 32,
          confirmed: true,
        }),
      ],
      planningWindow: { from: d('2026-08-10'), to: d('2026-10-04') },
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      demandId: 'DEM-001',
      projectId: 'PRJ-001',
      recommendationMode: 'demand_backed',
      recommendationTypeHint: 'extend',
      supportingAllocationPct: 0.4,
      unresolvedDemandPct: 0.4,
      unresolvedDemandHoursPerWeek: 16,
    });
  });

  it('derives inferred fill-gap windows when no future RA supports the demand', () => {
    const gaps = buildProjectDemandGapWindows({
      projects: [project({ project_id: 'PRJ-002', project_name: 'Beta' })],
      allocations: [],
      demandWindows: [
        demand({
          demandId: 'DEM-002',
          projectId: 'PRJ-002',
          roleNeeded: 'QA',
          requiredSkills: ['qa'],
          demandStart: d('2026-08-15'),
          demandEnd: d('2026-09-05'),
          demandHoursPerWeek: 20,
          confirmed: false,
          evidenceFlags: ['requires_demand_confirmation'],
        }),
      ],
      planningWindow: { from: d('2026-08-10'), to: d('2026-10-04') },
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      demandId: 'DEM-002',
      recommendationMode: 'inferred',
      recommendationTypeHint: 'fill_gap',
      supportingAllocationPct: 0,
      unresolvedDemandPct: 0.5,
      unresolvedDemandHoursPerWeek: 20,
      evidenceFlags: ['requires_demand_confirmation'],
    });
  });

  it('drops inactive projects and clips demand windows to the planning horizon', () => {
    const gaps = buildProjectDemandGapWindows({
      projects: [
        project({ project_id: 'PRJ-003', project_name: 'Gamma', status: 'closed' }),
        project({ project_id: 'PRJ-004', project_name: 'Delta' }),
      ],
      allocations: [],
      demandWindows: [
        demand({
          demandId: 'DEM-003',
          projectId: 'PRJ-003',
          roleNeeded: 'Design',
          demandStart: d('2026-08-10'),
          demandEnd: d('2026-08-20'),
          demandPct: 0.5,
        }),
        demand({
          demandId: 'DEM-004',
          projectId: 'PRJ-004',
          roleNeeded: 'BE',
          demandStart: d('2026-07-25'),
          demandEnd: d('2026-08-20'),
          demandPct: 0.5,
          confirmed: true,
        }),
      ],
      planningWindow: { from: d('2026-08-10'), to: d('2026-10-04') },
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.demandId).toBe('DEM-004');
    expect(gaps[0]?.demandStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(gaps[0]?.demandEnd.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });
});
