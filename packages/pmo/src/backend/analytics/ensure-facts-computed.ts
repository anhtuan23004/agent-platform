import { and, desc, eq, max, sql } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions, memberWeekFacts } from '../db/schema.ts';
import { loadCanonicalInputs } from './load-canonical.ts';
import { type ComputeFactsResult, computeAndPersistFacts } from './persist-facts.ts';
import { splitPmoPopulations } from './populations.ts';
import { resolveThresholds } from './thresholds.ts';
import type { Thresholds } from './types.ts';

export interface EnsureFactsComputedResult extends ComputeFactsResult {
  computedAt: Date;
  ingestionSessionId: string | null;
  recomputed: boolean;
}

export interface EnsureFactsComputedOptions {
  sessionId?: string;
  /** When true, always recompute (POST /compute-facts and explicit ingest calls). */
  force?: boolean;
}

async function getLatestPublishReviewedAt(tenantId: string): Promise<Date | null> {
  const db = pmoDb();
  const rows = await db
    .select({ publish_reviewed_at: ingestionSessions.publish_reviewed_at })
    .from(ingestionSessions)
    .where(
      and(eq(ingestionSessions.tenant_id, tenantId), eq(ingestionSessions.status, 'published')),
    )
    .orderBy(desc(ingestionSessions.publish_reviewed_at))
    .limit(1);

  return rows[0]?.publish_reviewed_at ?? null;
}

async function getPersistedFactsMeta(tenantId: string): Promise<{
  factCount: number;
  computedAt: Date | null;
  ingestionSessionId: string | null;
}> {
  const db = pmoDb();
  const [countRow, timeRow, sessionRow] = await Promise.all([
    db
      .select({ factCount: sql<number>`count(*)::int` })
      .from(memberWeekFacts)
      .where(eq(memberWeekFacts.tenant_id, tenantId)),
    db
      .select({ computedAt: max(memberWeekFacts.computed_at) })
      .from(memberWeekFacts)
      .where(eq(memberWeekFacts.tenant_id, tenantId)),
    db
      .select({ ingestionSessionId: memberWeekFacts.last_ingestion_session_id })
      .from(memberWeekFacts)
      .where(eq(memberWeekFacts.tenant_id, tenantId))
      .limit(1),
  ]);

  return {
    factCount: countRow[0]?.factCount ?? 0,
    computedAt: timeRow[0]?.computedAt ?? null,
    ingestionSessionId: sessionRow[0]?.ingestionSessionId ?? null,
  };
}

async function shouldRecomputeFacts(tenantId: string, force: boolean): Promise<boolean> {
  if (force) return true;

  const meta = await getPersistedFactsMeta(tenantId);
  if (meta.factCount === 0) return true;

  const latestPublishReviewedAt = await getLatestPublishReviewedAt(tenantId);
  if (!latestPublishReviewedAt) return false;

  if (!meta.computedAt) return true;
  return meta.computedAt < latestPublishReviewedAt;
}

async function loadExistingFactsSummary(tenantId: string): Promise<EnsureFactsComputedResult> {
  const [meta, inputs] = await Promise.all([
    getPersistedFactsMeta(tenantId),
    loadCanonicalInputs(tenantId),
  ]);
  const thresholds = resolveThresholds(inputs.configRows);
  const { deliveryMembers } = splitPmoPopulations(inputs.members, inputs.projects);

  return {
    factCount: meta.factCount,
    weekIds: inputs.weeks.map((w) => w.week_id),
    memberCount: deliveryMembers.length,
    thresholds,
    computedAt: meta.computedAt ?? new Date(),
    ingestionSessionId: meta.ingestionSessionId,
    recomputed: false,
  };
}

/**
 * Ensure member×week facts are persisted for a tenant.
 *
 * - `force: true` — always recompute (POST /compute-facts, ingest after publish).
 * - Lazy path — recompute when facts are empty, or when `computed_at` is older than the
 *   latest published session's `publish_reviewed_at`. When no published session exists
 *   (seed/mock), only recompute when facts are empty.
 */
export async function ensureFactsComputed(
  tenantId: string,
  options?: EnsureFactsComputedOptions,
): Promise<EnsureFactsComputedResult> {
  const force = options?.force ?? false;
  const needsRecompute = await shouldRecomputeFacts(tenantId, force);

  if (!needsRecompute) {
    return loadExistingFactsSummary(tenantId);
  }

  const result = await computeAndPersistFacts(tenantId, options?.sessionId);
  const meta = await getPersistedFactsMeta(tenantId);

  return {
    ...result,
    computedAt: meta.computedAt ?? new Date(),
    ingestionSessionId: options?.sessionId ?? meta.ingestionSessionId,
    recomputed: true,
  };
}
