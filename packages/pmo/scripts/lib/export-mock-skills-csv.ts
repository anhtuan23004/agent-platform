import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildMemberCapacities,
  type MemberSkillsProfile,
  type MemberTaskHistoryEntry,
  proposeRebalanceSwaps,
} from '../../src/backend/demo/mock-member-skills-history.ts';

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

export interface MockAllocationWithProject {
  member_id: string;
  project_id: string;
  project_name: string;
  project_type: string;
  role: string | null;
  weekly_planned_hours: number | null;
}

export interface ExportMockSkillsCsvInput {
  profiles: MemberSkillsProfile[];
  history: MemberTaskHistoryEntry[];
  allocations: MockAllocationWithProject[];
  members?: Array<{ member_id: string; full_name: string; std_hours_week: number | null }>;
  memberSkillsPath?: string;
  memberTaskHistoryPath?: string;
  memberProfilesPath?: string;
  rebalanceSwapsPath?: string;
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

/** Write PMO_02 member skills / task history / swap CSVs (local dev artifacts; gitignored). */
export function exportMockSkillsCsv(input: ExportMockSkillsCsvInput): ExportMockSkillsCsvResult {
  const memberSkillsPath = input.memberSkillsPath ?? DEFAULT_MEMBER_SKILLS_CSV;
  const memberTaskHistoryPath = input.memberTaskHistoryPath ?? DEFAULT_MEMBER_TASK_HISTORY_CSV;
  const memberProfilesPath = input.memberProfilesPath ?? DEFAULT_MEMBER_PROFILES_CSV;
  const rebalanceSwapsPath = input.rebalanceSwapsPath ?? DEFAULT_REBALANCE_SWAPS_CSV;

  const skillRows: unknown[][] = [];
  for (const p of input.profiles) {
    const primary = new Set(p.primary_skills.map((s) => s.toLowerCase()));
    for (const skill of p.skills) {
      skillRows.push([
        p.member_id,
        skill,
        primary.has(skill.toLowerCase()) ? 'true' : 'false',
        'derived_pmo02',
      ]);
    }
  }

  writeFileSync(
    memberSkillsPath,
    toCsv(['member_id', 'skill', 'is_primary', 'source'], skillRows),
    'utf8',
  );

  writeFileSync(
    memberTaskHistoryPath,
    toCsv(
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
      input.history.map((h) => [
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
    ),
    'utf8',
  );

  writeFileSync(
    memberProfilesPath,
    toCsv(
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
      input.profiles.map((p) => [
        p.member_id,
        p.full_name,
        p.department,
        p.role_title,
        p.level,
        p.allocation_roles.join('|'),
        p.primary_skills.join('|'),
        p.skills.join('|'),
      ]),
    ),
    'utf8',
  );

  const capacityMembers =
    input.members ??
    input.profiles.map((p) => ({
      member_id: p.member_id,
      full_name: p.full_name,
      std_hours_week: 40,
    }));

  const capacities = buildMemberCapacities({
    members: capacityMembers,
    allocations: input.allocations.map((a) => ({
      member_id: a.member_id,
      weekly_planned_hours: a.weekly_planned_hours,
    })),
  });

  const swaps = proposeRebalanceSwaps({
    profiles: input.profiles,
    history: input.history,
    allocations: input.allocations,
    capacities,
  });

  writeFileSync(
    rebalanceSwapsPath,
    toCsv(
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
    ),
    'utf8',
  );

  return {
    memberSkillsPath,
    memberTaskHistoryPath,
    memberProfilesPath,
    rebalanceSwapsPath,
    memberSkillRows: skillRows.length,
    taskHistoryRows: input.history.length,
    memberProfileRows: input.profiles.length,
    rebalanceSwapRows: swaps.length,
  };
}
