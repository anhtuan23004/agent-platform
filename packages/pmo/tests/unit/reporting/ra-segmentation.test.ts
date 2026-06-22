import { describe, expect, it } from 'vitest';
import type { AllocationRow } from '../../../src/backend/analytics/types.ts';
import {
  buildAllocationSegments,
  buildMemberAllocationPeriods,
} from '../../../src/backend/reporting/recommendations/index.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('RA segmentation', () => {
  it('segments overlapping allocations into bounded periods', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 0.6,
        weekly_planned_hours: 24,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-002',
        role: 'BE',
        allocation_pct: 0.4,
        weekly_planned_hours: 16,
        start_date: d('2026-07-13'),
        end_date: d('2026-08-07'),
      },
    ];

    const segments = buildAllocationSegments(allocations);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => [segment.projectId, segment.from.toISOString()])).toEqual([
      ['PRJ-001', '2026-06-29T00:00:00.000Z'],
      ['PRJ-001', '2026-07-13T00:00:00.000Z'],
      ['PRJ-002', '2026-07-13T00:00:00.000Z'],
    ]);
  });

  it('aggregates member allocation periods from segments', () => {
    const allocations: AllocationRow[] = [
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-001',
        role: 'BE',
        allocation_pct: 0.6,
        weekly_planned_hours: 24,
        start_date: d('2026-06-29'),
        end_date: d('2026-08-07'),
      },
      {
        member_id: 'EMP-001',
        project_id: 'PRJ-002',
        role: 'BE',
        allocation_pct: 0.4,
        weekly_planned_hours: 16,
        start_date: d('2026-07-13'),
        end_date: d('2026-08-07'),
      },
    ];

    const periods = buildMemberAllocationPeriods(allocations);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      memberId: 'EMP-001',
      totalAllocationPct: 0.6,
    });
    expect(periods[1]).toMatchObject({
      memberId: 'EMP-001',
      totalAllocationPct: 1,
    });
    expect(periods[1]?.projects).toHaveLength(2);
  });
});
