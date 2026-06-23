import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { pmoDb } from '../db/client.ts';
import type * as schema from '../db/schema.ts';
import { projectDemandPlan } from '../db/schema.ts';
import { computeNaturalKeyHash, computeSourceRowHash } from '../ingestion/stage-changes.ts';
import { resolvePmoSeedAssetRoot } from './seed-from-mock-db.ts';

const DEFAULT_PROJECT_DEMAND_PLAN_CSV_PATH = resolve(
  resolvePmoSeedAssetRoot(),
  'hackathon/data/pmo_02_project_demand_plan.csv',
);

interface ProjectDemandPlanCsvRow {
  tenant_id?: string;
  demand_id: string;
  project_id: string;
  role_needed: string;
  required_skills?: string;
  demand_start: string;
  demand_end: string;
  demand_pct?: string;
  demand_hours_per_week?: string;
  urgency?: string;
  priority_score?: string;
  confirmed?: string;
  demand_source?: string;
  note?: string;
  is_active?: string;
}

export interface SeedProjectDemandPlanInput {
  tenantId: string;
  ingestionSessionId?: string;
  csvPath?: string;
  db?: NodePgDatabase<typeof schema>;
}

export interface SeedProjectDemandPlanResult {
  ok: true;
  tenantId: string;
  ingestionSessionId: string;
  csvPath: string;
  inserted: number;
}

function parseCsvFile<T>(path: string): T[] {
  if (!existsSync(path)) throw new Error(`project_demand_plan_seed_csv_missing:${path}`);
  const content = readFileSync(path, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as T[];
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`project_demand_plan_invalid_date:${value}`);
  }
  return parsed;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return value.trim().toLowerCase() === 'true';
}

function parseSkills(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split('|')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function seedProjectDemandPlanForTenant(
  input: SeedProjectDemandPlanInput,
): Promise<SeedProjectDemandPlanResult> {
  const db = input.db ?? pmoDb();
  const ingestionSessionId = input.ingestionSessionId ?? randomUUID();
  const csvPath = input.csvPath ?? DEFAULT_PROJECT_DEMAND_PLAN_CSV_PATH;
  const rows = parseCsvFile<ProjectDemandPlanCsvRow>(csvPath).filter((row) =>
    parseBoolean(row.is_active, true),
  );

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(projectDemandPlan).where(eq(projectDemandPlan.tenant_id, input.tenantId));
    if (rows.length === 0) return;
    await tx.insert(projectDemandPlan).values(
      rows.map((row, index) => {
        const values = {
          demand_id: row.demand_id,
          project_id: row.project_id,
          role_needed: row.role_needed,
          required_skills: parseSkills(row.required_skills),
          demand_start: parseDate(row.demand_start),
          demand_end: parseDate(row.demand_end),
          demand_pct: parseNumber(row.demand_pct),
          demand_hours_per_week: parseNumber(row.demand_hours_per_week),
          urgency: row.urgency?.trim().toLowerCase() || 'medium',
          priority_score: parseNumber(row.priority_score),
          confirmed: parseBoolean(row.confirmed, false),
          demand_source: row.demand_source?.trim() || 'seeded_mock',
          note: row.note?.trim() || null,
        };
        return {
          tenant_id: input.tenantId,
          natural_key_hash: computeNaturalKeyHash('project_demand_plan', input.tenantId, values),
          source_row_hash: computeSourceRowHash('project_demand_plan', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: index + 1,
          created_at: now,
          updated_at: now,
        };
      }),
    );
  });

  return {
    ok: true,
    tenantId: input.tenantId,
    ingestionSessionId,
    csvPath,
    inserted: rows.length,
  };
}
