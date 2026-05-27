import type { PgVector } from '@mastra/pg';
import type { EmbeddingProvider } from '@seta/shared-embeddings';
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { plannerDb } from '../db/index.ts';
import { plans, taskAssignments, tasks } from '../db/schema.ts';
import { searchTasks } from '../retrieval/search-tasks.ts';

export type FindSimilarTasksScope = 'recent-week' | 'recent-month' | 'all-open' | 'all';

export interface FindSimilarTasksInput {
  tenant_id: string;
  text: string;
  scope: FindSimilarTasksScope;
  limit: number;
  reviewState?: 'needs_review';
}

export interface FindSimilarTasksDeps {
  provider: EmbeddingProvider;
  pgVector: PgVector;
}

export interface FindSimilarTasksResult {
  taskId: string;
  groupId: string;
  title: string;
  score: number;
  assigneeUserIds: string[];
  status: string;
  reviewState: 'needs_review' | null;
  skillTags: string[];
  createdAt: string;
}

function scopeBoundary(scope: FindSimilarTasksScope, now: Date): Date | null {
  if (scope === 'recent-week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (scope === 'recent-month') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

export async function findSimilarTasks(
  input: FindSimilarTasksInput,
  deps: FindSimilarTasksDeps,
): Promise<{ results: FindSimilarTasksResult[] }> {
  const stage1 = await searchTasks(
    {
      query: input.text,
      tenant_id: input.tenant_id,
      limit: Math.max(input.limit * 4, 20),
    },
    {
      provider: deps.provider,
      pgVector: deps.pgVector,
      reranker: {
        providerId: 'noop' as const,
        rescore: async (_q, hits) =>
          hits.map((h) => ({ ...h, rerankScore: h.score, reranker: 'noop' as const })),
      },
    },
  );

  if (stage1.hits.length === 0) return { results: [] };

  const taskIds = stage1.hits.map((h) => h.item.task_id);
  const since = scopeBoundary(input.scope, new Date());

  const conditions = [
    eq(tasks.tenant_id, input.tenant_id),
    inArray(tasks.id, taskIds),
    isNull(tasks.deleted_at),
  ];
  if (since) conditions.push(gte(tasks.created_at, since));
  if (input.scope === 'all-open') conditions.push(sql`${tasks.percent_complete} < 100`);
  if (input.reviewState === 'needs_review') conditions.push(isNotNull(tasks.review_state));

  const rows = await plannerDb()
    .select({
      id: tasks.id,
      group_id: plans.group_id,
      title: tasks.title,
      percent_complete: tasks.percent_complete,
      review_state: tasks.review_state,
      skill_tags: tasks.skill_tags,
      created_at: tasks.created_at,
      assignee_ids: sql<
        string[]
      >`COALESCE(ARRAY_AGG(${taskAssignments.user_id}) FILTER (WHERE ${taskAssignments.user_id} IS NOT NULL), ARRAY[]::uuid[])`,
    })
    .from(tasks)
    .innerJoin(plans, eq(plans.id, tasks.plan_id))
    .leftJoin(taskAssignments, eq(taskAssignments.task_id, tasks.id))
    .where(and(...conditions))
    .groupBy(
      tasks.id,
      tasks.title,
      plans.group_id,
      tasks.percent_complete,
      tasks.review_state,
      tasks.skill_tags,
      tasks.created_at,
    );

  const byId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) byId.set(row.id, row);

  const results: FindSimilarTasksResult[] = [];
  for (const hit of stage1.hits) {
    const row = byId.get(hit.item.task_id);
    if (!row) continue;
    results.push({
      taskId: row.id,
      groupId: row.group_id,
      title: row.title,
      score: hit.score,
      assigneeUserIds: (row.assignee_ids ?? []).map(String),
      status: (row.percent_complete ?? 0) >= 100 ? 'completed' : 'open',
      reviewState: row.review_state ?? null,
      skillTags: row.skill_tags ?? [],
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    });
    if (results.length >= input.limit) break;
  }
  return { results };
}
