import type { AllocationRow, ProjectRow, TimesheetRow } from './types.ts';

/** Forward-looking rebalance / utilization findings — Active projects only. */
export type UtilizationScopeMode = 'planning' | 'trace';

/** DS05 projects eligible for utilization / rebalance planning. */
export function isActiveUtilizationProject(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized === 'active';
}

function isTraceUtilizationProject(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return true;
  // Trace keeps historical Completed work; drop only terminal non-util rows.
  return normalized !== 'cancelled';
}

function eligibleProjectIds(projects: ProjectRow[], mode: UtilizationScopeMode): Set<string> {
  const predicate = mode === 'planning' ? isActiveUtilizationProject : isTraceUtilizationProject;
  return new Set(projects.filter((project) => predicate(project.status)).map((p) => p.project_id));
}

export function activeUtilizationProjectIds(projects: ProjectRow[]): Set<string> {
  return eligibleProjectIds(projects, 'planning');
}

function filterByProjectScope<T extends { project_id: string }>(
  rows: T[],
  projects: ProjectRow[],
  mode: UtilizationScopeMode,
): T[] {
  const ids = eligibleProjectIds(projects, mode);
  return rows.filter((row) => ids.has(row.project_id));
}

/** Active projects only — persisted facts, findings, rebalance roster. */
export function filterAllocationsForUtilization(
  allocations: AllocationRow[],
  projects: ProjectRow[],
): AllocationRow[] {
  return filterByProjectScope(allocations, projects, 'planning');
}

export function filterTimesheetsForUtilization(
  timesheets: TimesheetRow[],
  projects: ProjectRow[],
): TimesheetRow[] {
  const activeIds = eligibleProjectIds(projects, 'planning');
  return timesheets.filter(
    (timesheet) => !timesheet.project_id || activeIds.has(timesheet.project_id),
  );
}

/**
 * Member × week × project trace — includes Completed projects so historical weeks
 * remain explainable when the reporting window overlaps closed work.
 */
export function filterAllocationsForTrace(
  allocations: AllocationRow[],
  projects: ProjectRow[],
): AllocationRow[] {
  return filterByProjectScope(allocations, projects, 'trace');
}

export function filterTimesheetsForTrace(
  timesheets: TimesheetRow[],
  projects: ProjectRow[],
): TimesheetRow[] {
  const traceIds = eligibleProjectIds(projects, 'trace');
  return timesheets.filter(
    (timesheet) => !timesheet.project_id || traceIds.has(timesheet.project_id),
  );
}
