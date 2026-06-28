import { and, eq, or, type SQL } from 'drizzle-orm';
import { ingestionSessions } from '../db/schema.ts';

/** Matches UI/API `is_published` — publish approved even if workflow moved to report_generated. */
export function isPublishedIngestionSession(input: {
  status: string;
  publish_decision: string | null;
}): boolean {
  return input.status === 'published' || input.publish_decision === 'approved';
}

/** Drizzle filter for tenant-scoped published ingestion sessions. */
export function publishedIngestionSessionFilter(tenantId: string): SQL {
  return and(
    eq(ingestionSessions.tenant_id, tenantId),
    or(
      eq(ingestionSessions.status, 'published'),
      eq(ingestionSessions.publish_decision, 'approved'),
    ),
  ) as SQL;
}
