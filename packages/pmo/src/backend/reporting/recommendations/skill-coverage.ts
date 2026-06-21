import type { PmoReportRuleSet } from '../rules/schema.ts';
import type { MemberSkillEvidence } from './contracts.ts';

export function normalizeSkill(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

export function scoreSkillCoverage(input: {
  requiredSkills: Array<{ skillKey: string; level: number | null }>;
  candidateSkills: MemberSkillEvidence[];
  adjacentSkills: PmoReportRuleSet['recommendation']['adjacentSkills'];
}): { score: number; matchedSkills: string[]; missingSkills: string[] } {
  if (input.requiredSkills.length === 0) return { score: 0, matchedSkills: [], missingSkills: [] };
  const candidate = new Map(
    input.candidateSkills.map((skill) => [normalizeSkill(skill.skillKey), skill.proficiencyLevel]),
  );
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  let total = 0;
  for (const required of input.requiredSkills) {
    const key = normalizeSkill(required.skillKey);
    const exactLevel = candidate.get(key);
    if (exactLevel !== undefined) {
      total +=
        required.level === null || exactLevel === null || exactLevel >= required.level ? 1 : 0.7;
      matchedSkills.push(key);
      continue;
    }
    const adjacent = (input.adjacentSkills[key] ?? []).map(normalizeSkill);
    const adjacentMatch = adjacent.find((skill) => candidate.has(skill));
    if (adjacentMatch) {
      total += 0.5;
      matchedSkills.push(`${key}~${adjacentMatch}`);
    } else missingSkills.push(key);
  }
  return { score: total / input.requiredSkills.length, matchedSkills, missingSkills };
}
