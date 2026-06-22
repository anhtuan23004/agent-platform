import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { calendarWeeks, memberWeekFacts, memberWeekFactVersions } from '../db/schema.ts';
import { hashReportRules } from '../reporting/rules/canonical.ts';
import { mapReportRulesToLegacyThresholds } from '../reporting/rules/compatibility.ts';
import { resolveReportRules } from '../reporting/rules/resolve.ts';
import {
  buildFactsVersion,
  FACTS_SCHEMA_VERSION,
  getCanonicalDataVersion,
} from './fact-versions.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { buildMemberWeekFacts } from './member-week-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import type { MemberWeekFact, Thresholds } from './types.ts';
import {
  filterAllocationsForUtilization,
  filterTimesheetsForUtilization,
} from './utilization-scope.ts';

export interface ComputeFactsResult {
  factCount: number;
  weekIds: string[];
  memberCount: number;
  thresholds: Thresholds;
  computedAt: Date;
  canonicalDataVersion: string;
  factsVersion: string;
}

export interface ComputeFactsOptions {
  canonicalDataVersion?: string;
}

/**
 * Recompute the member × week read-model for a tenant from canonical data and
 * upsert it. Idempotent: re-running with unchanged canonical data yields the
 * same rows (conflict on tenant+member+week → update in place).
 */
export async function computeAndPersistFacts(
  tenantId: string,
  sessionId?: string,
  options: ComputeFactsOptions = {},
): Promise<ComputeFactsResult> {
  const inputs = await loadCanonicalInputs(tenantId);
  const effectiveAt = inputs.weeks.reduce<Date | null>(
    (latest, week) => (!latest || week.week_end > latest ? week.week_end : latest),
    null,
  );
  const reportRules = await resolveReportRules({
    tenantId,
    effectiveAt: effectiveAt ?? new Date(),
  });
  const thresholds: Thresholds = {
    ...mapReportRulesToLegacyThresholds(reportRules),
    requiredTrainingHours: 0,
  };
  const { deliveryMembers } = splitPmoPopulations(inputs.members, inputs.projects);
  const allocations = filterAllocationsForUtilization(inputs.allocations, inputs.projects);
  const timesheets = filterTimesheetsForUtilization(inputs.timesheets, inputs.projects);

  const facts = buildMemberWeekFacts({
    members: deliveryMembers,
    allocations,
    timesheets,
    leaves: inputs.leaves,
    weeks: inputs.weeks,
    thresholds,
    projects: inputs.projects,
  });

  const canonicalDataVersion =
    options.canonicalDataVersion ?? (await getCanonicalDataVersion(tenantId));
  const factsVersion = buildFactsVersion({
    tenantId,
    canonicalDataVersion,
    factsRuleVersion: hashReportRules(reportRules),
  });
  const computedAt = new Date();
  const db = pmoDb();
  await db.transaction(async (tx) => {
    await tx.delete(memberWeekFacts).where(eq(memberWeekFacts.tenant_id, tenantId));

    if (facts.length > 0) {
      const rows = facts.map((f) => toRow(tenantId, sessionId ?? null, f, computedAt));
      await tx.insert(memberWeekFacts).values(rows);
    }

    await tx
      .insert(memberWeekFactVersions)
      .values({
        tenant_id: tenantId,
        facts_version: factsVersion,
        canonical_data_version: canonicalDataVersion,
        facts_schema_version: FACTS_SCHEMA_VERSION,
        last_ingestion_session_id: sessionId ?? null,
        computed_at: computedAt,
        updated_at: computedAt,
      })
      .onConflictDoUpdate({
        target: memberWeekFactVersions.tenant_id,
        set: {
          facts_version: factsVersion,
          canonical_data_version: canonicalDataVersion,
          facts_schema_version: FACTS_SCHEMA_VERSION,
          last_ingestion_session_id: sessionId ?? null,
          computed_at: computedAt,
          updated_at: computedAt,
        },
      });
  });

  return {
    factCount: facts.length,
    weekIds: inputs.weeks.map((w) => w.week_id),
    memberCount: deliveryMembers.length,
    thresholds,
    computedAt,
    canonicalDataVersion,
    factsVersion,
  };
}

function toRow(
  tenantId: string,
  sessionId: string | null,
  f: MemberWeekFact,
  computedAt: Date,
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
    computed_at: computedAt,
  };
}

export interface LoadMemberWeekFactsOptions {
  weekIds?: string[];
  ingestionSessionId?: string;
  dateRange?: { from: Date; to: Date };
}

/** Load the persisted facts for a tenant (used by the detect tools). */
export async function loadMemberWeekFacts(
  tenantId: string,
  options: LoadMemberWeekFactsOptions = {},
): Promise<MemberWeekFact[]> {
  const db = pmoDb();
  const filters = [eq(memberWeekFacts.tenant_id, tenantId), eq(calendarWeeks.is_active, true)];
  if (options.weekIds) {
    if (options.weekIds.length === 0) return [];
    filters.push(inArray(memberWeekFacts.week_id, options.weekIds));
  }
  if (options.ingestionSessionId) {
    filters.push(eq(memberWeekFacts.last_ingestion_session_id, options.ingestionSessionId));
  }
  if (options.dateRange) {
    filters.push(
      gte(calendarWeeks.week_end, options.dateRange.from),
      lte(calendarWeeks.week_start, options.dateRange.to),
    );
  }

  const rows = await db
    .select({
      member_id: memberWeekFacts.member_id,
      week_id: memberWeekFacts.week_id,
      scope_status: memberWeekFacts.scope_status,
      available_hours: memberWeekFacts.available_hours,
      planned_hours: memberWeekFacts.planned_hours,
      logged_hours: memberWeekFacts.logged_hours,
      expected_logged_hours: memberWeekFacts.expected_logged_hours,
      billable_hours: memberWeekFacts.billable_hours,
      bench_hours: memberWeekFacts.bench_hours,
      overtime_hours: memberWeekFacts.overtime_hours,
      training_hours: memberWeekFacts.training_hours,
      busy_rate: memberWeekFacts.busy_rate,
      utilization: memberWeekFacts.utilization,
      billable_rate: memberWeekFacts.billable_rate,
      bench_rate: memberWeekFacts.bench_rate,
      overtime_ratio: memberWeekFacts.overtime_ratio,
      effort_consumption: memberWeekFacts.effort_consumption,
      training_compliance: memberWeekFacts.training_compliance,
      rag_color: memberWeekFacts.rag_color,
      issue_type: memberWeekFacts.issue_type,
    })
    .from(memberWeekFacts)
    .innerJoin(
      calendarWeeks,
      and(
        eq(calendarWeeks.tenant_id, memberWeekFacts.tenant_id),
        eq(calendarWeeks.week_id, memberWeekFacts.week_id),
      ),
    )
    .where(and(...filters));

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
