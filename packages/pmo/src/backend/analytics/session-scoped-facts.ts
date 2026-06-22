import type { CanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
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
  const { deliveryMembers } = splitPmoPopulations(canonical.members, canonical.projects);
  const allocations = filterAllocationsForUtilization(canonical.allocations, canonical.projects);
  const timesheets = filterTimesheetsForUtilization(canonical.timesheets, canonical.projects);
  return buildMemberWeekFacts({
    members: deliveryMembers,
    allocations,
    timesheets,
    leaves: canonical.leaves,
    weeks: canonical.weeks,
    thresholds,
    projects: canonical.projects,
  });
}
