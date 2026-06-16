import { eq, sql } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { memberWeekFacts } from '../db/schema.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { resolveThresholds } from './thresholds.ts';
import type { MemberWeekFact, Thresholds } from './types.ts';

export interface ComputeFactsResult {
  factCount: number;
  weekIds: string[];
  memberCount: number;
  thresholds: Thresholds;
}

/**
 * Recompute the member × week read-model for a tenant from canonical data and
 * upsert it. Idempotent: re-running with unchanged canonical data yields the
 * same rows (conflict on tenant+member+week → update in place).
 */
export async function computeAndPersistFacts(
  tenantId: string,
  sessionId?: string,
): Promise<ComputeFactsResult> {
  const inputs = await loadCanonicalInputs(tenantId);
  const thresholds = resolveThresholds(inputs.configRows);

  const facts = buildMemberWeekFacts({
    members: inputs.members,
    allocations: inputs.allocations,
    timesheets: inputs.timesheets,
    leaves: inputs.leaves,
    weeks: inputs.weeks,
    thresholds,
  });

  if (facts.length > 0) {
    const rows = facts.map((f) => toRow(tenantId, sessionId ?? null, f));
    const db = pmoDb();
    await db
      .insert(memberWeekFacts)
      .values(rows)
      .onConflictDoUpdate({
        target: [memberWeekFacts.tenant_id, memberWeekFacts.member_id, memberWeekFacts.week_id],
        set: {
          last_ingestion_session_id: sessionId ?? null,
          scope_status: sqlExcluded('scope_status'),
          available_hours: sqlExcluded('available_hours'),
          planned_hours: sqlExcluded('planned_hours'),
          logged_hours: sqlExcluded('logged_hours'),
          expected_logged_hours: sqlExcluded('expected_logged_hours'),
          busy_rate: sqlExcluded('busy_rate'),
          effort_consumption: sqlExcluded('effort_consumption'),
          utilization: sqlExcluded('utilization'),
          rag_color: sqlExcluded('rag_color'),
          issue_type: sqlExcluded('issue_type'),
          computed_at: new Date(),
        },
      });
  }

  return {
    factCount: facts.length,
    weekIds: inputs.weeks.map((w) => w.week_id),
    memberCount: inputs.members.length,
    thresholds,
  };
}

function toRow(
  tenantId: string,
  sessionId: string | null,
  f: MemberWeekFact,
): typeof memberWeekFacts.$inferInsert {
  return {
    tenant_id: tenantId,
    last_ingestion_session_id: sessionId,
    member_id: f.memberId,
    week_id: f.weekId,
    scope_status: f.scopeStatus,
    available_hours: f.availableHours,
    planned_hours: f.plannedHours,
    logged_hours: f.loggedHours,
    expected_logged_hours: f.expectedLoggedHours,
    busy_rate: f.busyRate,
    effort_consumption: f.effortConsumption,
    utilization: f.utilization,
    rag_color: f.ragColor,
    issue_type: f.issueType,
  };
}

// Reference the conflicting row's incoming value in onConflictDoUpdate.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/** Load the persisted facts for a tenant (used by the detect tools). */
export async function loadMemberWeekFacts(tenantId: string): Promise<MemberWeekFact[]> {
  const db = pmoDb();
  const rows = await db
    .select()
    .from(memberWeekFacts)
    .where(eq(memberWeekFacts.tenant_id, tenantId));

  return rows.map((r) => ({
    memberId: r.member_id,
    weekId: r.week_id,
    scopeStatus: r.scope_status as MemberWeekFact['scopeStatus'],
    availableHours: r.available_hours,
    plannedHours: r.planned_hours,
    loggedHours: r.logged_hours,
    expectedLoggedHours: r.expected_logged_hours,
    busyRate: r.busy_rate,
    effortConsumption: r.effort_consumption,
    utilization: r.utilization,
    ragColor: r.rag_color as MemberWeekFact['ragColor'],
    issueType: r.issue_type as MemberWeekFact['issueType'],
  }));
}
