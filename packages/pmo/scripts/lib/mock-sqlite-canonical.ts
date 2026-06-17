import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { ConfigRow } from '../../src/backend/analytics/thresholds.ts';
import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  TimesheetRow,
  WeekRow,
} from '../../src/backend/analytics/types.ts';
import type {
  MemberCapacity,
  MemberSkillsProfile,
  MemberTaskHistoryEntry,
} from './mock-member-skills-history.ts';
import { buildMemberCapacities } from './mock-member-skills-history.ts';

export const DEFAULT_MOCK_DB_PATH = resolve(import.meta.dirname, '../../../../mock-data.db');

export interface MockMemberSkillsRow {
  member_id: string;
  skill: string;
  is_primary: boolean;
}

export interface MockMemberTaskHistoryRow {
  history_id: string;
  member_id: string;
  project_id: string;
  project_name: string;
  project_type: string | null;
  allocation_role: string;
  task_title: string;
  task_summary: string | null;
  total_logged_hours: number;
  skill_tags: string[];
}

export interface MockCanonicalInputs {
  members: MemberRow[];
  allocations: AllocationRow[];
  timesheets: TimesheetRow[];
  leaves: LeaveRow[];
  weeks: WeekRow[];
  configRows: ConfigRow[];
}

const parseDate = (iso: string): Date => new Date(iso);

function queryJson<T extends Record<string, unknown>>(dbPath: string, sql: string): T[] {
  const proc = spawnSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
  const trimmed = proc.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

export function queryScalar(dbPath: string, sql: string): number {
  const proc = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout);
  return Number(proc.stdout.trim());
}

export function loadCanonicalFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MockCanonicalInputs {
  const active = 'is_active = 1';

  return {
    members: queryJson<{
      member_id: string;
      std_hours_week: number | null;
      join_date: string | null;
    }>(
      dbPath,
      `SELECT member_id, std_hours_week, join_date FROM pmo_member_master WHERE ${active}`,
    ).map((r) => ({
      member_id: r.member_id,
      std_hours_week: r.std_hours_week,
      join_date: r.join_date ? parseDate(r.join_date) : null,
    })),
    allocations: queryJson<{
      member_id: string;
      project_id: string;
      weekly_planned_hours: number | null;
      start_date: string;
      end_date: string;
    }>(
      dbPath,
      `SELECT member_id, project_id, weekly_planned_hours, start_date, end_date
       FROM pmo_resource_allocations WHERE ${active}`,
    ).map((r) => ({
      member_id: r.member_id,
      project_id: r.project_id,
      weekly_planned_hours: r.weekly_planned_hours,
      start_date: parseDate(r.start_date),
      end_date: parseDate(r.end_date),
    })),
    timesheets: queryJson<{
      member_id: string;
      work_date: string;
      logged_hours: number;
      log_category: string | null;
    }>(
      dbPath,
      `SELECT member_id, work_date, logged_hours, log_category
       FROM pmo_timesheets WHERE ${active}`,
    ).map((r) => ({
      member_id: r.member_id,
      work_date: parseDate(r.work_date),
      logged_hours: r.logged_hours,
      log_category: r.log_category,
    })),
    leaves: queryJson<{
      member_id: string | null;
      leave_date: string;
      leave_type: string;
      approved: number | null;
      duration_days: number | null;
    }>(
      dbPath,
      `SELECT member_id, leave_date, leave_type, approved, duration_days
       FROM pmo_leave_records WHERE ${active}`,
    ).map((r) => ({
      member_id: r.member_id,
      leave_date: parseDate(r.leave_date),
      leave_type: r.leave_type,
      approved: r.approved === null ? null : r.approved === 1,
      duration_days: r.duration_days,
    })),
    weeks: queryJson<{
      week_id: string;
      week_start: string;
      week_end: string;
      working_days: number;
      holiday_hours_ft: number | null;
    }>(
      dbPath,
      `SELECT week_id, week_start, week_end, working_days, holiday_hours_ft
       FROM pmo_calendar_weeks WHERE ${active}`,
    ).map((r) => ({
      week_id: r.week_id,
      week_start: parseDate(r.week_start),
      week_end: parseDate(r.week_end),
      working_days: r.working_days,
      holiday_hours_ft: r.holiday_hours_ft,
    })),
    configRows: queryJson<{
      overbook_threshold: number | null;
      overbook_red_threshold: number | null;
      idle_threshold: number | null;
      mismatch_pct_threshold: number | null;
      ot_max_hours_per_week: number | null;
      required_training_hours: number | null;
      effective_date: string | null;
    }>(
      dbPath,
      `SELECT overbook_threshold, overbook_red_threshold, idle_threshold,
              mismatch_pct_threshold, ot_max_hours_per_week, required_training_hours, effective_date
       FROM pmo_overbook_idle_config WHERE ${active}`,
    ).map((r) => ({
      overbook_threshold: r.overbook_threshold,
      overbook_red_threshold: r.overbook_red_threshold,
      idle_threshold: r.idle_threshold,
      mismatch_pct_threshold: r.mismatch_pct_threshold,
      ot_max_hours_per_week: r.ot_max_hours_per_week,
      required_training_hours: r.required_training_hours,
      effective_date: r.effective_date ? parseDate(r.effective_date) : null,
    })),
  };
}

export function loadMemberSkillsFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MockMemberSkillsRow[] {
  return queryJson<{
    member_id: string;
    skill: string;
    is_primary: number;
  }>(
    dbPath,
    `SELECT member_id, skill, is_primary FROM pmo_member_skills ORDER BY member_id, is_primary DESC, skill`,
  ).map((r) => ({
    member_id: r.member_id,
    skill: r.skill,
    is_primary: r.is_primary !== 0,
  }));
}

export function loadMemberTaskHistoryFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MockMemberTaskHistoryRow[] {
  return queryJson<{
    history_id: string;
    member_id: string;
    project_id: string;
    project_name: string;
    project_type: string | null;
    allocation_role: string;
    task_title: string;
    task_summary: string | null;
    total_logged_hours: number;
    skill_tags: string;
  }>(
    dbPath,
    `SELECT history_id, member_id, project_id, project_name, project_type, allocation_role,
            task_title, task_summary, total_logged_hours, skill_tags
     FROM pmo_member_task_history
     ORDER BY member_id, total_logged_hours DESC`,
  ).map((r) => ({
    ...r,
    skill_tags: JSON.parse(r.skill_tags) as string[],
  }));
}

/** Aggregate flat skill rows into profiles (for suggest helpers). */
export function loadMemberSkillsProfilesFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MemberSkillsProfile[] {
  const members = queryJson<{
    member_id: string;
    full_name: string;
    department: string | null;
    role_title: string | null;
    level: string | null;
  }>(
    dbPath,
    `SELECT member_id, full_name, department, role_title, level FROM pmo_member_master WHERE is_active = 1`,
  );
  const skillRows = loadMemberSkillsFromSqlite(dbPath);
  const allocRoles = queryJson<{ member_id: string; role: string | null }>(
    dbPath,
    `SELECT member_id, role FROM pmo_resource_allocations WHERE is_active = 1`,
  );

  const rolesByMember = new Map<string, Set<string>>();
  for (const a of allocRoles) {
    if (!a.role) continue;
    if (!rolesByMember.has(a.member_id)) rolesByMember.set(a.member_id, new Set());
    rolesByMember.get(a.member_id)!.add(a.role);
  }

  const skillsByMember = new Map<string, { skills: string[]; primary: string[] }>();
  for (const s of skillRows) {
    if (!skillsByMember.has(s.member_id)) {
      skillsByMember.set(s.member_id, { skills: [], primary: [] });
    }
    const bucket = skillsByMember.get(s.member_id)!;
    bucket.skills.push(s.skill);
    if (s.is_primary) bucket.primary.push(s.skill);
  }

  return members.map((m) => {
    const bucket = skillsByMember.get(m.member_id) ?? { skills: [], primary: [] };
    return {
      member_id: m.member_id,
      full_name: m.full_name,
      department: m.department ?? '',
      role_title: m.role_title ?? '',
      level: m.level ?? '',
      allocation_roles: [...(rolesByMember.get(m.member_id) ?? [])].sort(),
      skills: bucket.skills,
      primary_skills: bucket.primary.length > 0 ? bucket.primary : bucket.skills.slice(0, 6),
    };
  });
}

export function loadMemberTaskHistoryEntriesFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MemberTaskHistoryEntry[] {
  return loadMemberTaskHistoryFromSqlite(dbPath).map((r) => ({
    history_id: r.history_id,
    member_id: r.member_id,
    project_id: r.project_id,
    project_name: r.project_name,
    project_type: r.project_type ?? '',
    allocation_role: r.allocation_role,
    task_title: r.task_title,
    task_summary: r.task_summary ?? '',
    total_logged_hours: r.total_logged_hours,
    skill_tags: r.skill_tags,
  }));
}

export interface MockAllocationWithProject {
  member_id: string;
  project_id: string;
  project_name: string;
  project_type: string;
  role: string | null;
  weekly_planned_hours: number | null;
}

export function loadAllocationsWithProjectsFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
): MockAllocationWithProject[] {
  return queryJson<{
    member_id: string;
    project_id: string;
    project_name: string;
    project_type: string | null;
    role: string | null;
    weekly_planned_hours: number | null;
  }>(
    dbPath,
    `SELECT a.member_id, a.project_id, p.project_name, p.project_type, a.role, a.weekly_planned_hours
     FROM pmo_resource_allocations a
     JOIN pmo_project_master p ON p.project_id = a.project_id AND p.is_active = 1
     WHERE a.is_active = 1`,
  ).map((r) => ({
    member_id: r.member_id,
    project_id: r.project_id,
    project_name: r.project_name,
    project_type: r.project_type ?? '',
    role: r.role,
    weekly_planned_hours: r.weekly_planned_hours,
  }));
}

export function loadMemberCapacitiesFromSqlite(
  dbPath: string = DEFAULT_MOCK_DB_PATH,
  overbookThreshold = 1.1,
): MemberCapacity[] {
  const members = queryJson<{
    member_id: string;
    full_name: string;
    std_hours_week: number | null;
  }>(
    dbPath,
    `SELECT member_id, full_name, std_hours_week FROM pmo_member_master WHERE is_active = 1`,
  );
  const allocations = queryJson<{
    member_id: string;
    weekly_planned_hours: number | null;
  }>(
    dbPath,
    `SELECT member_id, weekly_planned_hours FROM pmo_resource_allocations WHERE is_active = 1`,
  );
  return buildMemberCapacities({ members, allocations, overbookThreshold });
}
