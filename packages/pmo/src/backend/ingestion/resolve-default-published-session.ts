import { and, desc, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';

/** Latest user-published ingestion session for a tenant (excludes seed-only canonical rows). */
export async function resolveDefaultPublishedSessionId(tenantId: string): Promise<string | null> {
  const db = pmoDb();
  const rows = await db
    .select({ id: ingestionSessions.id })
    .from(ingestionSessions)
    .where(
      and(eq(ingestionSessions.tenant_id, tenantId), eq(ingestionSessions.status, 'published')),
    )
    .orderBy(desc(ingestionSessions.publish_reviewed_at))
    .limit(1);

  return rows[0]?.id ?? null;
}
