import { createHash } from 'node:crypto';

import { isActiveUtilizationProject } from '../analytics/utilization-scope.ts';
import {
  buildMemberSkillsAndHistory,
  type PlannerTaskStatus,
  resolvePlannerTaskStatusesForEntries,
} from './mock-member-skills-history.ts';
import {
  ensurePmo02MockSqliteDb,
  queryMockDbJson,
  resolvePmoMockDbPath,
} from './seed-from-mock-db.ts';

const GROUP_THEMES = ['blue', 'teal', 'green', 'purple', 'pink', 'orange', 'red'] as const;

export interface DerivedPlannerUserRow {
  user_id: string;
  name: string;
  email: string;
  project: string;
  role: string;
  rbac_role: string;
  skills: string;
  bio: string;
  availability_status: string;
  timezone: string;
  working_hours_start: string;
  working_hours_end: string;
}

export interface DerivedPlannerGroupRow {
  group_id: string;
  name: string;
  description: string;
  theme: string;
}

export interface DerivedPlannerPlanRow {
  plan_id: string;
  group_id: string;
  title: string;
  description: string;
  tags: string;
  owner: string;
}

export interface DerivedPlannerBucketRow {
  bucket_id: string;
  plan_id: string;
  name: string;
}

export interface DerivedPlannerPlanMemberRow {
  plan_id: string;
  member_id: string;
}

export interface DerivedPlannerTaskRow {
  task_id: string;
  plan_id: string;
  bucket_id: string;
  assignee_ids: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  tags: string;
  checklist: string;
  comments: string;
  attachments: string;
}

export interface DerivedPlannerTimesheetRow {
  leave_id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  type: string;
  status: string;
}

export interface DerivedPlannerSeed {
  users: DerivedPlannerUserRow[];
  groups: DerivedPlannerGroupRow[];
  plans: DerivedPlannerPlanRow[];
  buckets: DerivedPlannerBucketRow[];
  planMembers: DerivedPlannerPlanMemberRow[];
  tasks: DerivedPlannerTaskRow[];
  timesheet: DerivedPlannerTimesheetRow[];
}

export interface DerivePlannerSeedFromMockDbInput {
  mockDbPath?: string;
}

function slugToken(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
}

function memberEmail(memberId: string): string {
  return `${memberId.trim().toLowerCase()}@hackathon.pmo`;
}

function dedupeAllocations<
  T extends { member_id: string; project_id: string; start_date: string; end_date: string },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = `${row.member_id}::${row.project_id}::${row.start_date}::${row.end_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function bucketNameForRole(role: string | null | undefined): string {
  const normalized = (role ?? '').trim();
  return normalized || 'Delivery';
}

function bucketId(planId: string, role: string | null | undefined): string {
  return `bkt-${slugToken(planId)}-${slugToken(bucketNameForRole(role))}`;
}

function isoDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function departmentName(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || 'Delivery';
}

function groupIdForDepartment(department: string | null | undefined): string {
  return `gr-${slugToken(departmentName(department))}`;
}

function resolvePlanDepartment(
  projectId: string,
  pmId: string | null | undefined,
  activeAllocations: Array<{ member_id: string; project_id: string }>,
  departmentByMemberId: Map<string, string | null>,
): string {
  if (pmId) {
    const pmDepartment = departmentByMemberId.get(pmId);
    if (pmDepartment !== undefined) {
      return departmentName(pmDepartment);
    }
  }

  const departmentCounts = new Map<string, number>();
  for (const allocation of activeAllocations) {
    if (allocation.project_id !== projectId) continue;
    const department = departmentName(departmentByMemberId.get(allocation.member_id));
    departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1);
  }

  let dominantDepartment = 'Delivery';
  let dominantCount = 0;
  for (const [department, count] of departmentCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantDepartment = department;
    }
  }

  return dominantDepartment;
}

function resolvePlanGroupId(
  projectId: string,
  pmId: string | null | undefined,
  activeAllocations: Array<{ member_id: string; project_id: string }>,
  departmentByMemberId: Map<string, string | null>,
): string {
  return groupIdForDepartment(
    resolvePlanDepartment(projectId, pmId, activeAllocations, departmentByMemberId),
  );
}

function taskPriorityForStatus(status: PlannerTaskStatus, allocationPct: number): string {
  if (status === 'in progress') return allocationPct >= 50 ? '5' : '3';
  if (status === 'todo') return '3';
  return '1';
}

function parseSkillTags(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}

function dedupeNaturalKey(values: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 12);
}

/**
 * Build planner-compatible seed rows from committed PMO_02 mock SQLite.
 * Active delivery projects align with utilization / rebalance scope.
 */
export function derivePlannerSeedFromMockDb(
  input: DerivePlannerSeedFromMockDbInput = {},
): DerivedPlannerSeed {
  const mockDbPath = resolvePmoMockDbPath(input.mockDbPath);
  ensurePmo02MockSqliteDb(mockDbPath);

  const members = queryMockDbJson<{
    member_id: string;
    full_name: string;
    department: string | null;
    role_title: string | null;
    level: string | null;
  }>(
    mockDbPath,
    `SELECT member_id, full_name, department, role_title, level
     FROM pmo_member_master WHERE is_active = 1`,
  );

  const projects = queryMockDbJson<{
    project_id: string;
    project_name: string;
    account_id: string | null;
    project_type: string | null;
    status: string | null;
    pm_id: string | null;
  }>(
    mockDbPath,
    `SELECT project_id, project_name, account_id, project_type, status, pm_id
     FROM pmo_project_master WHERE is_active = 1`,
  );

  const allocations = dedupeAllocations(
    queryMockDbJson<{
      member_id: string;
      project_id: string;
      role: string | null;
      allocation_pct: number | null;
      start_date: string;
      end_date: string;
      weekly_planned_hours: number | null;
    }>(
      mockDbPath,
      `SELECT member_id, project_id, role, allocation_pct, start_date, end_date, weekly_planned_hours
       FROM pmo_resource_allocations WHERE is_active = 1`,
    ),
  );

  const timesheetRows = queryMockDbJson<{
    member_id: string;
    project_id: string | null;
    logged_hours: number;
    log_category: string | null;
  }>(
    mockDbPath,
    `SELECT member_id, project_id, logged_hours, log_category
     FROM pmo_timesheets WHERE is_active = 1`,
  );

  const leaves = queryMockDbJson<{
    record_id: string | null;
    member_id: string | null;
    leave_date: string;
    leave_type: string;
    approved: number | null;
  }>(
    mockDbPath,
    `SELECT record_id, member_id, leave_date, leave_type, approved
     FROM pmo_leave_records WHERE is_active = 1`,
  );

  const taskHistory = queryMockDbJson<{
    history_id: string;
    member_id: string;
    project_id: string;
    allocation_role: string;
    task_title: string;
    task_summary: string | null;
    total_logged_hours: number;
    skill_tags: string;
  }>(
    mockDbPath,
    `SELECT history_id, member_id, project_id, allocation_role, task_title, task_summary,
            total_logged_hours, skill_tags
     FROM pmo_member_task_history`,
  );

  const activeProjects = projects.filter((project) => isActiveUtilizationProject(project.status));
  const activeProjectIds = new Set(activeProjects.map((project) => project.project_id));
  const activeAllocations = allocations.filter((allocation) =>
    activeProjectIds.has(allocation.project_id),
  );
  const activeTaskHistory = taskHistory.filter((entry) => activeProjectIds.has(entry.project_id));
  const allocationByMemberProject = new Map(
    activeAllocations.map(
      (allocation) => [`${allocation.member_id}::${allocation.project_id}`, allocation] as const,
    ),
  );
  const departmentByMemberId = new Map(
    members.map((member) => [member.member_id, member.department] as const),
  );
  const allocatedMemberIds = new Set(activeAllocations.map((allocation) => allocation.member_id));

  const { profiles } = buildMemberSkillsAndHistory({
    members: members.map((member) => ({
      member_id: member.member_id,
      full_name: member.full_name,
      department: member.department,
      role_title: member.role_title,
      level: member.level,
    })),
    allocations: allocations.map((allocation) => ({
      member_id: allocation.member_id,
      project_id: allocation.project_id,
      role: allocation.role,
      allocation_pct: allocation.allocation_pct,
    })),
    projects: projects.map((project) => ({
      project_id: project.project_id,
      project_name: project.project_name,
      project_type: project.project_type,
    })),
    timesheets: timesheetRows.map((row) => ({
      member_id: row.member_id,
      project_id: row.project_id,
      logged_hours: row.logged_hours,
      log_category: row.log_category,
    })),
  });
  const profileById = new Map(profiles.map((profile) => [profile.member_id, profile]));

  const users: DerivedPlannerUserRow[] = members.map((member) => {
    const profile = profileById.get(member.member_id);
    return {
      user_id: member.member_id,
      name: member.full_name,
      email: memberEmail(member.member_id),
      project: member.department ?? '',
      role: member.role_title ?? '',
      rbac_role: 'planner.contributor',
      skills: (profile?.skills ?? []).join(','),
      bio: `PMO delivery member ${member.member_id} (${member.role_title ?? 'resource'}).`,
      availability_status: 'available',
      timezone: 'Asia/Ho_Chi_Minh',
      working_hours_start: '09:00',
      working_hours_end: '18:00',
    };
  });

  const groupKeys = new Map<string, { group_id: string; name: string; description: string }>();
  const requiredDepartments = new Set<string>();
  for (const member of members) {
    if (allocatedMemberIds.has(member.member_id)) {
      requiredDepartments.add(departmentName(member.department));
    }
  }
  for (const project of activeProjects) {
    requiredDepartments.add(
      resolvePlanDepartment(
        project.project_id,
        project.pm_id,
        activeAllocations,
        departmentByMemberId,
      ),
    );
  }
  for (const department of requiredDepartments) {
    const group_id = groupIdForDepartment(department);
    if (!groupKeys.has(group_id)) {
      groupKeys.set(group_id, {
        group_id,
        name: department,
        description: `Delivery squad for ${department} department.`,
      });
    }
  }

  const groups: DerivedPlannerGroupRow[] = [...groupKeys.values()].map((group, index) => ({
    ...group,
    theme: GROUP_THEMES[index % GROUP_THEMES.length] ?? 'blue',
  }));

  const firstAllocatorByProject = new Map<string, string>();
  for (const allocation of activeAllocations) {
    if (!firstAllocatorByProject.has(allocation.project_id)) {
      firstAllocatorByProject.set(allocation.project_id, allocation.member_id);
    }
  }

  const plans: DerivedPlannerPlanRow[] = activeProjects.map((project) => ({
    plan_id: project.project_id,
    group_id: resolvePlanGroupId(
      project.project_id,
      project.pm_id,
      activeAllocations,
      departmentByMemberId,
    ),
    title: project.project_name,
    description: `Planner board mirrored from PMO project ${project.project_id}.`,
    tags: [project.project_type, project.status].filter(Boolean).join(','),
    owner:
      project.pm_id ??
      firstAllocatorByProject.get(project.project_id) ??
      members[0]?.member_id ??
      '',
  }));

  const bucketByPlanRole = new Map<string, DerivedPlannerBucketRow>();
  for (const allocation of activeAllocations) {
    const name = bucketNameForRole(allocation.role);
    const bucket_id = bucketId(allocation.project_id, allocation.role);
    const key = `${allocation.project_id}::${name}`;
    if (!bucketByPlanRole.has(key)) {
      bucketByPlanRole.set(key, {
        bucket_id,
        plan_id: allocation.project_id,
        name,
      });
    }
  }
  for (const entry of activeTaskHistory) {
    const name = bucketNameForRole(entry.allocation_role);
    const bucket_id = bucketId(entry.project_id, entry.allocation_role);
    const key = `${entry.project_id}::${name}`;
    if (!bucketByPlanRole.has(key)) {
      bucketByPlanRole.set(key, {
        bucket_id,
        plan_id: entry.project_id,
        name,
      });
    }
  }
  const buckets = [...bucketByPlanRole.values()];

  const planMemberKeys = new Set<string>();
  const planMembers: DerivedPlannerPlanMemberRow[] = [];
  for (const allocation of activeAllocations) {
    const key = `${allocation.project_id}::${allocation.member_id}`;
    if (planMemberKeys.has(key)) continue;
    planMemberKeys.add(key);
    planMembers.push({
      plan_id: allocation.project_id,
      member_id: allocation.member_id,
    });
  }
  for (const entry of activeTaskHistory) {
    const key = `${entry.project_id}::${entry.member_id}`;
    if (planMemberKeys.has(key)) continue;
    planMemberKeys.add(key);
    planMembers.push({
      plan_id: entry.project_id,
      member_id: entry.member_id,
    });
  }

  const statusByHistoryId = new Map<string, PlannerTaskStatus>();
  const taskHistoryByMemberProject = new Map<string, typeof activeTaskHistory>();
  for (const entry of activeTaskHistory) {
    const key = `${entry.member_id}::${entry.project_id}`;
    const bucket = taskHistoryByMemberProject.get(key) ?? [];
    bucket.push(entry);
    taskHistoryByMemberProject.set(key, bucket);
  }
  for (const [key, entries] of taskHistoryByMemberProject) {
    const statuses = resolvePlannerTaskStatusesForEntries(
      entries,
      allocationByMemberProject.has(key),
    );
    for (const [index, entry] of entries.entries()) {
      statusByHistoryId.set(entry.history_id, statuses[index] ?? 'todo');
    }
  }

  const tasks: DerivedPlannerTaskRow[] = activeTaskHistory.map((entry) => {
    const role = bucketNameForRole(entry.allocation_role);
    const bucketKey = `${entry.project_id}::${role}`;
    const bucket =
      bucketByPlanRole.get(bucketKey) ??
      bucketByPlanRole.get(`${entry.project_id}::Delivery`) ??
      buckets.find((row) => row.plan_id === entry.project_id);
    const allocation = allocationByMemberProject.get(`${entry.member_id}::${entry.project_id}`);
    const skillTags = parseSkillTags(entry.skill_tags);
    const summary = entry.task_summary?.trim();
    const loggedHours = entry.total_logged_hours ?? 0;
    const description = summary ? `${summary} · ${loggedHours}h logged` : `${loggedHours}h logged`;
    const status = statusByHistoryId.get(entry.history_id) ?? 'todo';
    const allocationPct = allocation?.allocation_pct ?? 0;

    return {
      task_id: entry.history_id,
      plan_id: entry.project_id,
      bucket_id: bucket?.bucket_id ?? bucketId(entry.project_id, entry.allocation_role),
      assignee_ids: entry.member_id,
      title: entry.task_title,
      description,
      status,
      priority: taskPriorityForStatus(status, allocationPct),
      due_date: allocation ? isoDateOnly(allocation.end_date) : '',
      tags: skillTags.join(','),
      checklist: '',
      comments: '',
      attachments: '',
    };
  });

  const timesheet: DerivedPlannerTimesheetRow[] = leaves
    .filter((leave) => leave.approved === 1 && leave.member_id)
    .map((leave, index) => {
      const leaveDate = isoDateOnly(leave.leave_date);
      const leaveId =
        leave.record_id?.trim() ||
        `leave-${leave.member_id}-${leaveDate}-${dedupeNaturalKey({
          member_id: leave.member_id,
          leave_date: leaveDate,
          leave_type: leave.leave_type,
          index,
        })}`;
      return {
        leave_id: leaveId,
        employee_id: leave.member_id as string,
        start_date: leaveDate,
        end_date: leaveDate,
        type: leave.leave_type,
        status: 'approved',
      };
    });

  return {
    users,
    groups,
    plans,
    buckets,
    planMembers,
    tasks,
    timesheet,
  };
}
