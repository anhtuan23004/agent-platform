import { describe, expect, it } from 'vitest';
import type { Thresholds } from '../../../src/backend/analytics/types.ts';
import {
  type AllocationRow,
  buildMemberAllocationPeriods,
  buildRebalanceOpportunities,
  buildRecommendationWindow,
  type RecommendationRiskSummary,
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

describe('rebalance opportunities', () => {
  it('builds period-based opportunities from overbook RA segments', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 0.8,
        weekly_planned_hours: 32,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-002',
        role: 'BE',
        allocation_pct: 0.45,
        weekly_planned_hours: 18,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
    ];

    const periods = buildMemberAllocationPeriods(allocations);
    const opportunities = buildRebalanceOpportunities({
      periods,
      allocations,
      window: buildRecommendationWindow({
        evidenceFrom: d('2026-06-29'),
        evidenceTo: d('2026-08-07'),
      }),
      thresholds,
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0]).toMatchObject({
      sourceMemberId: 'EMP-004',
      projectId: 'PRJ-001',
      roleNeeded: 'BE',
      severity: 'red',
      currentRaBusyRate: 1.25,
      reliefNeededPct: 0.16,
      reliefNeededHoursPerWeek: 6.4,
      requiresRaConfirmation: true,
    });
    expect(opportunities[0]?.planningPeriod.from.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(opportunities[0]?.planningPeriod.to).toBeNull();
  });

  it('attaches source validation flags from timesheet-derived risk summaries', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 1.25,
        weekly_planned_hours: 50,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-29'),
      },
    ];
    const riskByMember = new Map<string, RecommendationRiskSummary>([
      [
        'EMP-004',
        {
          memberId: 'EMP-004',
          availableHours: 232,
          plannedHours: 290,
          loggedHours: 300,
          utilization: 1.2931,
          effortConsumption: 1.0345,
          overtimeRatio: 0.1,
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

    expect(opportunities[0]?.sourceValidation.utilization).toBeCloseTo(1.2931, 4);
    expect(opportunities[0]?.sourceRiskFlags).toEqual(
      expect.arrayContaining(['actual_utilization_above_100', 'overtime_present']),
    );
    expect(opportunities[0]?.requiresRaConfirmation).toBe(false);
    expect(opportunities[0]?.planningPeriod.to?.toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });
});
