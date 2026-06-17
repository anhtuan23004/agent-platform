import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposeRebalanceSwaps } from './mock-member-skills-history.ts';
import {
  DEFAULT_MOCK_DB_PATH,
  loadAllocationsWithProjectsFromSqlite,
  loadMemberCapacitiesFromSqlite,
  loadMemberSkillsFromSqlite,
  loadMemberSkillsProfilesFromSqlite,
  loadMemberTaskHistoryEntriesFromSqlite,
  loadMemberTaskHistoryFromSqlite,
} from './mock-sqlite-canonical.ts';

export const DEFAULT_MEMBER_SKILLS_CSV = resolve(
  import.meta.dirname,
  '../../../../hackathon/data/pmo_02_member_skills.csv',
);
export const DEFAULT_MEMBER_TASK_HISTORY_CSV = resolve(
  import.meta.dirname,
  '../../../../hackathon/data/pmo_02_member_task_history.csv',
);
export const DEFAULT_MEMBER_PROFILES_CSV = resolve(
  import.meta.dirname,
  '../../../../hackathon/data/pmo_02_member_profiles.csv',
);
export const DEFAULT_REBALANCE_SWAPS_CSV = resolve(
  import.meta.dirname,
  '../../../../hackathon/data/pmo_02_rebalance_swaps.csv',
);

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export interface ExportMockSkillsCsvResult {
  memberSkillsPath: string;
  memberTaskHistoryPath: string;
  memberProfilesPath: string;
  rebalanceSwapsPath: string;
  memberSkillRows: number;
  taskHistoryRows: number;
  memberProfileRows: number;
  rebalanceSwapRows: number;
}

export function exportMockSkillsCsv(input?: {
  dbPath?: string;
  memberSkillsPath?: string;
  memberTaskHistoryPath?: string;
  memberProfilesPath?: string;
  rebalanceSwapsPath?: string;
}): ExportMockSkillsCsvResult {
  const dbPath = input?.dbPath ?? DEFAULT_MOCK_DB_PATH;
  const memberSkillsPath = input?.memberSkillsPath ?? DEFAULT_MEMBER_SKILLS_CSV;
  const memberTaskHistoryPath = input?.memberTaskHistoryPath ?? DEFAULT_MEMBER_TASK_HISTORY_CSV;
  const memberProfilesPath = input?.memberProfilesPath ?? DEFAULT_MEMBER_PROFILES_CSV;
  const rebalanceSwapsPath = input?.rebalanceSwapsPath ?? DEFAULT_REBALANCE_SWAPS_CSV;

  const skills = loadMemberSkillsFromSqlite(dbPath);
  const history = loadMemberTaskHistoryFromSqlite(dbPath);

  const skillsCsv = toCsv(
    ['member_id', 'skill', 'is_primary', 'source'],
    skills.map((s) => [s.member_id, s.skill, s.is_primary ? 'true' : 'false', 'derived_pmo02']),
  );
  writeFileSync(memberSkillsPath, skillsCsv, 'utf8');

  const historyCsv = toCsv(
    [
      'history_id',
      'member_id',
      'project_id',
      'project_name',
      'project_type',
      'allocation_role',
      'task_title',
      'task_summary',
      'total_logged_hours',
      'skill_tags',
    ],
    history.map((h) => [
      h.history_id,
      h.member_id,
      h.project_id,
      h.project_name,
      h.project_type,
      h.allocation_role,
      h.task_title,
      h.task_summary,
      h.total_logged_hours,
      h.skill_tags.join('|'),
    ]),
  );
  writeFileSync(memberTaskHistoryPath, historyCsv, 'utf8');

  const byMember = new Map<string, { primary: string[]; all: string[] }>();
  for (const s of skills) {
    if (!byMember.has(s.member_id)) byMember.set(s.member_id, { primary: [], all: [] });
    const bucket = byMember.get(s.member_id)!;
    bucket.all.push(s.skill);
    if (s.is_primary) bucket.primary.push(s.skill);
  }

  const members = loadMemberMeta(dbPath);
  const profileRows = members.map((m) => {
    const bucket = byMember.get(m.member_id) ?? { primary: [], all: [] };
    return [
      m.member_id,
      m.full_name,
      m.department,
      m.role_title,
      m.level,
      m.allocation_roles.join('|'),
      bucket.primary.join('|'),
      bucket.all.join('|'),
    ];
  });

  const profilesCsv = toCsv(
    [
      'member_id',
      'full_name',
      'department',
      'role_title',
      'level',
      'allocation_roles',
      'primary_skills',
      'skills',
    ],
    profileRows,
  );
  writeFileSync(memberProfilesPath, profilesCsv, 'utf8');

  const profiles = loadMemberSkillsProfilesFromSqlite(dbPath);
  const historyEntries = loadMemberTaskHistoryEntriesFromSqlite(dbPath);
  const allocations = loadAllocationsWithProjectsFromSqlite(dbPath);
  const capacities = loadMemberCapacitiesFromSqlite(dbPath);
  const swaps = proposeRebalanceSwaps({
    profiles,
    history: historyEntries,
    allocations,
    capacities,
  });

  const swapsCsv = toCsv(
    [
      'from_member_id',
      'from_member_name',
      'to_member_id',
      'to_member_name',
      'project_id',
      'project_name',
      'role',
      'transferable_hours',
      'skill_fit_score',
      'matched_skills',
      'can_swap',
      'rationale',
    ],
    swaps.map((s) => [
      s.from_member_id,
      s.from_member_name,
      s.to_member_id,
      s.to_member_name,
      s.project_id,
      s.project_name,
      s.role,
      s.transferable_hours,
      s.skill_fit_score,
      s.matched_skills.join('|'),
      s.can_swap ? 'true' : 'false',
      s.rationale,
    ]),
  );
  writeFileSync(rebalanceSwapsPath, swapsCsv, 'utf8');

  return {
    memberSkillsPath,
    memberTaskHistoryPath,
    memberProfilesPath,
    rebalanceSwapsPath,
    memberSkillRows: skills.length,
    taskHistoryRows: history.length,
    memberProfileRows: profileRows.length,
    rebalanceSwapRows: swaps.length,
  };
}

function loadMemberMeta(dbPath: string): Array<{
  member_id: string;
  full_name: string;
  department: string;
  role_title: string;
  level: string;
  allocation_roles: string[];
}> {
  const proc = spawnSync(
    'sqlite3',
    [
      '-json',
      dbPath,
      `SELECT m.member_id, m.full_name, m.department, m.role_title, m.level,
              group_concat(DISTINCT a.role) AS allocation_roles
       FROM pmo_member_master m
       LEFT JOIN pmo_resource_allocations a
         ON a.member_id = m.member_id AND a.is_active = 1
       WHERE m.is_active = 1
       GROUP BY m.member_id, m.full_name, m.department, m.role_title, m.level
       ORDER BY m.member_id`,
    ],
    { encoding: 'utf8' },
  );
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
  const trimmed = proc.stdout.trim();
  if (!trimmed) return [];
  const rows = JSON.parse(trimmed) as Array<{
    member_id: string;
    full_name: string;
    department: string | null;
    role_title: string | null;
    level: string | null;
    allocation_roles: string | null;
  }>;
  return rows.map((r) => ({
    member_id: r.member_id,
    full_name: r.full_name,
    department: r.department ?? '',
    role_title: r.role_title ?? '',
    level: r.level ?? '',
    allocation_roles: r.allocation_roles ? r.allocation_roles.split(',') : [],
  }));
}
