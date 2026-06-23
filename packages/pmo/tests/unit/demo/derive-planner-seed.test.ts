import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isActiveUtilizationProject } from '../../../src/backend/analytics/utilization-scope.ts';
import { derivePlannerSeedFromMockDb } from '../../../src/backend/demo/derive-planner-seed.ts';
import {
  BUNDLED_PMO02_MOCK_DB_RELATIVE,
  queryMockDbJson,
  resolvePmoSeedAssetRoot,
} from '../../../src/backend/demo/seed-from-mock-db.ts';

const mockDbPath = resolve(resolvePmoSeedAssetRoot(), BUNDLED_PMO02_MOCK_DB_RELATIVE);

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

describe('derivePlannerSeedFromMockDb', () => {
  it('maps active PMO projects to planner plans', () => {
    const projects = queryMockDbJson<{ project_id: string; status: string | null }>(
      mockDbPath,
      `SELECT project_id, status FROM pmo_project_master WHERE is_active = 1`,
    );
    const activeProjectIds = new Set(
      projects
        .filter((project) => isActiveUtilizationProject(project.status))
        .map((project) => project.project_id),
    );

    const seed = derivePlannerSeedFromMockDb({ mockDbPath });

    expect(seed.plans).toHaveLength(activeProjectIds.size);
    expect(new Set(seed.plans.map((plan) => plan.plan_id))).toEqual(activeProjectIds);
  });

  it('creates department groups for allocated members and active plan departments', () => {
    const members = queryMockDbJson<{ member_id: string; department: string | null }>(
      mockDbPath,
      `SELECT member_id, department FROM pmo_member_master WHERE is_active = 1`,
    );
    const projects = queryMockDbJson<{
      project_id: string;
      status: string | null;
      pm_id: string | null;
    }>(mockDbPath, `SELECT project_id, status, pm_id FROM pmo_project_master WHERE is_active = 1`);
    const activeProjects = projects.filter((project) => isActiveUtilizationProject(project.status));
    const activeProjectIds = new Set(activeProjects.map((project) => project.project_id));
    const allocations = dedupeAllocations(
      queryMockDbJson<{
        member_id: string;
        project_id: string;
        start_date: string;
        end_date: string;
      }>(
        mockDbPath,
        `SELECT member_id, project_id, start_date, end_date
         FROM pmo_resource_allocations WHERE is_active = 1`,
      ),
    ).filter((allocation) => activeProjectIds.has(allocation.project_id));
    const departmentByMemberId = new Map(
      members.map((member) => [member.member_id, member.department] as const),
    );
    const allocatedMemberIds = new Set(allocations.map((allocation) => allocation.member_id));
    const expectedDepartments = new Set<string>();
    for (const member of members) {
      if (allocatedMemberIds.has(member.member_id)) {
        expectedDepartments.add(member.department?.trim() || 'Delivery');
      }
    }
    for (const project of activeProjects) {
      if (project.pm_id) {
        const pmDepartment = departmentByMemberId.get(project.pm_id);
        if (pmDepartment !== undefined) {
          expectedDepartments.add(pmDepartment?.trim() || 'Delivery');
          continue;
        }
      }
      const departmentCounts = new Map<string, number>();
      for (const allocation of allocations) {
        if (allocation.project_id !== project.project_id) continue;
        const department = departmentByMemberId.get(allocation.member_id)?.trim() || 'Delivery';
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
      expectedDepartments.add(dominantDepartment);
    }

    const seed = derivePlannerSeedFromMockDb({ mockDbPath });

    expect(new Set(seed.groups.map((group) => group.name))).toEqual(expectedDepartments);
  });

  it('creates users from member_master with PMO-aligned ids and emails', () => {
    const members = queryMockDbJson<{ member_id: string; full_name: string }>(
      mockDbPath,
      `SELECT member_id, full_name FROM pmo_member_master WHERE is_active = 1`,
    );
    const seed = derivePlannerSeedFromMockDb({ mockDbPath });

    expect(seed.users).toHaveLength(members.length);
    for (const member of members) {
      const user = seed.users.find((row) => row.user_id === member.member_id);
      expect(user).toBeDefined();
      expect(user?.email).toBe(`${member.member_id.toLowerCase()}@hackathon.pmo`);
      expect(user?.name).toBe(member.full_name);
      expect(user?.rbac_role).toBe('planner.contributor');
    }
  });

  it('derives planner tasks from member task history on active projects', () => {
    const projects = queryMockDbJson<{ project_id: string; status: string | null }>(
      mockDbPath,
      `SELECT project_id, status FROM pmo_project_master WHERE is_active = 1`,
    );
    const activeProjectIds = new Set(
      projects
        .filter((project) => isActiveUtilizationProject(project.status))
        .map((project) => project.project_id),
    );
    const activeHistoryCount = queryMockDbJson<{ project_id: string }>(
      mockDbPath,
      `SELECT project_id FROM pmo_member_task_history`,
    ).filter((entry) => activeProjectIds.has(entry.project_id)).length;

    const seed = derivePlannerSeedFromMockDb({ mockDbPath });
    const userIds = new Set(seed.users.map((user) => user.user_id));

    expect(seed.tasks).toHaveLength(activeHistoryCount);
    for (const task of seed.tasks) {
      for (const assigneeId of task.assignee_ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)) {
        expect(userIds.has(assigneeId)).toBe(true);
      }
      expect(task.title).not.toMatch(/— .* \([\d.]+%\)$/);
      expect(task.description).toMatch(/h logged$/);
    }

    const emp004Tasks = seed.tasks.filter(
      (task) => task.plan_id === 'PRJ-001' && task.assignee_ids.includes('EMP-004'),
    );
    expect(emp004Tasks).toHaveLength(4);
    const statusByTitle = new Map(emp004Tasks.map((task) => [task.title, task.status]));
    expect(statusByTitle.get('API endpoint implementation')).toBe('done');
    expect(statusByTitle.get('Service integration')).toBe('in progress');
    expect(statusByTitle.get('Bug fixes & code review')).toBe('todo');
    expect(statusByTitle.get('Database migration support')).toBe('todo');
  });

  it('derives approved leave rows for availability seeding', () => {
    const approvedLeaves = queryMockDbJson<{ member_id: string | null; approved: number | null }>(
      mockDbPath,
      `SELECT member_id, approved FROM pmo_leave_records WHERE is_active = 1`,
    ).filter((row) => row.approved === 1 && row.member_id);

    const seed = derivePlannerSeedFromMockDb({ mockDbPath });

    expect(seed.timesheet.length).toBe(approvedLeaves.length);
    expect(seed.timesheet.every((row) => row.status === 'approved')).toBe(true);
  });
});
