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

export const DEFAULT_MOCK_DB_PATH = resolve(import.meta.dirname, '../../../../mock-data.db');

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
