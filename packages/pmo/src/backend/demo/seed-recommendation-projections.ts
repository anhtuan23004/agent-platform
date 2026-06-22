import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { pmoDb } from '../db/client.ts';
import type * as schema from '../db/schema.ts';
import { memberMaster } from '../db/schema.ts';
import { computeNaturalKeyHash, computeSourceRowHash } from '../ingestion/stage-changes.ts';
import {
  getRecommendationProjectionFreshness,
  syncMemberSkillProjection,
  syncTaskHistoryProjection,
} from '../reporting/recommendations/sync-projections.ts';
import { resolvePmoSeedAssetRoot } from './seed-from-mock-db.ts';

const DEFAULT_PROFILES_CSV_PATH = resolve(
  resolvePmoSeedAssetRoot(),
  'hackathon/data/pmo_02_member_profiles.csv',
);
const DEFAULT_SKILLS_CSV_PATH = resolve(
  resolvePmoSeedAssetRoot(),
  'hackathon/data/pmo_02_member_skills.csv',
);
const DEFAULT_TASK_HISTORY_CSV_PATH = resolve(
  resolvePmoSeedAssetRoot(),
  'hackathon/data/pmo_02_member_task_history.csv',
);

interface RecommendationProfileCsvRow {
  tenant_id?: string;
  member_id: string;
  full_name: string;
  department?: string;
  role_title?: string;
  level?: string;
  employment_status?: string;
  std_hours_week?: string;
  join_date?: string;
  line_manager_id?: string;
  is_active?: string;
  source?: string;
  synced_at?: string;
  source_version?: string;
}

interface RecommendationSkillCsvRow {
  tenant_id?: string;
  member_id: string;
  skill: string;
  proficiency_level?: string;
  is_primary?: string;
  evidence_confidence?: string;
  source?: string;
  observed_at?: string;
  updated_at?: string;
  source_version?: string;
}

interface RecommendationTaskHistoryCsvRow {
  tenant_id?: string;
  history_id: string;
  member_id: string;
  project_id?: string;
  project_name?: string;
  project_type?: string;
  allocation_role?: string;
  task_title: string;
  task_summary?: string;
  total_logged_hours?: string;
  skill_tags?: string;
  completed_at?: string;
  evidence_confidence?: string;
  source?: string;
  synced_at?: string;
  source_version?: string;
  embedding_text?: string;
  embedding_source_hash?: string;
}

export interface SeedRecommendationProjectionsInput {
  tenantId: string;
  ingestionSessionId?: string;
  profilesCsvPath?: string;
  skillsCsvPath?: string;
  taskHistoryCsvPath?: string;
  bootstrapMissingMembers?: boolean;
  db?: NodePgDatabase<typeof schema>;
}

export interface SeedRecommendationProjectionsResult {
  ok: true;
  tenantId: string;
  ingestionSessionId: string;
  sourcePaths: {
    profilesCsvPath: string;
    skillsCsvPath: string;
    taskHistoryCsvPath: string;
  };
  inserted: {
    bootstrappedMembers: number;
    skillRows: number;
    taskHistoryRows: number;
  };
  skipped: {
    missingMemberProfiles: number;
    missingMemberSkillRows: number;
    missingMemberTaskHistoryRows: number;
  };
  freshness: {
    skillCount: number;
    taskCount: number;
    latestSkillSyncAt: Date | null;
    latestTaskSyncAt: Date | null;
  };
}

function parseCsvFile<T>(path: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`recommendation_seed_csv_missing:${path}`);
  }
  const content = readFileSync(path, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as T[];
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
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

async function bootstrapMembersFromProfiles(input: {
  db: NodePgDatabase<typeof schema>;
  tenantId: string;
  ingestionSessionId: string;
  profiles: RecommendationProfileCsvRow[];
}): Promise<{ inserted: number; skippedMissingProfiles: number }> {
  const activeProfiles = input.profiles.filter((row) => parseBoolean(row.is_active, true));
  if (activeProfiles.length === 0) return { inserted: 0, skippedMissingProfiles: 0 };

  const existing = await input.db
    .select({ memberId: memberMaster.member_id })
    .from(memberMaster)
    .where(and(eq(memberMaster.tenant_id, input.tenantId), eq(memberMaster.is_active, true)));
  const existingIds = new Set(existing.map((row) => row.memberId));

  const missingProfiles = activeProfiles.filter((row) => !existingIds.has(row.member_id));
  if (missingProfiles.length === 0) return { inserted: 0, skippedMissingProfiles: 0 };

  const now = new Date();
  await input.db.insert(memberMaster).values(
    missingProfiles.map((row, index) => {
      const values = {
        member_id: row.member_id,
        full_name: row.full_name,
        department: row.department ?? null,
        role_title: row.role_title ?? null,
        level: row.level ?? null,
        line_manager_id: row.line_manager_id ?? null,
        employment_status: row.employment_status ?? 'Active',
        employment: null,
        std_hours_week: parseNumber(row.std_hours_week),
        join_date: row.join_date ? parseDate(row.join_date, now) : null,
      };
      return {
        tenant_id: input.tenantId,
        natural_key_hash: computeNaturalKeyHash('member_master', input.tenantId, values),
        source_row_hash: computeSourceRowHash('member_master', values),
        last_ingestion_session_id: input.ingestionSessionId,
        is_active: true,
        ...values,
        source_row: index + 1,
        created_at: now,
        updated_at: now,
      };
    }),
  );

  return { inserted: missingProfiles.length, skippedMissingProfiles: 0 };
}

export async function seedRecommendationProjectionsForTenant(
  input: SeedRecommendationProjectionsInput,
): Promise<SeedRecommendationProjectionsResult> {
  const db = input.db ?? pmoDb();
  const ingestionSessionId = input.ingestionSessionId ?? randomUUID();
  const profilesCsvPath = input.profilesCsvPath ?? DEFAULT_PROFILES_CSV_PATH;
  const skillsCsvPath = input.skillsCsvPath ?? DEFAULT_SKILLS_CSV_PATH;
  const taskHistoryCsvPath = input.taskHistoryCsvPath ?? DEFAULT_TASK_HISTORY_CSV_PATH;
  const profiles = parseCsvFile<RecommendationProfileCsvRow>(profilesCsvPath);
  const skills = parseCsvFile<RecommendationSkillCsvRow>(skillsCsvPath);
  const taskHistory = parseCsvFile<RecommendationTaskHistoryCsvRow>(taskHistoryCsvPath);

  const bootstrap = input.bootstrapMissingMembers ?? true;
  const { inserted: bootstrappedMembers } = bootstrap
    ? await bootstrapMembersFromProfiles({
        db,
        tenantId: input.tenantId,
        ingestionSessionId,
        profiles,
      })
    : { inserted: 0 };

  const memberRows = await db
    .select({ memberId: memberMaster.member_id })
    .from(memberMaster)
    .where(and(eq(memberMaster.tenant_id, input.tenantId), eq(memberMaster.is_active, true)));
  const knownMembers = new Set(memberRows.map((row) => row.memberId));

  let skillRows = 0;
  let taskHistoryRows = 0;
  let missingMemberSkillRows = 0;
  let missingMemberTaskHistoryRows = 0;

  for (const row of skills) {
    if (!knownMembers.has(row.member_id)) {
      missingMemberSkillRows += 1;
      continue;
    }
    await syncMemberSkillProjection({
      tenantId: input.tenantId,
      memberId: row.member_id,
      skillName: row.skill,
      proficiencyLevel: parseNumber(row.proficiency_level),
      evidenceConfidence: parseNumber(row.evidence_confidence) ?? 1,
      source: row.source ?? 'derived_pmo02',
      sourceVersion: row.source_version ?? 'pmo02-recommendation-mock-v1',
      idempotencyKey: `seed-skill:${row.member_id}:${row.skill.toLowerCase()}`,
      observedAt: parseDate(row.observed_at, new Date('2026-06-29T00:00:00.000Z')),
      syncedAt: parseDate(row.updated_at, new Date()),
    });
    skillRows += 1;
  }

  for (const row of taskHistory) {
    if (!knownMembers.has(row.member_id)) {
      missingMemberTaskHistoryRows += 1;
      continue;
    }
    await syncTaskHistoryProjection({
      tenantId: input.tenantId,
      historyId: row.history_id,
      memberId: row.member_id,
      projectId: row.project_id ?? null,
      allocationRole: row.allocation_role ?? null,
      taskTitle: row.task_title,
      taskSummary: row.task_summary ?? null,
      skillTags: row.skill_tags ? row.skill_tags.split('|').map((item) => item.trim()) : [],
      completedAt: parseDate(row.completed_at, new Date('2026-08-07T23:59:59.000Z')),
      evidenceConfidence: parseNumber(row.evidence_confidence) ?? 1,
      embedding: null,
      embeddingModelId: null,
      embeddingSourceHash: row.embedding_source_hash?.trim() || null,
      source: row.source ?? 'derived_pmo02',
      sourceVersion: row.source_version ?? 'pmo02-recommendation-mock-v1',
      idempotencyKey: `seed-task:${row.history_id}`,
      syncedAt: parseDate(row.synced_at, new Date()),
    });
    taskHistoryRows += 1;
  }

  const freshness = await getRecommendationProjectionFreshness(input.tenantId);
  return {
    ok: true,
    tenantId: input.tenantId,
    ingestionSessionId,
    sourcePaths: {
      profilesCsvPath,
      skillsCsvPath,
      taskHistoryCsvPath,
    },
    inserted: {
      bootstrappedMembers,
      skillRows,
      taskHistoryRows,
    },
    skipped: {
      missingMemberProfiles: 0,
      missingMemberSkillRows,
      missingMemberTaskHistoryRows,
    },
    freshness,
  };
}
