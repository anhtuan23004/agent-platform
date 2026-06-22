import type { AllocationRow } from '../../analytics/types.ts';
import type { AllocationSegment, MemberAllocationPeriod } from './contracts.ts';

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sortByTime(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function uniqueBoundaryTimes(allocations: AllocationRow[]): number[] {
  const values = new Set<number>();
  for (const allocation of allocations) {
    values.add(startOfUtcDay(allocation.start_date).getTime());
    // Allocation end dates are inclusive in canonical PMO data, so segment
    // boundaries must use the next UTC day to avoid leaking a boundary-starting
    // allocation into the previous segment.
    values.add(addUtcDays(allocation.end_date, 1).getTime());
  }
  return [...values].sort((left, right) => left - right);
}

function activeInPeriod(allocation: AllocationRow, from: Date, to: Date): boolean {
  return allocation.start_date <= to && allocation.end_date >= from;
}

export function buildAllocationSegments(allocations: AllocationRow[]): AllocationSegment[] {
  const boundaries = uniqueBoundaryTimes(allocations);
  if (boundaries.length === 0) return [];

  const segments: AllocationSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = new Date(boundaries[index] as number);
    const toExclusive = new Date(boundaries[index + 1] as number);
    const to = addUtcDays(toExclusive, -1);
    for (const allocation of allocations) {
      if (!activeInPeriod(allocation, from, to)) continue;
      segments.push({
        memberId: allocation.member_id,
        projectId: allocation.project_id,
        role: allocation.role ?? null,
        from,
        to,
        allocationPct: allocation.allocation_pct ?? 0,
        weeklyPlannedHours: allocation.weekly_planned_hours,
      });
    }
  }

  return segments.sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) ||
      sortByTime(left.from, right.from) ||
      left.projectId.localeCompare(right.projectId) ||
      (left.role ?? '').localeCompare(right.role ?? ''),
  );
}

export function buildMemberAllocationPeriods(
  allocations: AllocationRow[],
): MemberAllocationPeriod[] {
  const segments = buildAllocationSegments(allocations);
  const periods = new Map<string, MemberAllocationPeriod>();

  for (const segment of segments) {
    const key = `${segment.memberId}:${segment.from.toISOString()}:${segment.to.toISOString()}`;
    const current = periods.get(key);
    if (current) {
      current.totalAllocationPct += segment.allocationPct;
      current.projects.push({
        projectId: segment.projectId,
        role: segment.role,
        allocationPct: segment.allocationPct,
        weeklyPlannedHours: segment.weeklyPlannedHours,
      });
      continue;
    }
    periods.set(key, {
      memberId: segment.memberId,
      from: segment.from,
      to: segment.to,
      totalAllocationPct: segment.allocationPct,
      projects: [
        {
          projectId: segment.projectId,
          role: segment.role,
          allocationPct: segment.allocationPct,
          weeklyPlannedHours: segment.weeklyPlannedHours,
        },
      ],
    });
  }

  return [...periods.values()].sort(
    (left, right) =>
      left.memberId.localeCompare(right.memberId) || sortByTime(left.from, right.from),
  );
}
