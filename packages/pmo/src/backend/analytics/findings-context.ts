import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import type { FindingsContext } from './findings.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { loadMemberWeekFacts } from './persist-facts.ts';
import { getPmoReportDateBoundsByIngestionSession } from './report-date-bounds.ts';
import { buildSessionScopedMemberWeekFacts } from './session-scoped-facts.ts';
import { resolveThresholds } from './thresholds.ts';
import type { MemberWeekFact } from './types.ts';

export interface LoadFactsAndContextOptions {
  ingestionSessionId?: string;
  dateRange?: { from: Date; to: Date };
}

async function resolveSessionDateRange(
  tenantId: string,
  ingestionSessionId: string,
): Promise<{ from: Date; to: Date } | undefined> {
  const db = pmoDb();
  const [row] = await db
    .select({
      start: ingestionSessions.reporting_period_start,
      end: ingestionSessions.reporting_period_end,
    })
    .from(ingestionSessions)
    .where(
      and(eq(ingestionSessions.tenant_id, tenantId), eq(ingestionSessions.id, ingestionSessionId)),
    )
    .limit(1);

  if (row?.start && row?.end) {
    return { from: row.start, to: row.end };
  }

  const bounds = await getPmoReportDateBoundsByIngestionSession(tenantId, [ingestionSessionId]);
  const sessionBounds = bounds.get(ingestionSessionId);
  if (!sessionBounds) return undefined;

  return {
    from: new Date(`${sessionBounds.min}T00:00:00.000Z`),
    to: new Date(`${sessionBounds.max}T00:00:00.000Z`),
  };
}

/**
 * Load persisted member-week facts plus the context the finding detectors need
 * (leave records for OT/leave suppression, week calendar, resolved thresholds).
 *
 * When `ingestionSessionId` is set, facts are rebuilt from that session's canonical
 * rows (same path as Utilization analytics UI) — not from the tenant-wide persisted
 * facts table, which only reflects the latest publish batch.
 */
export async function loadFactsAndContext(
  tenantId: string,
  options: LoadFactsAndContextOptions = {},
): Promise<{ facts: MemberWeekFact[]; ctx: FindingsContext }> {
  if (options.ingestionSessionId) {
    const dateRange =
      options.dateRange ?? (await resolveSessionDateRange(tenantId, options.ingestionSessionId));
    const canonical = await loadCanonicalInputs(tenantId, {
      ingestionSessionId: options.ingestionSessionId,
      ...(dateRange ? { dateRange } : {}),
    });
    const facts = buildSessionScopedMemberWeekFacts(canonical);
    const ctx: FindingsContext = {
      leaves: canonical.leaves,
      weeksById: new Map(canonical.weeks.map((w) => [w.week_id, w])),
      thresholds: resolveThresholds(canonical.configRows),
    };
    return { facts, ctx };
  }

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
