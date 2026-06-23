import type { AllocationRow, ProjectRow } from '../../analytics/types.ts';
import type {
  ForwardAllocationDemandWindow,
  ForwardAllocationRecommendationMode,
  ProjectDemandGapWindow,
} from './contracts.ts';

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function overlaps(
  left: { from: Date; to: Date },
  right: { from: Date; to: Date },
): { from: Date; to: Date } | null {
  const from = maxDate(left.from, right.from);
  const to = minDate(left.to, right.to);
  return from.getTime() <= to.getTime() ? { from, to } : null;
}

function projectById(projects: ProjectRow[]): Map<string, ProjectRow> {
  return new Map(projects.map((project) => [project.project_id, project]));
}

function isProjectActiveInWindow(
  project: ProjectRow | undefined,
  window: { from: Date; to: Date },
): boolean {
  if (!project) return false;
  if (project.status?.toLowerCase() === 'closed') return false;
  const projectFrom = project.start_date ?? window.from;
  const projectTo = project.end_date ?? window.to;
  return overlaps({ from: projectFrom, to: projectTo }, window) !== null;
}

function activeOverlapDays(window: { from: Date; to: Date }): number {
  const ms = window.to.getTime() - window.from.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function coveredPctForOverlap(input: {
  overlap: { from: Date; to: Date };
  allocation: AllocationRow;
}): number {
  const overlapDays = activeOverlapDays(input.overlap);
  const allocationOverlap = overlaps(input.overlap, {
    from: input.allocation.start_date,
    to: input.allocation.end_date,
  });
  if (!allocationOverlap) return 0;
  const allocationDays = activeOverlapDays(allocationOverlap);
  return round4((input.allocation.allocation_pct ?? 0) * (allocationDays / overlapDays));
}

function demandPctForWindow(
  window: ForwardAllocationDemandWindow,
  defaultStdHoursWeek: number,
): number {
  if (window.demandPct !== null) return round4(window.demandPct);
  if (window.demandHoursPerWeek !== null && defaultStdHoursWeek > 0) {
    return round4(window.demandHoursPerWeek / defaultStdHoursWeek);
  }
  return 0;
}

function demandHoursForWindow(
  window: ForwardAllocationDemandWindow,
  defaultStdHoursWeek: number,
  demandPct: number,
): number {
  if (window.demandHoursPerWeek !== null) return round4(window.demandHoursPerWeek);
  return round4(demandPct * defaultStdHoursWeek);
}

function recommendationTypeHint(input: {
  demand: ForwardAllocationDemandWindow;
  supportingAllocationPct: number;
}): ProjectDemandGapWindow['recommendationTypeHint'] {
  if (input.supportingAllocationPct > 0) return 'extend';
  if (input.demand.confirmed) return 'reassign';
  return 'fill_gap';
}

function recommendationMode(
  demand: ForwardAllocationDemandWindow,
): ForwardAllocationRecommendationMode {
  return demand.confirmed ? 'demand_backed' : 'inferred';
}

export function buildProjectDemandGapWindows(input: {
  projects: ProjectRow[];
  allocations: AllocationRow[];
  demandWindows: ForwardAllocationDemandWindow[];
  planningWindow: { from: Date; to: Date };
  defaultStdHoursWeek?: number;
}): ProjectDemandGapWindow[] {
  const defaultStdHoursWeek = input.defaultStdHoursWeek ?? 40;
  const projectsById = projectById(input.projects);

  return input.demandWindows
    .filter((demand) => {
      const overlap = overlaps(
        { from: demand.demandStart, to: demand.demandEnd },
        input.planningWindow,
      );
      if (!overlap) return false;
      return isProjectActiveInWindow(projectsById.get(demand.projectId), overlap);
    })
    .map((demand) => {
      const overlap = overlaps(
        { from: demand.demandStart, to: demand.demandEnd },
        input.planningWindow,
      );
      if (!overlap) {
        throw new Error(`forward_allocation_demand_overlap_missing:${demand.demandId}`);
      }

      const supportingAllocationPct = round4(
        input.allocations
          .filter((allocation) => allocation.project_id === demand.projectId)
          .reduce((sum, allocation) => sum + coveredPctForOverlap({ overlap, allocation }), 0),
      );
      const demandPct = demandPctForWindow(demand, defaultStdHoursWeek);
      const demandHoursPerWeek = demandHoursForWindow(demand, defaultStdHoursWeek, demandPct);
      const unresolvedDemandPct = round4(Math.max(0, demandPct - supportingAllocationPct));
      const unresolvedDemandHoursPerWeek = round4(
        Math.max(
          0,
          demandHoursPerWeek -
            Math.min(demandHoursPerWeek, supportingAllocationPct * defaultStdHoursWeek),
        ),
      );

      const evidenceFlags = [...demand.evidenceFlags];
      if (supportingAllocationPct > demandPct && demandPct > 0) {
        evidenceFlags.push('future_ra_exceeds_demand_window');
      }

      return {
        demandId: demand.demandId,
        projectId: demand.projectId,
        roleNeeded: demand.roleNeeded,
        requiredSkills: demand.requiredSkills,
        demandStart: overlap.from,
        demandEnd: overlap.to,
        demandPct,
        demandHoursPerWeek,
        urgency: demand.urgency,
        priorityScore: demand.priorityScore,
        confirmed: demand.confirmed,
        recommendationMode: recommendationMode(demand),
        demandSource: demand.demandSource,
        note: demand.note,
        evidenceFlags,
        supportingAllocationPct,
        unresolvedDemandPct,
        unresolvedDemandHoursPerWeek,
        recommendationTypeHint: recommendationTypeHint({ demand, supportingAllocationPct }),
      };
    })
    .filter((gap) => gap.unresolvedDemandPct > 0 || gap.recommendationTypeHint === 'extend')
    .sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        right.unresolvedDemandPct - left.unresolvedDemandPct ||
        left.projectId.localeCompare(right.projectId) ||
        left.roleNeeded.localeCompare(right.roleNeeded) ||
        left.demandId.localeCompare(right.demandId),
    );
}
