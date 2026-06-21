import { countDistinct, eq, sql } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import { memberWeekFacts, memberWeekFactVersions } from '../db/schema.ts';
import { mapReportRulesToLegacyThresholds } from '../reporting/rules/compatibility.ts';
import { resolveReportRules } from '../reporting/rules/resolve.ts';
import {
  buildFactsVersion,
  FACTS_SCHEMA_VERSION,
  getCanonicalDataVersion,
  getFactsRuleVersion,
} from './fact-versions.ts';
import { type ComputeFactsResult, computeAndPersistFacts } from './persist-facts.ts';
import type { Thresholds } from './types.ts';

export interface EnsureFactsComputedResult extends ComputeFactsResult {
  ingestionSessionId: string | null;
  recomputed: boolean;
}

export interface EnsureFactsComputedOptions {
  sessionId?: string;
  /** When true, always recompute (POST /compute-facts and explicit ingest calls). */
  force?: boolean;
}

interface PersistedFactsMeta {
  factCount: number;
  memberCount: number;
  weekIds: string[];
  computedAt: Date | null;
  ingestionSessionId: string | null;
  canonicalDataVersion: string | null;
  factsVersion: string | null;
  factsSchemaVersion: string | null;
}

async function getPersistedFactsMeta(tenantId: string): Promise<PersistedFactsMeta> {
  const db = pmoDb();
  const [countRow, weekRows, versionRows] = await Promise.all([
    db
      .select({
        factCount: sql<number>`count(*)::int`,
        memberCount: countDistinct(memberWeekFacts.member_id),
      })
      .from(memberWeekFacts)
      .where(eq(memberWeekFacts.tenant_id, tenantId)),
    db
      .selectDistinct({ weekId: memberWeekFacts.week_id })
      .from(memberWeekFacts)
      .where(eq(memberWeekFacts.tenant_id, tenantId)),
    db
      .select()
      .from(memberWeekFactVersions)
      .where(eq(memberWeekFactVersions.tenant_id, tenantId))
      .limit(1),
  ]);
  const version = versionRows[0];

  return {
    factCount: countRow[0]?.factCount ?? 0,
    memberCount: countRow[0]?.memberCount ?? 0,
    weekIds: weekRows.map((row) => row.weekId).sort(),
    computedAt: version?.computed_at ?? null,
    ingestionSessionId: version?.last_ingestion_session_id ?? null,
    canonicalDataVersion: version?.canonical_data_version ?? null,
    factsVersion: version?.facts_version ?? null,
    factsSchemaVersion: version?.facts_schema_version ?? null,
  };
}

async function resolveCurrentThresholds(tenantId: string): Promise<Thresholds> {
  const rules = await resolveReportRules({ tenantId, effectiveAt: new Date() });
  return {
    ...mapReportRulesToLegacyThresholds(rules),
    requiredTrainingHours: 0,
  };
}

function versionsMatch(
  meta: PersistedFactsMeta,
  canonicalDataVersion: string,
  expectedFactsVersion: string,
): boolean {
  return (
    meta.canonicalDataVersion === canonicalDataVersion &&
    meta.factsSchemaVersion === FACTS_SCHEMA_VERSION &&
    meta.factsVersion === expectedFactsVersion
  );
}

/** Ensure persisted member-week facts match current canonical input version. */
export async function ensureFactsComputed(
  tenantId: string,
  options: EnsureFactsComputedOptions = {},
): Promise<EnsureFactsComputedResult> {
  const [meta, canonicalDataVersion, factsRuleVersion] = await Promise.all([
    getPersistedFactsMeta(tenantId),
    getCanonicalDataVersion(tenantId),
    getFactsRuleVersion(tenantId),
  ]);
  const expectedFactsVersion = buildFactsVersion({
    tenantId,
    canonicalDataVersion,
    factsRuleVersion,
  });
  const current =
    meta.factCount > 0 && versionsMatch(meta, canonicalDataVersion, expectedFactsVersion);

  if (!options.force && current) {
    return {
      factCount: meta.factCount,
      memberCount: meta.memberCount,
      weekIds: meta.weekIds,
      thresholds: await resolveCurrentThresholds(tenantId),
      computedAt: meta.computedAt ?? new Date(0),
      ingestionSessionId: meta.ingestionSessionId,
      canonicalDataVersion,
      factsVersion: expectedFactsVersion,
      recomputed: false,
    };
  }

  const result = await computeAndPersistFacts(tenantId, options.sessionId, {
    canonicalDataVersion,
  });
  return {
    ...result,
    ingestionSessionId: options.sessionId ?? null,
    recomputed: true,
  };
}
