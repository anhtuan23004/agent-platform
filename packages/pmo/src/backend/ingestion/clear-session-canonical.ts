import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema.ts';
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

type PmoDb = NodePgDatabase<typeof schema>;

/** Removes canonical rows owned by one ingestion session (snapshot replace before publish). */
export async function clearSessionCanonicalData(
  db: PmoDb,
  tenantId: string,
  ingestionSessionId: string,
): Promise<void> {
  const sessionFilter = {
    tenant_id: tenantId,
    last_ingestion_session_id: ingestionSessionId,
  };

  await db
    .delete(timesheets)
    .where(
      and(
        eq(timesheets.tenant_id, sessionFilter.tenant_id),
        eq(timesheets.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(resourceAllocations)
    .where(
      and(
        eq(resourceAllocations.tenant_id, sessionFilter.tenant_id),
        eq(resourceAllocations.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(leaveRecords)
    .where(
      and(
        eq(leaveRecords.tenant_id, sessionFilter.tenant_id),
        eq(leaveRecords.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(memberMaster)
    .where(
      and(
        eq(memberMaster.tenant_id, sessionFilter.tenant_id),
        eq(memberMaster.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(projectMaster)
    .where(
      and(
        eq(projectMaster.tenant_id, sessionFilter.tenant_id),
        eq(projectMaster.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(calendarWeeks)
    .where(
      and(
        eq(calendarWeeks.tenant_id, sessionFilter.tenant_id),
        eq(calendarWeeks.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(overbookIdleConfig)
    .where(
      and(
        eq(overbookIdleConfig.tenant_id, sessionFilter.tenant_id),
        eq(overbookIdleConfig.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
  await db
    .delete(kpiNorms)
    .where(
      and(
        eq(kpiNorms.tenant_id, sessionFilter.tenant_id),
        eq(kpiNorms.last_ingestion_session_id, sessionFilter.last_ingestion_session_id),
      ),
    );
}
