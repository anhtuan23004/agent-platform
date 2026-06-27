/**
 * Patch bundled PMO_02 SQLite so rebalance candidates have RA overlap with the
 * planning window (Mon 2026-08-10+). Idempotent.
 *
 * Usage:
 *   pnpm --filter @seta/pmo exec tsx scripts/tune-mock-data-db.ts
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { resolvePmoMockDbPath } from '../src/backend/demo/seed-from-mock-db.ts';
import {
  type TunableAllocationRow,
  tuneRecommendationResourceAllocations,
} from '../src/backend/demo/tune-recommendation-allocations.ts';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INGESTION_ID = '00000000-0000-0000-0000-0000000000bb';

const mockDbPath = resolvePmoMockDbPath(process.env.PMO_MOCK_DB_PATH);

function sqlString(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function hash(prefix: string, payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${prefix}:${JSON.stringify(payload)}`)
    .digest('hex');
}

function queryJson<T extends Record<string, unknown>>(sqlText: string): T[] {
  const proc = spawnSync('sqlite3', ['-json', mockDbPath, sqlText], { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
  const trimmed = proc.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

function runSql(statements: string[]): void {
  const proc = spawnSync('sqlite3', [mockDbPath], {
    input: `${statements.join('\n')}\n`,
    encoding: 'utf8',
  });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
}

const currentAllocations = queryJson<TunableAllocationRow>(
  `SELECT member_id, project_id, role, allocation_pct, start_date, end_date, weekly_planned_hours, source_row
   FROM pmo_resource_allocations WHERE is_active = 1`,
);
const tunedAllocations = tuneRecommendationResourceAllocations(currentAllocations);
const currentByKey = new Map(
  currentAllocations.map((row) => [`${row.member_id}:${row.project_id}:${row.role ?? ''}`, row]),
);
const tunedByKey = new Map(
  tunedAllocations.map((row) => [`${row.member_id}:${row.project_id}:${row.role ?? ''}`, row]),
);

const statements: string[] = ['BEGIN;'];

for (const [key, row] of tunedByKey) {
  const existing = currentByKey.get(key);
  if (existing) {
    const endChanged = existing.end_date !== row.end_date;
    const pctChanged = existing.allocation_pct !== row.allocation_pct;
    const hoursChanged = existing.weekly_planned_hours !== row.weekly_planned_hours;
    if (!endChanged && !pctChanged && !hoursChanged) continue;
    statements.push(
      `UPDATE pmo_resource_allocations SET ` +
        `end_date=${sqlString(row.end_date)},` +
        `allocation_pct=${row.allocation_pct},` +
        `weekly_planned_hours=${row.weekly_planned_hours ?? 'NULL'} ` +
        `WHERE is_active=1 AND member_id=${sqlString(row.member_id)} ` +
        `AND project_id=${sqlString(row.project_id)} ` +
        `AND COALESCE(role,'')=${sqlString(row.role ?? '')};`,
    );
    continue;
  }

  const values = {
    member_id: row.member_id,
    project_id: row.project_id,
    role: row.role,
    allocation_pct: row.allocation_pct,
    start_date: row.start_date,
    end_date: row.end_date,
    weekly_planned_hours: row.weekly_planned_hours,
  };
  statements.push(
    `INSERT INTO pmo_resource_allocations (` +
      `tenant_id,natural_key_hash,source_row_hash,last_ingestion_session_id,is_active,` +
      `member_id,project_id,role,allocation_pct,start_date,end_date,weekly_planned_hours,source_row` +
      `) VALUES (` +
      `${sqlString(TENANT_ID)},${sqlString(hash('resource_allocation', values))},` +
      `${sqlString(hash('source', values))},${sqlString(INGESTION_ID)},1,` +
      `${sqlString(row.member_id)},${sqlString(row.project_id)},${sqlString(row.role)},` +
      `${row.allocation_pct},${sqlString(row.start_date)},${sqlString(row.end_date)},` +
      `${row.weekly_planned_hours ?? 'NULL'},${row.source_row ?? 'NULL'});`,
  );
}

const profiles = parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../hackathon/data/pmo_02_member_profiles.csv'),
    'utf8',
  ),
  { columns: true, skip_empty_lines: true },
) as Array<Record<string, string>>;

const existingMembers = new Set(
  queryJson<{ member_id: string }>(
    `SELECT member_id FROM pmo_member_master WHERE is_active = 1`,
  ).map((row) => row.member_id),
);

for (const memberId of ['EMP-119', 'EMP-120']) {
  if (existingMembers.has(memberId)) continue;
  const profile = profiles.find((row) => row.member_id === memberId);
  if (!profile) throw new Error(`Missing profile row for ${memberId}`);

  const values = {
    member_id: profile.member_id,
    full_name: profile.full_name,
    department: profile.department,
    role_title: profile.role_title,
    level: profile.level,
    employment_status: 'Active',
    employment: 'FT',
    std_hours_week: Number(profile.std_hours_week ?? 40),
    join_date: profile.join_date ?? '2020-01-01',
  };
  statements.push(
    `INSERT INTO pmo_member_master (` +
      `tenant_id,natural_key_hash,source_row_hash,last_ingestion_session_id,is_active,` +
      `member_id,full_name,department,role_title,level,line_manager_id,employment_status,employment,` +
      `std_hours_week,join_date,source_row` +
      `) VALUES (` +
      `${sqlString(TENANT_ID)},${sqlString(hash('member_master', values))},` +
      `${sqlString(hash('source', values))},${sqlString(INGESTION_ID)},1,` +
      `${sqlString(values.member_id)},${sqlString(values.full_name)},${sqlString(values.department)},` +
      `${sqlString(values.role_title)},${sqlString(values.level)},${sqlString(profile.line_manager_id || null)},` +
      `${sqlString(values.employment_status)},${sqlString(values.employment)},${values.std_hours_week},` +
      `${sqlString(values.join_date)},999);`,
  );
}

statements.push('COMMIT;');
runSql(statements);

const summary = queryJson<{ member_id: string; project_id: string; end_date: string }>(
  `SELECT member_id, project_id, end_date FROM pmo_resource_allocations
   WHERE is_active=1 AND member_id IN ('EMP-103','EMP-113','EMP-119','EMP-120')
   ORDER BY member_id, project_id`,
);
console.log(JSON.stringify({ mockDbPath, tunedRows: summary }, null, 2));
