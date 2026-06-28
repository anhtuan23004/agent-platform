import { desc } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import { publishedIngestionSessionFilter } from './publication-state.ts';

/** Latest user-published ingestion session for a tenant (excludes seed-only canonical rows). */
export async function resolveDefaultPublishedSessionId(tenantId: string): Promise<string | null> {
  const db = pmoDb();
  const rows = await db
    .select({ id: ingestionSessions.id })
    .from(ingestionSessions)
    .where(publishedIngestionSessionFilter(tenantId))
    .orderBy(desc(ingestionSessions.publish_reviewed_at))
    .limit(1);

  return rows[0]?.id ?? null;
}
