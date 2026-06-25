import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { pmoDb } from '../db/client.ts';
import type * as schema from '../db/schema.ts';
import {
  calendarWeeks,
  ingestionSessions,
  leaveRecords,
  memberMaster,
  memberSkillsProjection,
  overbookIdleConfig,
  projectMaster,
  resourceAllocations,
  taskHistoryProjection,
  timesheets,
} from '../db/schema.ts';
import { computeNaturalKeyHash, computeSourceRowHash } from '../ingestion/stage-changes.ts';
import { syncRecommendationProjectionsFromDemoCsv } from '../reporting/recommendations/index.ts';
import { loadDefaultThresholdConfigs } from './default-threshold-config.ts';
import { tuneRecommendationResourceAllocations } from './tune-recommendation-allocations.ts';

const SEED_INGESTION_CREATED_BY = '00000000-0000-0000-0000-0000000000aa';

/** Where seed assets live: repo root (dev) or `apps/cli` (deployed server image). */
export function resolvePmoSeedAssetRoot(): string {
  if (process.env.PMO_SEED_ASSET_ROOT) {
    return process.env.PMO_SEED_ASSET_ROOT;
  }
  if (process.env.APP_HOME) {
    return resolve(process.env.APP_HOME, 'apps/cli');
  }

  const pmoPackageRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const monorepoRoot = resolve(pmoPackageRoot, '../../..');
  if (existsSync(resolve(monorepoRoot, 'pnpm-workspace.yaml'))) {
    return monorepoRoot;
  }

  const cliDir = resolve(pmoPackageRoot, '../..');
  if (existsSync(resolve(cliDir, 'hackathon/data'))) {
    return cliDir;
  }

  return monorepoRoot;
}

const SEED_ASSET_ROOT = resolvePmoSeedAssetRoot();

/** Committed PMO_02 canonical SQLite seed (baked into server image via hackathon/data). */
export const BUNDLED_PMO02_MOCK_DB_RELATIVE = 'hackathon/data/pmo_02_mock-data.db';

/** Resolve mock-data.db path; empty env vars are treated as unset (compose often sets ""). */
export function resolvePmoMockDbPath(override?: string): string {
  const fromOverride = override?.trim();
  if (fromOverride) return fromOverride;
  const fromEnv = process.env.PMO_MOCK_DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  const bundled = resolve(SEED_ASSET_ROOT, BUNDLED_PMO02_MOCK_DB_RELATIVE);
  if (existsSync(bundled)) return bundled;
  // Legacy dev fallback: repo-root mock-data.db from insert-mock.ts
  return resolve(SEED_ASSET_ROOT, 'mock-data.db');
}

export const DEFAULT_REPO_MOCK_DB_PATH = resolvePmoMockDbPath();

export function pmoMockDbExists(mockDbPath?: string): boolean {
  return existsSync(mockDbPath ?? resolvePmoMockDbPath());
}
export const DEFAULT_PMO02_WORKBOOK_PATH = resolve(
  SEED_ASSET_ROOT,
  'hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx',
);

export interface SeedPmo02FromMockDbInput {
  tenantId: string;
  mockDbPath?: string;
  ingestionSessionId?: string;
  db?: NodePgDatabase<typeof schema>;
}

export interface SeedPmo02FromMockDbResult {
  ok: true;
  tenantId: string;
  mockDbPath: string;
  ingestionSessionId: string;
  inserted: {
    members: number;
    weeks: number;
    configs: number;
    projects: number;
    allocations: number;
    timesheets: number;
    leaves: number;
    projectionMemberProfiles: number;
    recommendationSkills: number;
    recommendationTaskHistory: number;
  };
}

function now(): Date {
  return new Date();
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRequiredDate(field: string, iso: string | null | undefined): Date {
  const date = parseDate(iso);
  if (!date) throw new Error(`Invalid required PMO seed date for ${field}: ${iso ?? '<empty>'}`);
  return date;
}

function toBool(v: number | boolean | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  return v !== 0;
}

export function queryMockDbJson<T extends Record<string, unknown>>(
  mockDbPath: string,
  sqlText: string,
): T[] {
  const proc = spawnSync('sqlite3', ['-json', mockDbPath, sqlText], { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
  const trimmed = proc.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

function queryJson<T extends Record<string, unknown>>(mockDbPath: string, sqlText: string): T[] {
  return queryMockDbJson(mockDbPath, sqlText);
}

function readSeedCsv<T extends Record<string, string>>(filename: string): T[] {
  const filePath = resolve(SEED_ASSET_ROOT, 'hackathon/data', filename);
  if (!existsSync(filePath)) return [];
  return parse(readFileSync(filePath, 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as T[];
}

/** Build `mock-data.db` from PMO_02 workbook when missing (dev monorepo only). */
export function ensurePmo02MockSqliteDb(mockDbPath: string = DEFAULT_REPO_MOCK_DB_PATH): void {
  if (existsSync(mockDbPath)) return;

  throw new Error(
    `PMO mock SQLite DB not found at ${mockDbPath}; mock-data generation is disabled.`,
  );

  /*
  const assetRoot = resolvePmoSeedAssetRoot();
  const workbookPath = DEFAULT_PMO02_WORKBOOK_PATH;
  if (!existsSync(workbookPath)) {
    throw new Error(
      `PMO mock SQLite DB not found at ${mockDbPath} and workbook missing at ${workbookPath}. ` +
        'Run packages/pmo/scripts/insert-mock.ts locally or rebuild the server image.',
    );
  }

  const script = resolve(assetRoot, 'packages/pmo/scripts/insert-mock.ts');
  if (!existsSync(script)) {
    throw new Error(
      `PMO mock SQLite DB not found at ${mockDbPath} and cannot be built in this environment ` +
        `(missing ${script}). Rebuild/deploy the server image with a baked mock-data.db.`,
    );
  }

  const proc = spawnSync('node', ['--experimental-strip-types', script], {
    cwd: assetRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (proc.status !== 0) {
    throw new Error(`Failed to build mock-data.db: ${proc.stderr || proc.stdout}`);
  }
  if (!existsSync(mockDbPath)) {
    throw new Error(`insert-mock.ts completed but ${mockDbPath} was not created`);
  }
  */
}

/**
 * Load cleaned PMO_02 canonical rows from repo-root `mock-data.db` into Postgres `pmo.*`
 * for a tenant. Replaces any existing PMO canonical rows for that tenant.
 */
export async function seedPmo02FromMockDbForTenant(
  input: SeedPmo02FromMockDbInput,
): Promise<SeedPmo02FromMockDbResult> {
  const mockDbPath = resolvePmoMockDbPath(input.mockDbPath);
  ensurePmo02MockSqliteDb(mockDbPath);

  const tenantId = input.tenantId;
  const ingestionSessionId = input.ingestionSessionId ?? randomUUID();
  const db = input.db ?? pmoDb();

  const members = queryJson<{
    member_id: string;
    full_name: string;
    department: string | null;
    role_title: string | null;
    level: string | null;
    line_manager_id: string | null;
    employment_status: string | null;
    employment: string | null;
    std_hours_week: number | null;
    join_date: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT member_id, full_name, department, role_title, level, line_manager_id,
            employment_status, employment, std_hours_week, join_date, source_row
     FROM pmo_member_master WHERE is_active = 1`,
  );

  const weeks = queryJson<{
    week_id: string;
    week_start: string;
    week_end: string;
    working_days: number;
    holiday_hours_ft: number | null;
    note: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT week_id, week_start, week_end, working_days, holiday_hours_ft, note, source_row
     FROM pmo_calendar_weeks WHERE is_active = 1`,
  );

  const configsFromMock = queryJson<{
    config_id: string;
    rule_name: string;
    overbook_threshold: number;
    overbook_red_threshold: number | null;
    idle_threshold: number;
    mismatch_pct_threshold: number | null;
    ot_max_hours_per_week: number | null;
    required_training_hours: number | null;
    effective_date: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT config_id, rule_name, overbook_threshold, overbook_red_threshold, idle_threshold,
            mismatch_pct_threshold, ot_max_hours_per_week, required_training_hours, effective_date, source_row
     FROM pmo_overbook_idle_config WHERE is_active = 1`,
  );
  const configs =
    configsFromMock.length > 0
      ? configsFromMock
      : loadDefaultThresholdConfigs().map((config, index) => ({
          config_id: config.config_id,
          rule_name: config.rule_name,
          overbook_threshold: config.overbook_threshold,
          overbook_red_threshold: config.overbook_red_threshold ?? null,
          idle_threshold: config.idle_threshold,
          mismatch_pct_threshold: config.mismatch_pct_threshold ?? null,
          ot_max_hours_per_week: config.ot_max_hours_per_week ?? null,
          required_training_hours: config.required_training_hours ?? null,
          effective_date: config.effective_date,
          source_row: index + 1,
        }));

  const allocations = tuneRecommendationResourceAllocations(
    queryJson<{
      member_id: string;
      project_id: string;
      role: string | null;
      allocation_pct: number;
      start_date: string;
      end_date: string;
      weekly_planned_hours: number | null;
      source_row: number | null;
    }>(
      mockDbPath,
      `SELECT member_id, project_id, role, allocation_pct, start_date, end_date, weekly_planned_hours, source_row
       FROM pmo_resource_allocations WHERE is_active = 1`,
    ),
  );

  const tsRows = queryJson<{
    member_id: string;
    project_id: string | null;
    work_date: string;
    logged_hours: number;
    log_category: string | null;
    task_ref: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT member_id, project_id, work_date, logged_hours, log_category, task_ref, source_row
     FROM pmo_timesheets WHERE is_active = 1`,
  );

  const leaves = queryJson<{
    record_id: string | null;
    member_id: string | null;
    leave_date: string;
    leave_type: string;
    approved: number | null;
    duration_days: number | null;
    note: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT record_id, member_id, leave_date, leave_type, approved, duration_days, note, source_row
     FROM pmo_leave_records WHERE is_active = 1`,
  );

  const projects = queryJson<{
    project_id: string;
    project_name: string;
    account_id: string | null;
    project_type: string | null;
    status: string | null;
    pm_id: string | null;
    start_date: string | null;
    end_date: string | null;
    source_row: number | null;
  }>(
    mockDbPath,
    `SELECT project_id, project_name, account_id, project_type, status, pm_id, start_date, end_date, source_row
     FROM pmo_project_master WHERE is_active = 1`,
  );

  if (members.length === 0 || weeks.length === 0) {
    throw new Error(`mock-data.db at ${mockDbPath} has no active PMO member/week rows`);
  }

  await db.insert(ingestionSessions).values({
    id: ingestionSessionId,
    tenant_id: tenantId,
    status: 'published',
    source_kind: 'seed',
    source_file_key: `seed://${mockDbPath}`,
    source_file_name: 'PMO_02_RA_Timesheet_Monitoring.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    reporting_period_key: 'PMO_02',
    reporting_period_start: parseRequiredDate('reporting_period_start', '2026-06-29'),
    reporting_period_end: parseRequiredDate('reporting_period_end', '2026-08-07'),
    created_by: SEED_INGESTION_CREATED_BY,
    publish_reviewed_at: now(),
    created_at: now(),
    finished_at: now(),
  });

  const mockMemberIds = new Set(members.map((m) => m.member_id));
  const projectionMemberProfiles = readSeedCsv<{
    member_id: string;
    full_name: string;
    department: string;
    role_title: string;
    level: string;
    employment_status: string;
    std_hours_week: string;
    join_date: string;
    line_manager_id: string;
    is_active: string;
  }>('pmo_02_member_profiles.csv').filter(
    (profile) => profile.member_id && !mockMemberIds.has(profile.member_id),
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM ${taskHistoryProjection} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(
      sql`DELETE FROM ${memberSkillsProjection} WHERE tenant_id = ${tenantId}::uuid`,
    );
    await tx.execute(sql`DELETE FROM ${timesheets} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${resourceAllocations} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${leaveRecords} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${memberMaster} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${projectMaster} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${calendarWeeks} WHERE tenant_id = ${tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM ${overbookIdleConfig} WHERE tenant_id = ${tenantId}::uuid`);

    await tx.insert(memberMaster).values(
      members.map((m) => {
        const values = {
          member_id: m.member_id,
          full_name: m.full_name,
          department: m.department,
          role_title: m.role_title,
          level: m.level,
          line_manager_id: m.line_manager_id,
          employment_status: m.employment_status,
          employment: m.employment,
          std_hours_week: m.std_hours_week,
          join_date: parseDate(m.join_date),
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('member_master', tenantId, values),
          source_row_hash: computeSourceRowHash('member_master', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: m.source_row,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    if (projectionMemberProfiles.length > 0) {
      await tx.insert(memberMaster).values(
        projectionMemberProfiles.map((m, index) => {
          const values = {
            member_id: m.member_id,
            full_name: m.full_name,
            department: m.department || null,
            role_title: m.role_title || null,
            level: m.level || null,
            line_manager_id: m.line_manager_id || null,
            employment_status: m.employment_status || null,
            employment: null,
            std_hours_week: m.std_hours_week ? Number(m.std_hours_week) : null,
            join_date: parseDate(m.join_date),
          };
          return {
            tenant_id: tenantId,
            natural_key_hash: computeNaturalKeyHash('member_master', tenantId, values),
            source_row_hash: computeSourceRowHash('member_master', values),
            last_ingestion_session_id: ingestionSessionId,
            is_active: m.is_active !== 'false',
            ...values,
            source_row: members.length + index + 1,
            created_at: now(),
            updated_at: now(),
          };
        }),
      );
    }

    await tx.insert(calendarWeeks).values(
      weeks.map((w) => {
        const weekStart = parseRequiredDate('calendar_weeks.week_start', w.week_start);
        const weekEnd = parseRequiredDate('calendar_weeks.week_end', w.week_end);
        const values = {
          week_id: w.week_id,
          week_start: weekStart,
          week_end: weekEnd,
          working_days: w.working_days,
          holiday_hours_ft: w.holiday_hours_ft,
          note: w.note,
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('calendar_weeks', tenantId, values),
          source_row_hash: computeSourceRowHash('calendar_weeks', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: w.source_row,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    if (configs.length > 0) {
      await tx.insert(overbookIdleConfig).values(
        configs.map((c) => {
          const values = {
            config_id: c.config_id,
            rule_name: c.rule_name,
            overbook_threshold: c.overbook_threshold,
            overbook_red_threshold: c.overbook_red_threshold,
            idle_threshold: c.idle_threshold,
            mismatch_pct_threshold: c.mismatch_pct_threshold,
            ot_max_hours_per_week: c.ot_max_hours_per_week,
            required_training_hours: c.required_training_hours,
            effective_date: parseDate(c.effective_date),
          };
          return {
            tenant_id: tenantId,
            natural_key_hash: computeNaturalKeyHash('overbook_idle_config', tenantId, values),
            source_row_hash: computeSourceRowHash('overbook_idle_config', values),
            last_ingestion_session_id: ingestionSessionId,
            is_active: true,
            ...values,
            source_row: c.source_row,
            created_at: now(),
            updated_at: now(),
          };
        }),
      );
    }

    await tx.insert(projectMaster).values(
      projects.map((p) => {
        const values = {
          project_id: p.project_id,
          project_name: p.project_name,
          account_id: p.account_id,
          project_type: p.project_type,
          status: p.status,
          pm_id: p.pm_id,
          start_date: parseDate(p.start_date),
          end_date: parseDate(p.end_date),
        };
        return {
          tenant_id: tenantId,
          natural_key_hash: computeNaturalKeyHash('project_master', tenantId, values),
          source_row_hash: computeSourceRowHash('project_master', values),
          last_ingestion_session_id: ingestionSessionId,
          is_active: true,
          ...values,
          source_row: p.source_row,
          created_at: now(),
          updated_at: now(),
        };
      }),
    );

    if (allocations.length > 0) {
      await tx.insert(resourceAllocations).values(
        allocations.map((a) => {
          const startDate = parseRequiredDate('resource_allocation.start_date', a.start_date);
          const endDate = parseRequiredDate('resource_allocation.end_date', a.end_date);
          const values = {
            member_id: a.member_id,
            project_id: a.project_id,
            start_date: startDate,
            end_date: endDate,
            allocation_pct: a.allocation_pct,
            weekly_planned_hours: a.weekly_planned_hours,
            role: a.role,
          };
          return {
            tenant_id: tenantId,
            natural_key_hash: computeNaturalKeyHash('resource_allocation', tenantId, values),
            source_row_hash: computeSourceRowHash('resource_allocation', values),
            last_ingestion_session_id: ingestionSessionId,
            is_active: true,
            member_id: a.member_id,
            project_id: a.project_id,
            role: a.role,
            allocation_pct: a.allocation_pct,
            start_date: startDate,
            end_date: endDate,
            weekly_planned_hours: a.weekly_planned_hours,
            source_row: a.source_row,
            created_at: now(),
            updated_at: now(),
          };
        }),
      );
    }

    const BATCH = 200;
    for (let i = 0; i < tsRows.length; i += BATCH) {
      const batch = tsRows.slice(i, i + BATCH);
      await tx.insert(timesheets).values(
        batch.map((t) => {
          const workDate = parseRequiredDate('timesheet.work_date', t.work_date);
          const values = {
            member_id: t.member_id,
            work_date: workDate,
            project_id: t.project_id,
            log_category: t.log_category,
            logged_hours: t.logged_hours,
          };
          return {
            tenant_id: tenantId,
            natural_key_hash: computeNaturalKeyHash('timesheet', tenantId, values),
            source_row_hash: computeSourceRowHash('timesheet', {
              ...values,
              task_ref: t.task_ref,
            }),
            last_ingestion_session_id: ingestionSessionId,
            is_active: true,
            member_id: t.member_id,
            project_id: t.project_id,
            work_date: workDate,
            logged_hours: t.logged_hours,
            log_category: t.log_category,
            task_ref: t.task_ref,
            source_row: t.source_row,
            created_at: now(),
            updated_at: now(),
          };
        }),
      );
    }

    if (leaves.length > 0) {
      await tx.insert(leaveRecords).values(
        leaves.map((l) => {
          const leaveDate = parseRequiredDate('leave.leave_date', l.leave_date);
          const values = {
            member_id: l.member_id,
            leave_date: leaveDate,
            leave_type: l.leave_type,
          };
          const hashValues = {
            ...values,
            approved: toBool(l.approved),
            duration_days: l.duration_days,
            record_id: l.record_id,
            note: l.note,
          };
          return {
            tenant_id: tenantId,
            natural_key_hash: computeNaturalKeyHash('leave', tenantId, values),
            source_row_hash: computeSourceRowHash('leave', hashValues),
            last_ingestion_session_id: ingestionSessionId,
            is_active: true,
            record_id: l.record_id,
            member_id: l.member_id,
            leave_date: leaveDate,
            leave_type: l.leave_type,
            approved: toBool(l.approved),
            duration_days: l.duration_days,
            note: l.note,
            source_row: l.source_row,
            created_at: now(),
            updated_at: now(),
          };
        }),
      );
    }
  });
  const projectionCounts = await syncRecommendationProjectionsFromDemoCsv({ tenantId });

  return {
    ok: true,
    tenantId,
    mockDbPath,
    ingestionSessionId,
    inserted: {
      members: members.length,
      weeks: weeks.length,
      configs: configs.length,
      projects: projects.length,
      allocations: allocations.length,
      timesheets: tsRows.length,
      leaves: leaves.length,
      projectionMemberProfiles: projectionMemberProfiles.length,
      recommendationSkills: projectionCounts.skills,
      recommendationTaskHistory: projectionCounts.taskHistory,
    },
  };
}
