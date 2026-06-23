/** Future RA coverage so candidate slots overlap the planning window (Mon after evidence). */
export const RECOMMENDATION_RA_END = '2026-12-31T00:00:00.000Z';

export const RECOMMENDATION_PLANNING_START = '2026-08-10';

const CANDIDATE_EXTEND_MEMBER_IDS = new Set(['EMP-103', 'EMP-113', 'EMP-119']);

/** Golden swap fixture: spare headroom on the member's busy side project (not the swap target). */
const CANDIDATE_CAPACITY_TUNING: Record<
  string,
  { project_id: string; allocation_pct: number; weekly_planned_hours: number }
> = {
  'EMP-103': { project_id: 'PRJ-103', allocation_pct: 0.75, weekly_planned_hours: 30 },
  'EMP-119': { project_id: 'PRJ-107', allocation_pct: 0.95, weekly_planned_hours: 38 },
};

export interface TunableAllocationRow {
  member_id: string;
  project_id: string;
  role: string | null;
  allocation_pct: number;
  start_date: string;
  end_date: string;
  weekly_planned_hours: number | null;
  source_row?: number | null;
}

function allocationKey(row: TunableAllocationRow): string {
  return `${row.member_id}:${row.project_id}:${row.role ?? ''}`;
}

function needsPlanningOverlapExtension(endDate: string): boolean {
  return endDate.slice(0, 10) < RECOMMENDATION_PLANNING_START;
}

/**
 * Extend rebalance-candidate RA through the planning horizon and add swap-fixture
 * members missing from the workbook-derived SQLite seed.
 */
export function tuneRecommendationResourceAllocations(
  allocations: TunableAllocationRow[],
): TunableAllocationRow[] {
  const tuned = allocations.map((row) => {
    const capacity = CANDIDATE_CAPACITY_TUNING[row.member_id];
    const capacityTuned =
      capacity && row.project_id === capacity.project_id
        ? {
            ...row,
            allocation_pct: capacity.allocation_pct,
            weekly_planned_hours: capacity.weekly_planned_hours,
          }
        : row;

    if (!CANDIDATE_EXTEND_MEMBER_IDS.has(row.member_id)) return capacityTuned;
    if (!needsPlanningOverlapExtension(capacityTuned.end_date)) return capacityTuned;
    return { ...capacityTuned, end_date: RECOMMENDATION_RA_END };
  });

  const existing = new Set(tuned.map(allocationKey));
  const additions: TunableAllocationRow[] = [
    {
      member_id: 'EMP-119',
      project_id: 'PRJ-107',
      role: 'BE',
      allocation_pct: 0.95,
      start_date: '2026-06-29T00:00:00.000Z',
      end_date: RECOMMENDATION_RA_END,
      weekly_planned_hours: 38,
      source_row: null,
    },
    {
      member_id: 'EMP-120',
      project_id: 'PRJ-107',
      role: 'BE',
      allocation_pct: 1.02,
      start_date: '2026-06-29T00:00:00.000Z',
      end_date: RECOMMENDATION_RA_END,
      weekly_planned_hours: 40.8,
      source_row: null,
    },
  ];

  for (const row of additions) {
    if (existing.has(allocationKey(row))) continue;
    tuned.push(row);
    existing.add(allocationKey(row));
  }

  return tuned;
}
