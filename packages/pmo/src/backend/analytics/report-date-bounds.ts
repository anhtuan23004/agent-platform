import { and, eq, max, min } from 'drizzle-orm';
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
