import type { RequestContext } from '@mastra/core/request-context';
import { and as drizzleAnd, eq as drizzleEq } from 'drizzle-orm';
import { pmoDb as getPmoDb } from '../../db/client.ts';
import { ingestionSessions } from '../../db/schema.ts';
import type { PmoFileStore } from '../../ingestion/file-store.ts';
import { createS3FileStore } from '../../ingestion/s3-file-store.ts';

export interface DynamicRuntimeSessionRow {
  id: string;
  tenant_id: string;
  status: string;
  source_file_key: string;
  source_file_name: string;
  planning_goal: string | null;
  reporting_period_start: Date | null;
  reporting_period_end: Date | null;
  planning_plan: unknown;
  workflow_execution_state: unknown;
  detected_schema: unknown;
  confirmed_mapping: unknown;
  change_summary: unknown;
}

export interface DynamicRuntimeSessionPatch {
  status?: string;
  workflow_execution_state?: unknown;
  workflow_current_step?: string | null;
  workflow_step_status?: string | null;
  workflow_started_at?: Date | null;
  workflow_updated_at?: Date | null;
  finished_at?: Date | null;
  publish_reviewed_at?: Date | null;
  detected_schema?: unknown;
  confirmed_mapping?: unknown;
  change_summary?: unknown;
}

function normalizeBoolFlag(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseTenantAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function isDynamicRuntimeV2EnabledForTenant(tenantId: string): boolean {
  if (!normalizeBoolFlag(process.env.PMO_DYNAMIC_RUNTIME_V2)) {
    return false;
  }

  const allowlist = parseTenantAllowlist(process.env.PMO_DYNAMIC_RUNTIME_V2_TENANTS);
  if (allowlist.size === 0) {
    return true;
  }

  return allowlist.has(tenantId);
}

export function resolvePmoFileStore(requestContext: RequestContext): PmoFileStore {
  const fromContext = requestContext.get('pmoFileStore') as PmoFileStore | undefined;
  if (fromContext) {
    return fromContext;
  }

  const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
  return createS3FileStore(bucket);
}

export async function loadDynamicRuntimeSession(params: {
  ingestionSessionId: string;
  tenantId: string;
}): Promise<DynamicRuntimeSessionRow | null> {
  const db = getPmoDb();
  const rows = await db
    .select({
      id: ingestionSessions.id,
      tenant_id: ingestionSessions.tenant_id,
      status: ingestionSessions.status,
      source_file_key: ingestionSessions.source_file_key,
      source_file_name: ingestionSessions.source_file_name,
      planning_goal: ingestionSessions.planning_goal,
      reporting_period_start: ingestionSessions.reporting_period_start,
      reporting_period_end: ingestionSessions.reporting_period_end,
      planning_plan: ingestionSessions.planning_plan,
      workflow_execution_state: ingestionSessions.workflow_execution_state,
      detected_schema: ingestionSessions.detected_schema,
      confirmed_mapping: ingestionSessions.confirmed_mapping,
      change_summary: ingestionSessions.change_summary,
    })
    .from(ingestionSessions)
    .where(
      drizzleAnd(
        drizzleEq(ingestionSessions.id, params.ingestionSessionId),
        drizzleEq(ingestionSessions.tenant_id, params.tenantId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function updateDynamicRuntimeSession(params: {
  ingestionSessionId: string;
  tenantId: string;
  patch: DynamicRuntimeSessionPatch;
}): Promise<void> {
  const db = getPmoDb();
  await db
    .update(ingestionSessions)
    .set(params.patch)
    .where(
      drizzleAnd(
        drizzleEq(ingestionSessions.id, params.ingestionSessionId),
        drizzleEq(ingestionSessions.tenant_id, params.tenantId),
      ),
    );
}
