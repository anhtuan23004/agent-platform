import type { MemberSkillEvidence, TaskHistoryEvidence } from './contracts.ts';
import { normalizeSkill } from './skill-coverage.ts';

export interface WorkloadProfile {
  role: string | null;
  requiredSkills: Array<{ skillKey: string; level: number | null }>;
  recentTasks: TaskHistoryEvidence[];
  embedding: number[] | null;
  dataQualityFlags: string[];
}

export function buildWorkloadProfile(input: {
  role: string | null;
  sourceSkills: MemberSkillEvidence[];
  projectTasks: TaskHistoryEvidence[];
}): WorkloadProfile {
  const taskSkills = new Set(
    input.projectTasks.flatMap((task) => task.skillTags.map(normalizeSkill)),
  );
  const structured = input.sourceSkills
    .filter((skill) => taskSkills.size === 0 || taskSkills.has(normalizeSkill(skill.skillKey)))
    .map((skill) => ({ skillKey: normalizeSkill(skill.skillKey), level: skill.proficiencyLevel }));
  const requiredSkills =
    structured.length > 0
      ? structured
      : [...taskSkills].sort().map((skillKey) => ({ skillKey, level: null }));
  const embedded = input.projectTasks.filter((task) => task.embedding);
  const embedding = averageEmbeddings(embedded.map((task) => task.embedding as number[]));
  const flags: string[] = [];
  if (requiredSkills.length === 0) flags.push('required_skills_unavailable');
  if (!embedding) flags.push('workload_embedding_missing');
  return {
    role: input.role,
    requiredSkills,
    recentTasks: input.projectTasks,
    embedding,
    dataQualityFlags: flags,
  };
}

function averageEmbeddings(values: number[][]): number[] | null {
  const first = values[0];
  if (!first || values.some((value) => value.length !== first.length)) return null;
  return first.map(
    (_, index) => values.reduce((sum, value) => sum + (value[index] ?? 0), 0) / values.length,
  );
}
