import type { CanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts, resolveProjectsForFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { resolveThresholds } from './thresholds.ts';
import type { MemberWeekFact } from './types.ts';
import {
  filterAllocationsForUtilization,
  filterTimesheetsForUtilization,
} from './utilization-scope.ts';

/** Rebuild member×week facts from canonical rows tagged to an ingestion session. */
export function buildSessionScopedMemberWeekFacts(canonical: CanonicalInputs): MemberWeekFact[] {
  const thresholds = resolveThresholds(canonical.configRows);
  const projects = resolveProjectsForFacts(
    canonical.projects,
    canonical.allocations,
    canonical.timesheets,
  );
  const { deliveryMembers } = splitPmoPopulations(canonical.members, projects);
  const allocations = filterAllocationsForUtilization(canonical.allocations, projects);
  const timesheets = filterTimesheetsForUtilization(canonical.timesheets, projects);
  return buildMemberWeekFacts({
    members: deliveryMembers,
    allocations,
    timesheets,
    leaves: canonical.leaves,
    weeks: canonical.weeks,
    thresholds,
    projects,
  });
}
