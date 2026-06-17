import { eq, sql } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { memberWeekFacts } from '../db/schema.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
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
  const { deliveryMembers } = splitPmoPopulations(inputs.members, inputs.projects);

  const facts = buildMemberWeekFacts({
    members: deliveryMembers,
    allocations: inputs.allocations,
    timesheets: inputs.timesheets,
    leaves: inputs.leaves,
    weeks: inputs.weeks,
    thresholds,
  });

  const db = pmoDb();
  await db.delete(memberWeekFacts).where(eq(memberWeekFacts.tenant_id, tenantId));

  if (facts.length > 0) {
    const rows = facts.map((f) => toRow(tenantId, sessionId ?? null, f));
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
          billable_hours: sqlExcluded('billable_hours'),
          bench_hours: sqlExcluded('bench_hours'),
          overtime_hours: sqlExcluded('overtime_hours'),
          training_hours: sqlExcluded('training_hours'),
          busy_rate: sqlExcluded('busy_rate'),
          utilization: sqlExcluded('utilization'),
          billable_rate: sqlExcluded('billable_rate'),
          bench_rate: sqlExcluded('bench_rate'),
          overtime_ratio: sqlExcluded('overtime_ratio'),
          effort_consumption: sqlExcluded('effort_consumption'),
          training_compliance: sqlExcluded('training_compliance'),
          rag_color: sqlExcluded('rag_color'),
          issue_type: sqlExcluded('issue_type'),
          computed_at: new Date(),
        },
      });
  }

  return {
    factCount: facts.length,
    weekIds: inputs.weeks.map((w) => w.week_id),
    memberCount: deliveryMembers.length,
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
    billable_hours: f.billableHours,
    bench_hours: f.benchHours,
    overtime_hours: f.overtimeHours,
    training_hours: f.trainingHours,
    busy_rate: f.busyRate,
    utilization: f.utilization,
    billable_rate: f.billableRate,
    bench_rate: f.benchRate,
    overtime_ratio: f.overtimeRatio,
    effort_consumption: f.effortConsumption,
    training_compliance: f.trainingCompliance,
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
    billableHours: r.billable_hours,
    benchHours: r.bench_hours,
    overtimeHours: r.overtime_hours,
    trainingHours: r.training_hours,
    busyRate: r.busy_rate,
    utilization: r.utilization,
    billableRate: r.billable_rate,
    benchRate: r.bench_rate,
    overtimeRatio: r.overtime_ratio,
    effortConsumption: r.effort_consumption,
    trainingCompliance: r.training_compliance,
    ragColor: r.rag_color as MemberWeekFact['ragColor'],
    issueType: r.issue_type as MemberWeekFact['issueType'],
  }));
}
