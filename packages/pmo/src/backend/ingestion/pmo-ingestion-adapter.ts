import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  calendarWeeks,
  kpiNorms,
  leaveRecords,
  memberMaster,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  timesheets,
} from '../db/schema.ts';
import type { IngestionDomainAdapter, IngestionPublishResult } from './domain-adapter.ts';
import { publishUpsert } from './publish-upsert.ts';
import type { ActiveRecord } from './stage-changes.ts';

function normalizeReferenceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized.toLowerCase() : null;
}

function toReferenceSet(rows: Array<{ id: unknown }>): Set<string> {
  return new Set(
    rows.map((row) => normalizeReferenceValue(row.id)).filter((id): id is string => Boolean(id)),
  );
}

export const PMO_INGESTION_ADAPTER: IngestionDomainAdapter = {
  domainId: 'pmo',

  async findReferenceValues(input): Promise<Set<string>> {
    const db = pmoDb();
    const rows =
      input.tableId === 'member_master' && input.fieldName === 'member_id'
        ? await db
            .select({ id: memberMaster.member_id })
            .from(memberMaster)
            .where(
              and(eq(memberMaster.tenant_id, input.tenantId), eq(memberMaster.is_active, true)),
            )
        : input.tableId === 'project_master' && input.fieldName === 'project_id'
          ? await db
              .select({ id: projectMaster.project_id })
              .from(projectMaster)
              .where(
                and(eq(projectMaster.tenant_id, input.tenantId), eq(projectMaster.is_active, true)),
              )
          : [];

    return toReferenceSet(rows);
  },

  async findActiveRecords(input): Promise<ActiveRecord[]> {
    const db = pmoDb();
    const selectShape = {
      natural_key_hash: resourceAllocations.natural_key_hash,
      source_row_hash: resourceAllocations.source_row_hash,
    };

    if (input.tableId === 'resource_allocation') {
      return db
        .select(selectShape)
        .from(resourceAllocations)
        .where(
          and(
            eq(resourceAllocations.tenant_id, input.tenantId),
            eq(resourceAllocations.is_active, true),
          ),
        );
    }

    if (input.tableId === 'timesheet') {
      return db
        .select({
          natural_key_hash: timesheets.natural_key_hash,
          source_row_hash: timesheets.source_row_hash,
        })
        .from(timesheets)
        .where(and(eq(timesheets.tenant_id, input.tenantId), eq(timesheets.is_active, true)));
    }

    if (input.tableId === 'leave') {
      return db
        .select({
          natural_key_hash: leaveRecords.natural_key_hash,
          source_row_hash: leaveRecords.source_row_hash,
        })
        .from(leaveRecords)
        .where(and(eq(leaveRecords.tenant_id, input.tenantId), eq(leaveRecords.is_active, true)));
    }

    if (input.tableId === 'member_master') {
      return db
        .select({
          natural_key_hash: memberMaster.natural_key_hash,
          source_row_hash: memberMaster.source_row_hash,
        })
        .from(memberMaster)
        .where(and(eq(memberMaster.tenant_id, input.tenantId), eq(memberMaster.is_active, true)));
    }

    if (input.tableId === 'project_master') {
      return db
        .select({
          natural_key_hash: projectMaster.natural_key_hash,
          source_row_hash: projectMaster.source_row_hash,
        })
        .from(projectMaster)
        .where(and(eq(projectMaster.tenant_id, input.tenantId), eq(projectMaster.is_active, true)));
    }

    if (input.tableId === 'overbook_idle_config') {
      return db
        .select({
          natural_key_hash: overbookIdleConfig.natural_key_hash,
          source_row_hash: overbookIdleConfig.source_row_hash,
        })
        .from(overbookIdleConfig)
        .where(
          and(
            eq(overbookIdleConfig.tenant_id, input.tenantId),
            eq(overbookIdleConfig.is_active, true),
          ),
        );
    }

    if (input.tableId === 'calendar_weeks') {
      return db
        .select({
          natural_key_hash: calendarWeeks.natural_key_hash,
          source_row_hash: calendarWeeks.source_row_hash,
        })
        .from(calendarWeeks)
        .where(and(eq(calendarWeeks.tenant_id, input.tenantId), eq(calendarWeeks.is_active, true)));
    }

    if (input.tableId === 'kpi_norms') {
      return db
        .select({
          natural_key_hash: kpiNorms.natural_key_hash,
          source_row_hash: kpiNorms.source_row_hash,
        })
        .from(kpiNorms)
        .where(and(eq(kpiNorms.tenant_id, input.tenantId), eq(kpiNorms.is_active, true)));
    }

    return [];
  },

  async publish(input): Promise<IngestionPublishResult> {
    return publishUpsert(input.ingestionSessionId, input.tenantId);
  },
};
