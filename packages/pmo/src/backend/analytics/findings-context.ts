import type { FindingsContext } from './findings.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { loadMemberWeekFacts } from './persist-facts.ts';
import { resolveThresholds } from './thresholds.ts';
import type { MemberWeekFact } from './types.ts';

export interface LoadFactsAndContextOptions {
  ingestionSessionId?: string;
  dateRange?: { from: Date; to: Date };
}

/**
 * Load persisted member-week facts plus the context the finding detectors need
 * (leave records for OT/leave suppression, week calendar, resolved thresholds).
 */
export async function loadFactsAndContext(
  tenantId: string,
  options: LoadFactsAndContextOptions = {},
): Promise<{ facts: MemberWeekFact[]; ctx: FindingsContext }> {
  const [facts, inputs] = await Promise.all([
    loadMemberWeekFacts(tenantId, options),
    loadCanonicalInputs(tenantId, options),
  ]);
  const ctx: FindingsContext = {
    leaves: inputs.leaves,
    weeksById: new Map(inputs.weeks.map((w) => [w.week_id, w])),
    thresholds: resolveThresholds(inputs.configRows),
  };
  return { facts, ctx };
}
