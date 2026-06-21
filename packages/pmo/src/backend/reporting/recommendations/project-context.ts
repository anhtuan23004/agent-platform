import type { RecommendationMember, TaskHistoryEvidence } from './contracts.ts';

export function scoreProjectContext(input: {
  projectId: string;
  role: string | null;
  source: RecommendationMember | undefined;
  target: RecommendationMember | undefined;
  targetTasks: TaskHistoryEvidence[];
}): number {
  if (input.targetTasks.some((task) => task.projectId === input.projectId)) return 1;
  if (input.role && input.targetTasks.some((task) => task.allocationRole === input.role))
    return 0.6;
  if (
    input.source &&
    input.target &&
    (input.source.department === input.target.department ||
      input.source.roleTitle === input.target.roleTitle)
  )
    return 0.4;
  return 0;
}
