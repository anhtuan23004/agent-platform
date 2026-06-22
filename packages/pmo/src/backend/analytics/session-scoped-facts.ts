import type { CanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { resolveThresholds } from './thresholds.ts';
import type { MemberWeekFact } from './types.ts';

/** Rebuild member×week facts from canonical rows tagged to an ingestion session. */
export function buildSessionScopedMemberWeekFacts(canonical: CanonicalInputs): MemberWeekFact[] {
  const thresholds = resolveThresholds(canonical.configRows);
  const { deliveryMembers } = splitPmoPopulations(canonical.members, canonical.projects);
  return buildMemberWeekFacts({
    members: deliveryMembers,
    allocations: canonical.allocations,
    timesheets: canonical.timesheets,
    leaves: canonical.leaves,
    weeks: canonical.weeks,
    thresholds,
  });
}
