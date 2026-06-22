import type { RecommendationMember } from './contracts.ts';

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function splitRoles(value: string | null | undefined): string[] {
  return normalize(value)
    .split(/[|,/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function scoreRoleCompatibility(input: {
  roleNeeded: string | null;
  candidate: RecommendationMember | undefined;
}): number {
  if (!input.candidate) return 0;
  const roleNeeded = normalize(input.roleNeeded);
  if (!roleNeeded) return 0.4;

  const title = normalize(input.candidate.roleTitle);
  const roles = splitRoles(input.candidate.roleTitle);
  if (title.includes(roleNeeded) || roles.includes(roleNeeded)) return 1;
  if (
    (roleNeeded === 'be' && title.includes('backend')) ||
    (roleNeeded === 'fe' && title.includes('frontend')) ||
    (roleNeeded === 'qa' && title.includes('qa')) ||
    (roleNeeded === 'design' && title.includes('design'))
  ) {
    return 0.7;
  }
  return 0;
}
