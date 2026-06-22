import { and, eq, inArray, max, min } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { calendarWeeks, leaveRecords, resourceAllocations, timesheets } from '../db/schema.ts';

export interface PmoReportDateBounds {
  min: string;
  max: string;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Returns the date extent of active canonical records used by PMO reporting. */
export async function getPmoReportDateBounds(
  tenantId: string,
): Promise<PmoReportDateBounds | null> {
  const db = pmoDb();
  const [allocationRows, timesheetRows, leaveRows, calendarRows] = await Promise.all([
    db
      .select({ min: min(resourceAllocations.start_date), max: max(resourceAllocations.end_date) })
      .from(resourceAllocations)
      .where(
        and(eq(resourceAllocations.tenant_id, tenantId), eq(resourceAllocations.is_active, true)),
      ),
    db
      .select({ min: min(timesheets.work_date), max: max(timesheets.work_date) })
      .from(timesheets)
      .where(and(eq(timesheets.tenant_id, tenantId), eq(timesheets.is_active, true))),
    db
      .select({ min: min(leaveRecords.leave_date), max: max(leaveRecords.leave_date) })
      .from(leaveRecords)
      .where(and(eq(leaveRecords.tenant_id, tenantId), eq(leaveRecords.is_active, true))),
    db
      .select({ min: min(calendarWeeks.week_start), max: max(calendarWeeks.week_end) })
      .from(calendarWeeks)
      .where(and(eq(calendarWeeks.tenant_id, tenantId), eq(calendarWeeks.is_active, true))),
  ]);
  const rows = [allocationRows[0], timesheetRows[0], leaveRows[0], calendarRows[0]];
  const minimums = rows.flatMap((row) => (row?.min ? [row.min] : []));
  const maximums = rows.flatMap((row) => (row?.max ? [row.max] : []));
  if (minimums.length === 0 || maximums.length === 0) return null;

  const minimum = minimums.reduce((earliest, value) => (value < earliest ? value : earliest));
  const maximum = maximums.reduce((latest, value) => (value > latest ? value : latest));
  return { min: isoDate(minimum), max: isoDate(maximum) };
}

export async function getPmoReportDateBoundsByIngestionSession(
  tenantId: string,
  sessionIds: string[],
): Promise<Map<string, PmoReportDateBounds>> {
  const uniqueSessionIds = [...new Set(sessionIds)].filter(Boolean);
  if (uniqueSessionIds.length === 0) return new Map();

  const db = pmoDb();
  type BoundRow = { sessionId: string | null; min: Date | null; max: Date | null };
  const [allocationRows, timesheetRows, leaveRows, calendarRows] = await Promise.all([
    db
      .select({
        sessionId: resourceAllocations.last_ingestion_session_id,
        min: min(resourceAllocations.start_date),
        max: max(resourceAllocations.end_date),
      })
      .from(resourceAllocations)
      .where(
        and(
          eq(resourceAllocations.tenant_id, tenantId),
          eq(resourceAllocations.is_active, true),
          inArray(resourceAllocations.last_ingestion_session_id, uniqueSessionIds),
        ),
      )
      .groupBy(resourceAllocations.last_ingestion_session_id),
    db
      .select({
        sessionId: timesheets.last_ingestion_session_id,
        min: min(timesheets.work_date),
        max: max(timesheets.work_date),
      })
      .from(timesheets)
      .where(
        and(
          eq(timesheets.tenant_id, tenantId),
          eq(timesheets.is_active, true),
          inArray(timesheets.last_ingestion_session_id, uniqueSessionIds),
        ),
      )
      .groupBy(timesheets.last_ingestion_session_id),
    db
      .select({
        sessionId: leaveRecords.last_ingestion_session_id,
        min: min(leaveRecords.leave_date),
        max: max(leaveRecords.leave_date),
      })
      .from(leaveRecords)
      .where(
        and(
          eq(leaveRecords.tenant_id, tenantId),
          eq(leaveRecords.is_active, true),
          inArray(leaveRecords.last_ingestion_session_id, uniqueSessionIds),
        ),
      )
      .groupBy(leaveRecords.last_ingestion_session_id),
    db
      .select({
        sessionId: calendarWeeks.last_ingestion_session_id,
        min: min(calendarWeeks.week_start),
        max: max(calendarWeeks.week_end),
      })
      .from(calendarWeeks)
      .where(
        and(
          eq(calendarWeeks.tenant_id, tenantId),
          eq(calendarWeeks.is_active, true),
          inArray(calendarWeeks.last_ingestion_session_id, uniqueSessionIds),
        ),
      )
      .groupBy(calendarWeeks.last_ingestion_session_id),
  ]);

  const result = new Map<string, { min: Date; max: Date }>();
  for (const row of [
    ...allocationRows,
    ...timesheetRows,
    ...leaveRows,
    ...calendarRows,
  ] as BoundRow[]) {
    if (!row.sessionId || !row.min || !row.max) continue;
    const current = result.get(row.sessionId);
    result.set(row.sessionId, {
      min: current && current.min < row.min ? current.min : row.min,
      max: current && current.max > row.max ? current.max : row.max,
    });
  }

  return new Map(
    [...result.entries()].map(([sessionId, bounds]) => [
      sessionId,
      { min: isoDate(bounds.min), max: isoDate(bounds.max) },
    ]),
  );
}
