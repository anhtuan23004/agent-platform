import { describe, expect, it } from 'vitest';
import type { Thresholds } from '../../../src/backend/analytics/types.ts';
import {
  type AllocationRow,
  buildCandidateSlots,
  buildMemberAllocationPeriods,
  buildRebalanceOpportunities,
  buildRecommendationWindow,
  type RecommendationMember,
  type RecommendationRiskSummary,
  scoreRoleCompatibility,
} from '../../../src/backend/reporting/recommendations/index.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const thresholds: Thresholds = {
  overbookThreshold: 1.1,
  overbookRedThreshold: 1.2,
  idleThreshold: 0.75,
  idleYellowThreshold: 0.85,
  mismatchPctThreshold: 0.2,
  otMaxHoursPerWeek: 48,
  requiredTrainingHours: 0,
};

describe('candidate slots and hard filters', () => {
  it('builds future-facing slots and rejects overloaded candidates', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 0.8,
        weekly_planned_hours: 32,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-29'),
      },
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-002',
        role: 'BE',
        allocation_pct: 0.45,
        weekly_planned_hours: 18,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-29'),
      },
      {
        member_id: 'EMP-103',
        project_id: 'PRJ-010',
        role: 'BE',
        allocation_pct: 0.6,
        weekly_planned_hours: 24,
        start_date: d('2026-08-10'),
        end_date: d('2026-12-31'),
      },
      {
        member_id: 'EMP-120',
        project_id: 'PRJ-011',
        role: 'BE',
        allocation_pct: 0.7,
        weekly_planned_hours: 28,
        start_date: d('2026-08-10'),
        end_date: d('2026-12-31'),
      },
    ];
    const members: RecommendationMember[] = [
      {
        memberId: 'EMP-004',
        department: 'Backend',
        roleTitle: 'Backend Lead',
        level: 'L5',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
      {
        memberId: 'EMP-103',
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
        memberId: 'EMP-120',
        department: 'Backend',
        roleTitle: 'Backend Developer',
        level: 'L4',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
    ];
    const riskByMember = new Map<string, RecommendationRiskSummary>([
      [
        'EMP-103',
        {
          memberId: 'EMP-103',
          availableHours: 232,
          plannedHours: 139.2,
          loggedHours: 130,
          utilization: 0.82,
          effortConsumption: 0.93,
          overtimeRatio: 0,
          trainingHours: 0,
          benchHours: 20,
        },
      ],
      [
        'EMP-120',
        {
          memberId: 'EMP-120',
          availableHours: 232,
          plannedHours: 162.4,
          loggedHours: 250,
          utilization: 1.08,
          effortConsumption: 1.53,
          overtimeRatio: 0.2,
          trainingHours: 0,
          benchHours: 0,
        },
      ],
    ]);

    const opportunities = buildRebalanceOpportunities({
      periods: buildMemberAllocationPeriods(allocations),
      allocations,
      window: buildRecommendationWindow({
        evidenceFrom: d('2026-06-29'),
        evidenceTo: d('2026-08-07'),
      }),
      thresholds,
      riskByMember,
    });

    const slots = buildCandidateSlots({
      opportunities,
      periods: buildMemberAllocationPeriods(allocations),
      members,
      riskByMember,
      thresholds,
    });

    const emp103 = slots.find((slot) => slot.memberId === 'EMP-103');
    expect(emp103?.planningOverlap).not.toBeNull();
    expect(emp103?.availableCapacityPct).toBeCloseTo(0.4, 4);
    expect(emp103?.rejectionReasons).toEqual([]);

    const emp120 = slots.find((slot) => slot.memberId === 'EMP-120');
    expect(emp120?.rejectionReasons).toEqual(
      expect.arrayContaining(['actual_utilization_too_high', 'ot_risk_too_high']),
    );
  });

  it('scores exact role matches above mismatches', () => {
    const backend = scoreRoleCompatibility({
      roleNeeded: 'BE',
      candidate: {
        memberId: 'EMP-103',
        department: 'Backend',
        roleTitle: 'Backend Developer',
        level: 'L3',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
    });
    const qa = scoreRoleCompatibility({
      roleNeeded: 'BE',
      candidate: {
        memberId: 'EMP-116',
        department: 'QA',
        roleTitle: 'QA Engineer',
        level: 'L4',
        lineManagerId: null,
        employmentStatus: 'Active',
        employmentType: 'FT',
        stdHoursWeek: 40,
        joinDate: d('2024-01-01'),
      },
    });

    expect(backend).toBeGreaterThan(qa);
    expect(backend).toBe(0.7);
    expect(qa).toBe(0);
  });
});
