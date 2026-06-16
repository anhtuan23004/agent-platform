import type { FindingsContext } from '../analytics/findings.ts';
import { loadCanonicalInputs } from '../analytics/load-canonical.ts';
import { loadMemberWeekFacts } from '../analytics/persist-facts.ts';
import { resolveThresholds } from '../analytics/thresholds.ts';
import type { MemberWeekFact } from '../analytics/types.ts';

/**
 * Load persisted member-week facts plus the context the finding detectors need
 * (leave records for OT/leave suppression, week calendar, resolved thresholds).
 */
export async function loadFactsAndContext(
  tenantId: string,
): Promise<{ facts: MemberWeekFact[]; ctx: FindingsContext }> {
  const [facts, inputs] = await Promise.all([
    loadMemberWeekFacts(tenantId),
    loadCanonicalInputs(tenantId),
  ]);
  const ctx: FindingsContext = {
    leaves: inputs.leaves,
    weeksById: new Map(inputs.weeks.map((w) => [w.week_id, w])),
    thresholds: resolveThresholds(inputs.configRows),
  };
  return { facts, ctx };
}
