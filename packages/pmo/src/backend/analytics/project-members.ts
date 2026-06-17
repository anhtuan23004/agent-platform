import type { AllocationRow, MemberRow, ProjectRow } from './types.ts';

export interface ProjectMemberDependency {
  projectId: string;
  projectName: string;
  pmId: string | null;
  pmName: string | null;
  memberId: string;
  memberName: string;
  memberRoleTitle: string | null;
  allocationRole: string | null;
  weeklyPlannedHours: number;
}

/**
 * Build a project-centric view: each row says "this delivery member depends on
 * this project, owned by this PM". It is a trace view, not a utilization metric.
 */
export function buildProjectMemberDependencies(
  projects: ProjectRow[],
  members: MemberRow[],
  allocations: AllocationRow[],
): ProjectMemberDependency[] {
  const projectById = new Map(projects.map((p) => [p.project_id, p]));
  const memberById = new Map(members.map((m) => [m.member_id, m]));

  const rows: ProjectMemberDependency[] = [];
  for (const allocation of allocations) {
    const project = projectById.get(allocation.project_id);
    const member = memberById.get(allocation.member_id);
    if (!project || !member) continue;

    const pm = project.pm_id ? memberById.get(project.pm_id) : undefined;
    rows.push({
      projectId: project.project_id,
      projectName: project.project_name,
      pmId: project.pm_id,
      pmName: pm?.full_name ?? null,
      memberId: member.member_id,
      memberName: member.full_name,
      memberRoleTitle: member.role_title ?? null,
      allocationRole: allocation.role ?? null,
      weeklyPlannedHours: allocation.weekly_planned_hours ?? 0,
    });
  }

  return rows.sort(
    (a, b) =>
      a.projectId.localeCompare(b.projectId) ||
      (a.pmId ?? '').localeCompare(b.pmId ?? '') ||
      a.memberId.localeCompare(b.memberId),
  );
}
