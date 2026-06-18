/**
 * Single-entry mock inserter for PMO_02.
 *
 * Cleans + normalizes `hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx`
 * using the repo ingestion pipeline, then overwrites repo-root `mock-data.db`
 * (SQLite) with canonical tables and inserts the cleaned rows.
 *
 * Contract: output is post-ingestion canonical data (RA dedup, timesheet
 * aggregate). Downstream analytics assumes this DB is already clean.
 *
 * Usage:
 *   pnpm --filter @seta/pmo exec tsx scripts/insert-mock.ts
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { detectSchema } from '../src/backend/ingestion/detect-schema.ts';
import { type NormalizedRow, normalizeRows } from '../src/backend/ingestion/normalize-rows.ts';
import { parseWorkbook } from '../src/backend/ingestion/parse-workbook.ts';
import {
  aggregateTimesheetRows,
  computeNaturalKeyHash,
  computeSourceRowHash,
} from '../src/backend/ingestion/stage-changes.ts';
import {
  exportMockSkillsCsv,
  type MockAllocationWithProject,
} from './lib/export-mock-skills-csv.ts';
import {
  buildMemberSkillsAndHistory,
  type MemberSkillsProfile,
  type MemberTaskHistoryEntry,
} from './lib/mock-member-skills-history.ts';

type CanonicalTableId =
  | 'resource_allocation'
  | 'timesheet'
  | 'leave'
  | 'member_master'
  | 'project_master'
  | 'overbook_idle_config'
  | 'calendar_weeks'
  | 'kpi_norms';

const WORKBOOK_PATH = resolve(
  import.meta.dirname,
  '../../../hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx',
);
const DB_PATH = resolve(import.meta.dirname, '../../../mock-data.db');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CREATED_BY = '00000000-0000-0000-0000-0000000000aa';
const INGESTION_ID = '00000000-0000-0000-0000-0000000000bb';

function sqlString(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

function toIntBool(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v !== 0 ? 1 : 0;
  const lower = String(v).trim().toLowerCase();
  if (['true', 'yes', '1', 'y'].includes(lower)) return 1;
  if (['false', 'no', '0', 'n'].includes(lower)) return 0;
  return null;
}

function cleanMappings(result: Awaited<ReturnType<typeof detectSchema>>) {
  // Offline import: treat auto_accept + needs_review as confirmed; drop blocked.
  return result.tables.map((t) => ({
    ...t,
    mappings: t.mappings.filter((m) => m.status !== 'blocked'),
  }));
}

function dedupeByNaturalKey(tableId: CanonicalTableId, rows: NormalizedRow[]): NormalizedRow[] {
  // Only enforce for tables where duplicates are always data-quality issues.
  // Timesheets have a bespoke policy (aggregate), handled elsewhere.
  if (tableId !== 'resource_allocation') return rows;

  const seen = new Set<string>();
  const out: NormalizedRow[] = [];

  for (const r of rows) {
    const k = computeNaturalKeyHash(tableId, TENANT_ID, r.values);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }

  return out;
}

function canonicalRowsFor(tableId: CanonicalTableId, rows: NormalizedRow[]): NormalizedRow[] {
  if (tableId === 'timesheet') return aggregateTimesheetRows(TENANT_ID, rows);
  return dedupeByNaturalKey(tableId, rows);
}

function sqliteSchemaSql(): string {
  return `
PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS pmo_ingestion_sessions;
DROP TABLE IF EXISTS pmo_calendar_weeks;
DROP TABLE IF EXISTS pmo_member_master;
DROP TABLE IF EXISTS pmo_project_master;
DROP TABLE IF EXISTS pmo_overbook_idle_config;
DROP TABLE IF EXISTS pmo_resource_allocations;
DROP TABLE IF EXISTS pmo_timesheets;
DROP TABLE IF EXISTS pmo_leave_records;
DROP TABLE IF EXISTS pmo_kpi_norms;
DROP TABLE IF EXISTS pmo_member_skills;
DROP TABLE IF EXISTS pmo_member_task_history;

CREATE TABLE pmo_ingestion_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_file_key TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  reporting_period_key TEXT,
  reporting_period_start TEXT,
  reporting_period_end TEXT,
  workbook_confidence REAL,
  created_by TEXT NOT NULL,
  created_at TEXT,
  confirmed_at TEXT,
  finished_at TEXT
);

CREATE TABLE pmo_calendar_weeks (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  working_days INTEGER NOT NULL,
  holiday_hours_ft REAL,
  note TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_member_master (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  department TEXT,
  role_title TEXT,
  level TEXT,
  line_manager_id TEXT,
  employment_status TEXT,
  employment TEXT,
  std_hours_week REAL,
  join_date TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_project_master (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  account_id TEXT,
  project_type TEXT,
  status TEXT,
  pm_id TEXT,
  start_date TEXT,
  end_date TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_overbook_idle_config (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  config_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  overbook_threshold REAL NOT NULL,
  overbook_red_threshold REAL,
  idle_threshold REAL NOT NULL,
  mismatch_pct_threshold REAL,
  ot_max_hours_per_week REAL,
  required_training_hours REAL,
  effective_date TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_resource_allocations (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT,
  allocation_pct REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  weekly_planned_hours REAL,
  source_row INTEGER
);

CREATE TABLE pmo_timesheets (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  project_id TEXT,
  work_date TEXT NOT NULL,
  logged_hours REAL NOT NULL,
  log_category TEXT,
  task_ref TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_leave_records (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  record_id TEXT,
  member_id TEXT,
  leave_date TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  approved INTEGER,
  duration_days REAL,
  note TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_kpi_norms (
  tenant_id TEXT NOT NULL,
  natural_key_hash TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  last_ingestion_session_id TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  norm_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  formula TEXT,
  green TEXT,
  yellow TEXT,
  red TEXT,
  used_for TEXT,
  source_row INTEGER
);

CREATE TABLE pmo_member_skills (
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  PRIMARY KEY (tenant_id, member_id, skill)
);

CREATE TABLE pmo_member_task_history (
  tenant_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  project_type TEXT,
  allocation_role TEXT NOT NULL,
  task_title TEXT NOT NULL,
  task_summary TEXT,
  total_logged_hours REAL NOT NULL,
  skill_tags TEXT NOT NULL,
  PRIMARY KEY (tenant_id, history_id)
);
`.trim();
}

function rowStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function rowNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function deriveSkillsAndHistory(perTable: Partial<Record<CanonicalTableId, NormalizedRow[]>>) {
  const members = (perTable.member_master ?? []).map((r) => ({
    member_id: rowStr(r.values.member_id),
    full_name: rowStr(r.values.full_name),
    department: r.values.department ? rowStr(r.values.department) : null,
    role_title: r.values.role_title ? rowStr(r.values.role_title) : null,
    level: r.values.level ? rowStr(r.values.level) : null,
  }));
  const allocations = (perTable.resource_allocation ?? []).map((r) => ({
    member_id: rowStr(r.values.member_id),
    project_id: rowStr(r.values.project_id),
    role: r.values.role ? rowStr(r.values.role) : null,
    allocation_pct: r.values.allocation_pct != null ? rowNum(r.values.allocation_pct) : null,
  }));
  const projects = (perTable.project_master ?? []).map((r) => ({
    project_id: rowStr(r.values.project_id),
    project_name: rowStr(r.values.project_name),
    project_type: r.values.project_type ? rowStr(r.values.project_type) : null,
  }));
  const timesheets = (perTable.timesheet ?? []).map((r) => ({
    member_id: rowStr(r.values.member_id),
    project_id: r.values.project_id ? rowStr(r.values.project_id) : null,
    logged_hours: rowNum(r.values.logged_hours),
    log_category: r.values.log_category ? rowStr(r.values.log_category) : null,
  }));
  return buildMemberSkillsAndHistory({ members, allocations, projects, timesheets });
}

function deriveAllocationsWithProjects(
  perTable: Partial<Record<CanonicalTableId, NormalizedRow[]>>,
): MockAllocationWithProject[] {
  const projects = new Map(
    (perTable.project_master ?? []).map((r) => [
      rowStr(r.values.project_id),
      {
        project_name: rowStr(r.values.project_name),
        project_type: r.values.project_type ? rowStr(r.values.project_type) : '',
      },
    ]),
  );
  return (perTable.resource_allocation ?? [])
    .map((r) => {
      const project_id = rowStr(r.values.project_id);
      const project = projects.get(project_id);
      if (!project) return null;
      return {
        member_id: rowStr(r.values.member_id),
        project_id,
        project_name: project.project_name,
        project_type: project.project_type,
        role: r.values.role ? rowStr(r.values.role) : null,
        weekly_planned_hours:
          r.values.weekly_planned_hours != null ? rowNum(r.values.weekly_planned_hours) : null,
      };
    })
    .filter((row): row is MockAllocationWithProject => row !== null);
}

function buildMemberSkillsInserts(profiles: MemberSkillsProfile[]): string[] {
  const stmts: string[] = [];
  for (const p of profiles) {
    const primary = new Set(p.primary_skills.map((s) => s.toLowerCase()));
    for (const skill of p.skills) {
      stmts.push(
        `INSERT INTO pmo_member_skills (tenant_id,member_id,skill,is_primary,source) VALUES (${sqlString(
          TENANT_ID,
        )},${sqlString(p.member_id)},${sqlString(skill)},${primary.has(skill.toLowerCase()) ? '1' : '0'},${sqlString(
          'derived_pmo02',
        )});`,
      );
    }
  }
  return stmts;
}

function buildTaskHistoryInserts(history: MemberTaskHistoryEntry[]): string[] {
  return history.map(
    (h) =>
      `INSERT INTO pmo_member_task_history (tenant_id,history_id,member_id,project_id,project_name,project_type,allocation_role,task_title,task_summary,total_logged_hours,skill_tags) VALUES (${sqlString(
        TENANT_ID,
      )},${sqlString(h.history_id)},${sqlString(h.member_id)},${sqlString(h.project_id)},${sqlString(
        h.project_name,
      )},${sqlString(h.project_type)},${sqlString(h.allocation_role)},${sqlString(h.task_title)},${sqlString(
        h.task_summary,
      )},${sqlString(h.total_logged_hours)},${sqlString(JSON.stringify(h.skill_tags))});`,
  );
}

function buildInsertStatements(tableId: CanonicalTableId, rows: NormalizedRow[]): string[] {
  const tableName: Record<CanonicalTableId, string> = {
    resource_allocation: 'pmo_resource_allocations',
    timesheet: 'pmo_timesheets',
    leave: 'pmo_leave_records',
    member_master: 'pmo_member_master',
    project_master: 'pmo_project_master',
    overbook_idle_config: 'pmo_overbook_idle_config',
    calendar_weeks: 'pmo_calendar_weeks',
    kpi_norms: 'pmo_kpi_norms',
  };

  const prefixCols = [
    'tenant_id',
    'natural_key_hash',
    'source_row_hash',
    'last_ingestion_session_id',
    'is_active',
  ];
  const prefixVals = (values: Record<string, unknown>) => [
    sqlString(TENANT_ID),
    sqlString(computeNaturalKeyHash(tableId, TENANT_ID, values)),
    sqlString(computeSourceRowHash(tableId, values)),
    sqlString(INGESTION_ID),
    '1',
  ];

  const stmts: string[] = [];
  for (const r of rows) {
    const v = r.values;

    let cols: string[] = [];
    let vals: string[] = [];

    if (tableId === 'resource_allocation') {
      cols = [
        ...prefixCols,
        'member_id',
        'project_id',
        'role',
        'allocation_pct',
        'start_date',
        'end_date',
        'weekly_planned_hours',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.member_id),
        sqlString(v.project_id),
        sqlString(v.role),
        sqlString(v.allocation_pct),
        sqlString(v.start_date),
        sqlString(v.end_date),
        sqlString(v.weekly_planned_hours),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'timesheet') {
      cols = [
        ...prefixCols,
        'member_id',
        'project_id',
        'work_date',
        'logged_hours',
        'log_category',
        'task_ref',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.member_id),
        sqlString(v.project_id),
        sqlString(v.work_date),
        sqlString(v.logged_hours),
        sqlString(v.log_category),
        sqlString(v.task_ref),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'leave') {
      cols = [
        ...prefixCols,
        'record_id',
        'member_id',
        'leave_date',
        'leave_type',
        'approved',
        'duration_days',
        'note',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.record_id),
        sqlString(v.member_id),
        sqlString(v.leave_date),
        sqlString(v.leave_type),
        sqlString(toIntBool(v.approved)),
        sqlString(v.duration_days),
        sqlString(v.note),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'member_master') {
      cols = [
        ...prefixCols,
        'member_id',
        'full_name',
        'department',
        'role_title',
        'level',
        'line_manager_id',
        'employment_status',
        'employment',
        'std_hours_week',
        'join_date',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.member_id),
        sqlString(v.full_name),
        sqlString(v.department),
        sqlString(v.role_title),
        sqlString(v.level),
        sqlString(v.line_manager_id),
        sqlString(v.employment_status),
        sqlString(v.employment),
        sqlString(v.std_hours_week),
        sqlString(v.join_date),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'project_master') {
      cols = [
        ...prefixCols,
        'project_id',
        'project_name',
        'account_id',
        'project_type',
        'status',
        'pm_id',
        'start_date',
        'end_date',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.project_id),
        sqlString(v.project_name),
        sqlString(v.account_id),
        sqlString(v.project_type),
        sqlString(v.status),
        sqlString(v.pm_id),
        sqlString(v.start_date),
        sqlString(v.end_date),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'overbook_idle_config') {
      cols = [
        ...prefixCols,
        'config_id',
        'rule_name',
        'overbook_threshold',
        'overbook_red_threshold',
        'idle_threshold',
        'mismatch_pct_threshold',
        'ot_max_hours_per_week',
        'required_training_hours',
        'effective_date',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.config_id),
        sqlString(v.rule_name),
        sqlString(v.overbook_threshold),
        sqlString(v.overbook_red_threshold),
        sqlString(v.idle_threshold),
        sqlString(v.mismatch_pct_threshold),
        sqlString(v.ot_max_hours_per_week),
        sqlString(v.required_training_hours),
        sqlString(v.effective_date),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'calendar_weeks') {
      cols = [
        ...prefixCols,
        'week_id',
        'week_start',
        'week_end',
        'working_days',
        'holiday_hours_ft',
        'note',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.week_id),
        sqlString(v.week_start),
        sqlString(v.week_end),
        sqlString(v.working_days),
        sqlString(v.holiday_hours_ft),
        sqlString(v.note),
        sqlString(r.sourceRow),
      ];
    } else if (tableId === 'kpi_norms') {
      cols = [
        ...prefixCols,
        'norm_id',
        'metric',
        'formula',
        'green',
        'yellow',
        'red',
        'used_for',
        'source_row',
      ];
      vals = [
        ...prefixVals(v),
        sqlString(v.norm_id),
        sqlString(v.metric),
        sqlString(v.formula),
        sqlString(v.green),
        sqlString(v.yellow),
        sqlString(v.red),
        sqlString(v.used_for),
        sqlString(r.sourceRow),
      ];
    }

    if (cols.length === 0) continue;
    stmts.push(`INSERT INTO ${tableName[tableId]} (${cols.join(',')}) VALUES (${vals.join(',')});`);
  }

  return stmts;
}

async function main() {
  const buffer = readFileSync(WORKBOOK_PATH);
  const detected = await detectSchema(buffer);
  const parseResult = await parseWorkbook(buffer);
  const confirmed = cleanMappings(detected);
  const norm = normalizeRows(parseResult.sheets, confirmed);

  const perTable: Partial<Record<CanonicalTableId, NormalizedRow[]>> = {};
  for (const [tableId, rows] of Object.entries(norm.tables)) {
    perTable[tableId as CanonicalTableId] = canonicalRowsFor(tableId as CanonicalTableId, rows);
  }

  const sql: string[] = [];
  sql.push('BEGIN;');
  sql.push(sqliteSchemaSql());
  sql.push(
    `INSERT INTO pmo_ingestion_sessions (id,tenant_id,status,source_file_key,source_file_name,mime_type,reporting_period_key,created_by,created_at,confirmed_at,finished_at,workbook_confidence)\n` +
      `VALUES (${sqlString(INGESTION_ID)},${sqlString(TENANT_ID)},'published',${sqlString(
        `file://${WORKBOOK_PATH}`,
      )},${sqlString('PMO_02_RA_Timesheet_Monitoring.xlsx')},${sqlString(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )},${sqlString('PMO_02')},${sqlString(CREATED_BY)},datetime('now'),datetime('now'),datetime('now'),${sqlString(
        detected.validation.workbookConfidence,
      )});`,
  );

  const insertOrder: CanonicalTableId[] = [
    'calendar_weeks',
    'member_master',
    'project_master',
    'overbook_idle_config',
    'resource_allocation',
    'timesheet',
    'leave',
    'kpi_norms',
  ];
  for (const tid of insertOrder) {
    const rows = perTable[tid] ?? [];
    sql.push(`-- ${tid}: ${rows.length} row(s)`);
    sql.push(...buildInsertStatements(tid, rows));
  }

  const { profiles, history } = deriveSkillsAndHistory(perTable);
  sql.push(`-- member_skills: ${profiles.reduce((n, p) => n + p.skills.length, 0)} row(s)`);
  sql.push(...buildMemberSkillsInserts(profiles));
  sql.push(`-- member_task_history: ${history.length} row(s)`);
  sql.push(...buildTaskHistoryInserts(history));
  sql.push('COMMIT;');

  const proc = spawnSync('sqlite3', [DB_PATH], { input: `${sql.join('\n')}\n`, encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`sqlite3 failed: ${proc.stderr || proc.stdout}`);

  const countProc = spawnSync(
    'sqlite3',
    [
      DB_PATH,
      "SELECT 'weeks',count(*) FROM pmo_calendar_weeks; " +
        "SELECT 'members',count(*) FROM pmo_member_master; " +
        "SELECT 'projects',count(*) FROM pmo_project_master; " +
        "SELECT 'allocs',count(*) FROM pmo_resource_allocations; " +
        "SELECT 'timesheets',count(*) FROM pmo_timesheets; " +
        "SELECT 'leaves',count(*) FROM pmo_leave_records; " +
        "SELECT 'kpi_norms',count(*) FROM pmo_kpi_norms; " +
        "SELECT 'member_skills',count(*) FROM pmo_member_skills; " +
        "SELECT 'task_history',count(*) FROM pmo_member_task_history;",
    ],
    { encoding: 'utf8' },
  );
  console.log(countProc.stdout.trim());

  const csv = exportMockSkillsCsv({
    profiles,
    history,
    allocations: deriveAllocationsWithProjects(perTable),
    members: (perTable.member_master ?? []).map((r) => ({
      member_id: rowStr(r.values.member_id),
      full_name: rowStr(r.values.full_name),
      std_hours_week: r.values.std_hours_week != null ? rowNum(r.values.std_hours_week) : null,
    })),
  });
  console.log(
    `csv: skills=${csv.memberSkillRows} history=${csv.taskHistoryRows} profiles=${csv.memberProfileRows} swaps=${csv.rebalanceSwapRows}`,
  );
}

// Mock-data generation is intentionally disabled for now.
// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
void main;
console.warn('PMO mock-data.db generation is disabled.');
