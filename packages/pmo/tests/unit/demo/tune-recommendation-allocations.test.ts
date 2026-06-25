import { describe, expect, it } from 'vitest';
import {
  RECOMMENDATION_RA_END,
  tuneRecommendationResourceAllocations,
} from '../../../src/backend/demo/tune-recommendation-allocations.ts';

describe('tuneRecommendationResourceAllocations', () => {
  it('extends candidate RA end dates through the planning horizon', () => {
    const tuned = tuneRecommendationResourceAllocations([
      {
        member_id: 'EMP-103',
        project_id: 'PRJ-103',
        role: 'BE',
        allocation_pct: 0.86,
        start_date: '2026-06-29T00:00:00.000Z',
        end_date: '2026-08-07T00:00:00.000Z',
        weekly_planned_hours: 34.4,
      },
      {
        member_id: 'EMP-004',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 0.8,
        start_date: '2026-06-29T00:00:00.000Z',
        end_date: '2026-08-07T00:00:00.000Z',
        weekly_planned_hours: 32,
      },
    ]);

    expect(tuned.find((row) => row.member_id === 'EMP-103')?.end_date).toBe(RECOMMENDATION_RA_END);
    expect(tuned.find((row) => row.member_id === 'EMP-004')?.end_date).toBe(
      '2026-08-07T00:00:00.000Z',
    );
  });

  it('lowers EMP-103 busy-side allocation for golden capacity headroom', () => {
    const tuned = tuneRecommendationResourceAllocations([
      {
        member_id: 'EMP-103',
        project_id: 'PRJ-103',
        role: 'BE',
        allocation_pct: 0.86,
        start_date: '2026-06-29T00:00:00.000Z',
        end_date: '2026-08-07T00:00:00.000Z',
        weekly_planned_hours: 34.4,
      },
    ]);

    expect(tuned[0]).toMatchObject({
      allocation_pct: 0.75,
      weekly_planned_hours: 30,
    });
  });

  it('adds EMP-119 spare-capacity and EMP-120 overload fixtures when missing', () => {
    const tuned = tuneRecommendationResourceAllocations([]);

    expect(tuned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          member_id: 'EMP-119',
          project_id: 'PRJ-107',
          allocation_pct: 0.95,
          end_date: RECOMMENDATION_RA_END,
        }),
        expect.objectContaining({
          member_id: 'EMP-120',
          project_id: 'PRJ-107',
          allocation_pct: 1.02,
          end_date: RECOMMENDATION_RA_END,
        }),
      ]),
    );
  });
});
