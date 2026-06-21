import { createHash } from 'node:crypto';
import { and, desc, eq, max } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  ingestionSessions,
  kpiNorms,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  timesheets,
} from '../db/schema.ts';
import { hashReportRules } from '../reporting/rules/canonical.ts';
import { resolveReportRules } from '../reporting/rules/resolve.ts';

export const FACTS_SCHEMA_VERSION = 'pmo-member-week-facts-v2';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function timestamp(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

export function buildCanonicalDataVersion(input: {
  tenantId: string;
  tableWatermarks: Record<string, Date | null>;
  latestPublishedSessionId: string | null;
  latestPublishedAt: Date | null;
}): string {
  const tableWatermarks = Object.fromEntries(
    Object.entries(input.tableWatermarks)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, value]) => [table, timestamp(value)]),
  );
  return sha256(
    JSON.stringify({
      tenantId: input.tenantId,
      tableWatermarks,
      latestPublishedSessionId: input.latestPublishedSessionId,
      latestPublishedAt: timestamp(input.latestPublishedAt),
    }),
  );
}

export function buildFactsVersion(input: {
  tenantId: string;
  canonicalDataVersion: string;
  factsSchemaVersion?: string;
  factsRuleVersion?: string;
}): string {
  return sha256(
    JSON.stringify({
      tenantId: input.tenantId,
      canonicalDataVersion: input.canonicalDataVersion,
      factsSchemaVersion: input.factsSchemaVersion ?? FACTS_SCHEMA_VERSION,
      factsRuleVersion: input.factsRuleVersion ?? 'unspecified',
    }),
  );
}

export async function getFactsRuleVersion(tenantId: string): Promise<string> {
  const db = pmoDb();
  const rows = await db
    .select({ latestWeekEnd: max(calendarWeeks.week_end) })
    .from(calendarWeeks)
    .where(and(eq(calendarWeeks.tenant_id, tenantId), eq(calendarWeeks.is_active, true)));
  const rules = await resolveReportRules({
    tenantId,
    effectiveAt: rows[0]?.latestWeekEnd ?? new Date(),
  });
  return hashReportRules(rules);
}

export async function getCanonicalDataVersion(tenantId: string): Promise<string> {
  const db = pmoDb();
  const [allocation, timesheet, leave, project, member, threshold, calendar, kpi, latestPublished] =
    await Promise.all([
      db
        .select({ value: max(resourceAllocations.updated_at) })
        .from(resourceAllocations)
        .where(eq(resourceAllocations.tenant_id, tenantId)),
      db
        .select({ value: max(timesheets.updated_at) })
        .from(timesheets)
        .where(eq(timesheets.tenant_id, tenantId)),
      db
        .select({ value: max(leaveRecords.updated_at) })
        .from(leaveRecords)
        .where(eq(leaveRecords.tenant_id, tenantId)),
      db
        .select({ value: max(projectMaster.updated_at) })
        .from(projectMaster)
        .where(eq(projectMaster.tenant_id, tenantId)),
      db
        .select({ value: max(memberMaster.updated_at) })
        .from(memberMaster)
        .where(eq(memberMaster.tenant_id, tenantId)),
      db
        .select({ value: max(overbookIdleConfig.updated_at) })
        .from(overbookIdleConfig)
        .where(eq(overbookIdleConfig.tenant_id, tenantId)),
      db
        .select({ value: max(calendarWeeks.updated_at) })
        .from(calendarWeeks)
        .where(eq(calendarWeeks.tenant_id, tenantId)),
      db
        .select({ value: max(kpiNorms.updated_at) })
        .from(kpiNorms)
        .where(eq(kpiNorms.tenant_id, tenantId)),
      db
        .select({ id: ingestionSessions.id, publishedAt: ingestionSessions.publish_reviewed_at })
        .from(ingestionSessions)
        .where(
          and(eq(ingestionSessions.tenant_id, tenantId), eq(ingestionSessions.status, 'published')),
        )
        .orderBy(desc(ingestionSessions.publish_reviewed_at))
        .limit(1),
    ]);

  return buildCanonicalDataVersion({
    tenantId,
    tableWatermarks: {
      calendar_weeks: calendar[0]?.value ?? null,
      kpi_norms: kpi[0]?.value ?? null,
      leave_records: leave[0]?.value ?? null,
      member_master: member[0]?.value ?? null,
      overbook_idle_config: threshold[0]?.value ?? null,
      project_master: project[0]?.value ?? null,
      resource_allocations: allocation[0]?.value ?? null,
      timesheets: timesheet[0]?.value ?? null,
    },
    latestPublishedSessionId: latestPublished[0]?.id ?? null,
    latestPublishedAt: latestPublished[0]?.publishedAt ?? null,
  });
}
