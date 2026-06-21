import type { TaskHistoryEvidence } from './contracts.ts';

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    leftNorm += (left[index] ?? 0) ** 2;
    rightNorm += (right[index] ?? 0) ** 2;
  }
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function scoreTaskHistory(input: {
  workloadEmbedding: number[] | null;
  tasks: TaskHistoryEvidence[];
  effectiveAt: Date;
  historyWindowDays: number;
  topK: number;
}): { score: number; similarPastTasks: string[]; degraded: boolean; flags: string[] } {
  if (!input.workloadEmbedding) {
    return {
      score: 0,
      similarPastTasks: [],
      degraded: true,
      flags: ['workload_embedding_missing'],
    };
  }
  const scored = input.tasks
    .filter((task) => task.embedding)
    .map((task) => {
      const daysAgo = Math.max(
        0,
        (input.effectiveAt.getTime() - task.completedAt.getTime()) / 86_400_000,
      );
      return {
        task,
        score:
          cosine(input.workloadEmbedding as number[], task.embedding as number[]) *
          Math.exp(-daysAgo / input.historyWindowDays) *
          task.evidenceConfidence,
      };
    })
    .sort((a, b) => b.score - a.score || a.task.historyId.localeCompare(b.task.historyId))
    .slice(0, input.topK);
  if (scored.length === 0) {
    return { score: 0, similarPastTasks: [], degraded: true, flags: ['task_embeddings_missing'] };
  }
  return {
    score: scored.reduce((sum, item) => sum + item.score, 0) / scored.length,
    similarPastTasks: scored.map((item) => item.task.historyId),
    degraded: false,
    flags: [],
  };
}
