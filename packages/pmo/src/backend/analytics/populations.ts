import type { MemberRow, ProjectRow } from './types.ts';

export interface PmoPopulations {
  deliveryMembers: MemberRow[];
  projectManagers: MemberRow[];
}

function hasPmRoleTitle(member: MemberRow): boolean {
  const role = (member.role_title ?? '').trim().toLowerCase();
  if (!role) return false;
  return (
    role === 'pm' || role.includes('project manager') || role.includes('pmo') || /\bpm\b/.test(role)
  );
}

function projectManagerIds(projects: ProjectRow[]): Set<string> {
  return new Set(projects.map((p) => p.pm_id).filter((pmId): pmId is string => Boolean(pmId)));
}

/**
 * Split people into PM and delivery populations.
 *
 * PMs are project/account owners for reporting and escalation. They should not
 * be mixed into resource-utilization findings unless PM capacity is modelled as
 * explicit delivery allocation in a separate PM analytics flow.
 */
export function splitPmoPopulations(members: MemberRow[], projects: ProjectRow[]): PmoPopulations {
  const pmIds = projectManagerIds(projects);
  const deliveryMembers: MemberRow[] = [];
  const projectManagers: MemberRow[] = [];

  for (const member of members) {
    if (pmIds.has(member.member_id) || hasPmRoleTitle(member)) {
      projectManagers.push(member);
    } else {
      deliveryMembers.push(member);
    }
  }

  return { deliveryMembers, projectManagers };
}
